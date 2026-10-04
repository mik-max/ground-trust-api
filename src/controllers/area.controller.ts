import { Request, Response } from "express";
import prisma from "../config/prisma";
import { Aspect } from "../generated/prisma";
import { bandFromScore, confidenceFromN, recomputeAreaScore } from "../services/scoring.service";
import { processReview } from "../services/nlp.service";
import { haversineDistanceMeters } from "../services/verification.service";
import {
  ASPECTS,
  BURST_NEW_ACCOUNT_DAYS,
  BURST_THRESHOLD,
  BURST_WINDOW_HOURS,
  RATING_FIELD_BY_ASPECT,
  TREND_MIN_CHANGE,
  TREND_MIN_RESIDENTS,
  TREND_RECENT_DAYS,
  TRUST_WEIGHT_BY_TIER,
  isInServiceState,
  isWithinServiceBounds,
  tierFromWeight,
} from "../config/constants";

// Shared by listAreas (compact Evidence Stacks) and getArea (full stack) so
// both surfaces stay consistent with a single source of computation.
type Trend = "improving" | "declining" | null;

// Per aspect: how many residents gave each rating (1-5), and whether recent
// ratings differ clearly from earlier ones. Both count only each resident's
// most recent approved rating — the same rule the score uses — so the
// profile can show disagreement and change that an average would hide.
async function ratingDistribution(areaId: string) {
  const reviews = await prisma.review.findMany({
    where: { areaId, moderationStatus: "approved" },
    select: {
      userId: true,
      submittedAt: true,
      ratingPower: true,
      ratingWater: true,
      ratingSecurity: true,
      ratingRoadsFlooding: true,
      ratingAccessibility: true,
    },
    orderBy: { submittedAt: "desc" },
  });
  const residencies = await prisma.userAreaResidency.findMany({ where: { areaId } });
  const weightByUser = new Map(residencies.map((r) => [r.userId, r.trustWeight]));
  const recentSince = Date.now() - TREND_RECENT_DAYS * 24 * 60 * 60 * 1000;

  const result = {} as Record<Aspect, { distribution: number[]; trend: Trend }>;
  for (const aspect of ASPECTS) {
    const counts = [0, 0, 0, 0, 0];
    const seen = new Set<string>();
    const sides = { recent: { sum: 0, weight: 0, n: 0 }, older: { sum: 0, weight: 0, n: 0 } };
    for (const r of reviews) {
      const rating = r[RATING_FIELD_BY_ASPECT[aspect]];
      if (rating === null || seen.has(r.userId)) continue;
      seen.add(r.userId);
      counts[rating - 1] += 1;
      const side = r.submittedAt.getTime() >= recentSince ? sides.recent : sides.older;
      const w = weightByUser.get(r.userId) ?? TRUST_WEIGHT_BY_TIER.tier0;
      side.sum += rating * w;
      side.weight += w;
      side.n += 1;
    }
    let trend: Trend = null;
    if (sides.recent.n >= TREND_MIN_RESIDENTS && sides.older.n >= TREND_MIN_RESIDENTS) {
      const change = sides.recent.sum / sides.recent.weight - sides.older.sum / sides.older.weight;
      if (change >= TREND_MIN_CHANGE) trend = "improving";
      else if (change <= -TREND_MIN_CHANGE) trend = "declining";
    }
    result[aspect] = { distribution: counts, trend };
  }
  return result;
}

async function computeEvidence(areaId: string, withDistribution = false) {
  const scores = await prisma.areaScore.findMany({ where: { areaId } });
  const distribution = withDistribution ? await ratingDistribution(areaId) : null;
  const scoreByAspect = new Map(scores.map((s) => [s.aspect, s]));

  const aspects = ASPECTS.map((aspect) => {
    const s = scoreByAspect.get(aspect);
    return s
      ? { aspect, score: s.score, band: s.band, N: s.contributorCount, confidence: s.confidenceLevel, distribution: distribution?.[aspect].distribution, trend: distribution?.[aspect].trend }
      : { aspect, score: null, band: null, N: 0, confidence: "low" as const, distribution: distribution?.[aspect].distribution, trend: distribution?.[aspect].trend };
  });

  const contributors = await prisma.review.groupBy({
    by: ["userId"],
    where: { areaId, moderationStatus: "approved" },
  });
  const overallN = contributors.length;

  const ratedScores = scores.map((s) => s.score);
  const overallScore = ratedScores.length
    ? ratedScores.reduce((sum, s) => sum + s, 0) / ratedScores.length
    : null;

  const overall = {
    score: overallScore,
    band: overallScore !== null ? bandFromScore(overallScore) : null,
    N: overallN,
    confidence: confidenceFromN(overallN),
  };

  return { overall, aspects };
}

