import prisma from "../config/prisma";
import { Aspect, Band, ConfidenceLevel, Review } from "../generated/prisma";
import {
  FLAGGABLE_ASPECTS,
  FLAG_THRESHOLD,
  MIN_N_FOR_FLAG,
  MIN_N_HIGH,
  MIN_N_MEDIUM,
  MIN_WEEKS_PERSISTENT,
  RATING_FIELD_BY_ASPECT,
  TRUST_WEIGHT_BY_TIER,
} from "../config/constants";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function bandFromScore(score: number): Band {
  if (score >= 4.0) return "excellent";
  if (score >= 3.0) return "good";
  if (score >= 2.0) return "fair";
  return "poor";
}

export function confidenceFromN(n: number): ConfidenceLevel {
  if (n < MIN_N_MEDIUM) return "low";
  if (n < MIN_N_HIGH) return "medium";
  return "high";
}

export interface RecomputeResult {
  score: number;
  band: Band;
  contributorCount: number;
  confidence: ConfidenceLevel;
}

// Implements files/HANDOFF.md §4.3 recomputeAreaScore. Runs synchronously
// after each review submission for immediate feedback, and is swept weekly
// for every area/aspect regardless of new activity by jobs/recompute.job.ts
// — that sweep is what actually makes the flag streak's "weeks persistent"
// mean calendar weeks, not review-submission coincidence. The "consecutive
// weeks below threshold" streak still gates increments on the Flag row's
// `triggeredAt` (at least 7 days since the last bump) as a safety net
// against an interleaved on-demand call double-bumping within the same
// week the scheduled sweep already covered.
export async function recomputeAreaScore(areaId: string, aspect: Aspect): Promise<RecomputeResult | null> {
  const ratingField = RATING_FIELD_BY_ASPECT[aspect];

  const reviews = await prisma.review.findMany({
    where: {
      areaId,
      moderationStatus: "approved",
      [ratingField]: { not: null },
    },
    select: { userId: true, ratingPower: true, ratingWater: true, ratingSecurity: true, ratingRoadsFlooding: true, ratingAccessibility: true },
  });

  if (reviews.length === 0) {
    return null;
  }

  const residencies = await prisma.userAreaResidency.findMany({
    where: { areaId, userId: { in: reviews.map((r) => r.userId) } },
  });
  const weightByUser = new Map(residencies.map((r) => [r.userId, r.trustWeight]));

  let weightedSum = 0;
  let weightTotal = 0;
  const distinctUsers = new Set<string>();

  for (const review of reviews) {
    const rating = review[ratingField] as number;
    const weight = weightByUser.get(review.userId) ?? TRUST_WEIGHT_BY_TIER.tier0;
    weightedSum += rating * weight;
    weightTotal += weight;
    distinctUsers.add(review.userId);
  }

  const score = weightedSum / weightTotal;
  const contributorCount = distinctUsers.size;
  const confidence = confidenceFromN(contributorCount);
  const band = bandFromScore(score);

  await prisma.areaScore.upsert({
    where: { areaId_aspect: { areaId, aspect } },
    create: { areaId, aspect, score, band, contributorCount, confidenceLevel: confidence },
    update: { score, band, contributorCount, confidenceLevel: confidence },
  });

  if (
    (FLAGGABLE_ASPECTS as readonly string[]).includes(aspect) &&
    score <= FLAG_THRESHOLD &&
    contributorCount >= MIN_N_FOR_FLAG
  ) {
    await bumpFlagStreak(areaId, aspect);
  } else {
    await resetFlagStreak(areaId, aspect);
  }

  return { score, band, contributorCount, confidence };
}

// Recomputes every aspect a given review actually rated. Shared by callers
// that flip a review's public eligibility after the fact — the automated
// moderation check (nlp.service.ts) and a human admin's approve/reject
// decision (admin.controller.ts) — since either direction (newly counted or
// newly excluded) needs the same aspects re-aggregated.
export async function recomputeReviewAspects(review: Review): Promise<void> {
  for (const aspect of Object.keys(RATING_FIELD_BY_ASPECT) as Aspect[]) {
    if (review[RATING_FIELD_BY_ASPECT[aspect]] !== null) {
      await recomputeAreaScore(review.areaId, aspect);
    }
  }
}

async function bumpFlagStreak(areaId: string, aspect: Aspect) {
  const existing = await prisma.flag.findFirst({
    where: { areaId, aspect, resolved: false },
  });

  if (!existing) {
    await prisma.flag.create({
      data: { areaId, aspect, triggeredAt: new Date(), consecutiveWeeksBelowThreshold: 1 },
    });
    return;
  }

  const dueForBump = Date.now() - existing.triggeredAt.getTime() >= WEEK_MS;
  if (dueForBump) {
    await prisma.flag.update({
      where: { id: existing.id },
      data: {
        triggeredAt: new Date(),
        consecutiveWeeksBelowThreshold: existing.consecutiveWeeksBelowThreshold + 1,
      },
    });
  }
}

async function resetFlagStreak(areaId: string, aspect: Aspect) {
  await prisma.flag.updateMany({
    where: { areaId, aspect, resolved: false },
    data: { resolved: true, resolvedAt: new Date() },
  });
}

// A Flag row exists as soon as an aspect first crosses threshold, so the
// streak can be tracked — but it's only "actionable" for government once
// it's persisted for MIN_WEEKS_PERSISTENT. Callers listing flags should use
// this to filter, not just `resolved: false`.
export const MIN_WEEKS_PERSISTENT_FOR_DISPLAY = MIN_WEEKS_PERSISTENT;