export async function listAreas(req: Request, res: Response) {
  const query = typeof req.query.query === "string" ? req.query.query : undefined;

  const areaRows = await prisma.area.findMany({
    where: {
      status: "approved",
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { city: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });

  const areas = await Promise.all(
    areaRows.map(async (area) => ({ area, ...(await computeEvidence(area.id)) }))
  );

  return res.json({ areas });
}

// Full Evidence Stack payload per files/HANDOFF.md §5:
// { area, overall: {score, band, N, confidence}, aspects: [...] }
// A pending area (see createArea) is otherwise invisible everywhere, but the
// resident who proposed it — or an admin, reviewing it — can still open its
// profile directly by id, so submitting doesn't look like it vanished.
export async function getArea(req: Request, res: Response) {
  const { id } = req.params;

  const area = await prisma.area.findUnique({ where: { id } });
  if (!area) {
    return res.status(404).json({ error: "Area not found" });
  }
  const isOwnerOrAdmin = req.auth && (req.auth.userId === area.createdByUserId || req.auth.role === "admin");
  if (area.status !== "approved" && !isOwnerOrAdmin) {
    return res.status(404).json({ error: "Area not found" });
  }

  const { overall, aspects } = await computeEvidence(id, true);
  return res.json({ area, overall, aspects });
}

export async function getAreaReviews(req: Request, res: Response) {
  const { id } = req.params;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 20;

  // Same visibility rule as getArea: a pending area's reviews aren't public
  // yet either, just because someone has the area id — only the proposer or
  // an admin can read them ahead of approval.
  const area = await prisma.area.findUnique({ where: { id } });
  if (!area) {
    return res.status(404).json({ error: "Area not found" });
  }
  const isOwnerOrAdmin = req.auth && (req.auth.userId === area.createdByUserId || req.auth.role === "admin");
  if (area.status !== "approved" && !isOwnerOrAdmin) {
    return res.status(404).json({ error: "Area not found" });
  }

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where: { areaId: id, moderationStatus: "approved" },
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.review.count({ where: { areaId: id, moderationStatus: "approved" } }),
  ]);

  // Privacy: a voice review's raw recording is the reviewer's actual voice,
  // not just their words — residents/newcomers/visitors only ever get the
  // transcribed/translated text (already computed by the STT pipeline, see
  // stt.service.ts), never the audio file itself. Government accounts get
  // the real recording, since they're verifying conditions in an official
  // capacity rather than just browsing. This route has no requireAuth (it's
  // publicly readable), so "government" here comes from optionalAuth —
  // req.auth is only set if a valid token was actually presented.
  const isGovernment = req.auth?.role === "government";

  // Reviewer's tier isn't stored directly on Review (only the weight
  // snapshot is, for historical explainability) — derive it for display,
  // per GroundTruth_Design_Implementation_Guide.md §3.9's Review card spec.
  // Privacy: reviewers' identities are never sent publicly — no name and no
  // account id. isOwn tells a signed-in viewer which reviews are theirs
  // (so the UI can hide "Report" on them) without revealing who wrote the rest.
  const reviewsWithTier = reviews.map(({ userId, ...r }) => ({
    ...r,
    isOwn: req.auth?.userId === userId,
    // hasVoiceRecording survives even when the audio itself is hidden, so
    // the UI can still say "this was a voice review" (transparency) without
    // exposing the recording to non-government viewers.
    hasVoiceRecording: r.originalAudioRef !== null,
    originalAudioRef: isGovernment ? r.originalAudioRef : null,
    tierAtSubmission: tierFromWeight(r.trustWeightAtSubmission),
  }));

  return res.json({ reviews: reviewsWithTier, page, pageSize, total });
}

// files/BACKLOG.md — location-search discovery: a visitor types a real
// Nigerian place name (via the geocode search proxy) and we check whether
// any seeded Area's geofence actually contains that point, using the same
// haversine check GPS-tier-upgrade sampling already relies on. Areas are a
// small, admin-curated set (not user-generated), so a full table scan here
// is fine at this scale — no spatial index needed.
export async function findNearestArea(req: Request, res: Response) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: "lat and lng query params are required" });
  }

  const areas = await prisma.area.findMany({ where: { status: "approved" } });
  const match = areas.find(
    (area) => haversineDistanceMeters(lat, lng, area.geoCentroidLat, area.geoCentroidLng) <= area.geoRadiusMeters
  );

  return res.json({ area: match ?? null });
}

const MIN_RADIUS_METERS = 300;
const MAX_RADIUS_METERS = 5000;
const DEFAULT_RADIUS_METERS = 2000;

interface ReviewInput {
  originalText?: string;
  originalLanguage?: string;
  originalAudioRef?: string;
  ratings?: Partial<Record<Aspect, number>>;
}

function validateReviewInput(input: ReviewInput): string | null {
  if (!input.ratings || Object.keys(input.ratings).length === 0) {
    return "At least one aspect rating is required";
  }
  if (input.originalAudioRef && !/^\/uploads\/audio\/[\w-]+\.\w+$/.test(input.originalAudioRef)) {
    return "Invalid audio reference";
  }
  for (const [aspect, rating] of Object.entries(input.ratings)) {
    if (!ASPECTS.includes(aspect as Aspect) || rating < 1 || rating > 5) {
      return `Invalid rating for aspect '${aspect}'`;
    }
  }
  return null;
}

// Shared by createReview (an existing, approved area) and createArea's
// optional review payload (a brand-new, still-pending one) — the resident
// proposing a new area almost always wants to write about it in the same
// motion, not come back days later once it's approved to do it all again.
// Auto-provisions the submitter's UserAreaResidency at tier0 if this is
// their first review for this area (GPS-based tier upgrades aren't built
// yet — see files/HANDOFF.md §2.1).
const HOUR_MS = 60 * 60 * 1000;

// Returns a hold reason when the submitter is a new account and the area is
// receiving a burst of reviews from new accounts; null otherwise.
async function burstHoldReason(areaId: string, userId: string): Promise<string | null> {
  const newAccountSince = new Date(Date.now() - BURST_NEW_ACCOUNT_DAYS * 24 * HOUR_MS);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!user || user.createdAt < newAccountSince) {
    return null;
  }
  const recentFromNewAccounts = await prisma.review.count({
    where: {
      areaId,
      submittedAt: { gte: new Date(Date.now() - BURST_WINDOW_HOURS * HOUR_MS) },
      user: { createdAt: { gte: newAccountSince } },
    },
  });
  if (recentFromNewAccounts + 1 < BURST_THRESHOLD) {
    return null;
  }
  return `Held automatically: ${recentFromNewAccounts + 1} reviews of this area from accounts under ${BURST_NEW_ACCOUNT_DAYS} days old in the last ${BURST_WINDOW_HOURS} hours.`;
}

async function submitReviewForArea(areaId: string, userId: string, input: ReviewInput) {
  const { originalText, originalLanguage, originalAudioRef, ratings } = input;

  let residency = await prisma.userAreaResidency.findUnique({
    where: { userId_areaId: { userId, areaId } },
  });
  if (!residency) {
    residency = await prisma.userAreaResidency.create({
      data: { userId, areaId, verificationTier: "tier0", trustWeight: TRUST_WEIGHT_BY_TIER.tier0 },
    });
  }

  const holdReason = await burstHoldReason(areaId, userId);

  const ratingData: Record<string, number> = {};
  for (const [aspect, rating] of Object.entries(ratings!)) {
    ratingData[RATING_FIELD_BY_ASPECT[aspect as Aspect]] = rating as number;
  }

  // files/ADDENDUM.md §3 — text is checked before it's eligible to go
  // public, so a review submitted with text starts pending rather than the
  // schema's default approved; the automated check (part of the NLP
  // pipeline below) clears it moments later. A voice-only review has
  // nothing to check yet, so it stays approved until a transcript exists.
  // (For a review attached to a brand-new area, "publicly visible" still
  // means nothing until the area itself is approved too — see getArea.)
  const review = await prisma.review.create({
    data: {
      areaId,
      userId,
      originalText,
      originalLanguage,
      originalAudioRef,
      trustWeightAtSubmission: residency.trustWeight,
      moderationStatus: holdReason || originalText ? "pending" : "approved",
      holdReason,
      ...ratingData,
    },
  });

  for (const aspect of Object.keys(ratings!) as Aspect[]) {
    await recomputeAreaScore(areaId, aspect);
  }

  // Fire-and-forget: translation/classification is a secondary signal
  // (files/HANDOFF.md §2.2 — the structured rating aggregate stays the
  // score of record), so it doesn't block the response or review creation.
  processReview(review.id).catch((err) => console.error(`[nlp] Unhandled error for review ${review.id}:`, err));

  return review;
}

// A resident who can't find their own neighbourhood (LocationSearchInput's
// "not covered yet" state) can propose it here instead of being stuck
// browsing only the admin-seeded set — optionally in the same request as
// their actual review of it (see submitReviewForArea above), so proposing
// and reviewing aren't two disconnected trips. Starts "pending" — invisible
// to listAreas/findNearestArea/public getArea — until an admin approves it
// (see admin.controller.ts's moderateArea), same shape as review moderation.
export async function createArea(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const { name, city, state, geoCentroidLat, geoCentroidLng, geoRadiusMeters, review } = req.body as {
    name?: string;
    city?: string;
    state?: string;
    geoCentroidLat?: number;
    geoCentroidLng?: number;
    geoRadiusMeters?: number;
    review?: ReviewInput;
  };

  if (!name?.trim() || !city?.trim() || !state?.trim()) {
    return res.status(400).json({ error: "name, city, and state are required" });
  }
  if (typeof geoCentroidLat !== "number" || typeof geoCentroidLng !== "number") {
    return res.status(400).json({ error: "geoCentroidLat and geoCentroidLng are required" });
  }
  if (geoCentroidLat < -90 || geoCentroidLat > 90 || geoCentroidLng < -180 || geoCentroidLng > 180) {
    return res.status(400).json({ error: "geoCentroidLat/geoCentroidLng out of range" });
  }
  if (!isInServiceState(state) || !isWithinServiceBounds(geoCentroidLat, geoCentroidLng)) {
    return res.status(400).json({ error: "GroundTrust currently covers areas in Lagos State only" });
  }
  const radius = geoRadiusMeters ?? DEFAULT_RADIUS_METERS;
  if (radius < MIN_RADIUS_METERS || radius > MAX_RADIUS_METERS) {
    return res.status(400).json({ error: `geoRadiusMeters must be between ${MIN_RADIUS_METERS} and ${MAX_RADIUS_METERS}` });
  }
  if (review) {
    const reviewError = validateReviewInput(review);
    if (reviewError) {
      return res.status(400).json({ error: reviewError });
    }
  }

  const area = await prisma.area.create({
    data: {
      name: name.trim(),
      city: city.trim(),
      state: state.trim(),
      geoCentroidLat,
      geoCentroidLng,
      geoRadiusMeters: radius,
      status: "pending",
      createdByUserId: userId,
    },
  });

  const createdReview = review ? await submitReviewForArea(area.id, userId, review) : null;

  return res.status(201).json({ area, review: createdReview });
}

// Structured ratings required, text/audio optional.
export async function createReview(req: Request, res: Response) {
  const { id: areaId } = req.params;
  const userId = req.auth!.userId;
  const input = req.body as ReviewInput;

  const validationError = validateReviewInput(input);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const area = await prisma.area.findUnique({ where: { id: areaId } });
  if (!area) {
    return res.status(404).json({ error: "Area not found" });
  }

  const review = await submitReviewForArea(areaId, userId, input);
  return res.status(201).json({ review });
}
