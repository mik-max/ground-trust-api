import { Request, Response } from "express";
import prisma from "../config/prisma";
import { Aspect } from "../generated/prisma";
import { bandFromScore, confidenceFromN, recomputeAreaScore } from "../services/scoring.service";
import { TRUST_WEIGHT_BY_TIER, tierFromWeight } from "../config/constants";

const ASPECTS: Aspect[] = ["power", "water", "security", "roads_flooding", "accessibility"];
const RATING_FIELD: Record<Aspect, string> = {
  power: "ratingPower",
  water: "ratingWater",
  security: "ratingSecurity",
  roads_flooding: "ratingRoadsFlooding",
  accessibility: "ratingAccessibility",
};

// Shared by listAreas (compact Evidence Stacks) and getArea (full stack) so
// both surfaces stay consistent with a single source of computation.
async function computeEvidence(areaId: string) {
  const scores = await prisma.areaScore.findMany({ where: { areaId } });
  const scoreByAspect = new Map(scores.map((s) => [s.aspect, s]));

  const aspects = ASPECTS.map((aspect) => {
    const s = scoreByAspect.get(aspect);
    return s
      ? { aspect, score: s.score, band: s.band, N: s.contributorCount, confidence: s.confidenceLevel }
      : { aspect, score: null, band: null, N: 0, confidence: "low" as const };
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
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { city: { contains: query, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
  });

  const areas = await Promise.all(
    areaRows.map(async (area) => ({ area, ...(await computeEvidence(area.id)) }))
  );

  return res.json({ areas });
}

// Full Evidence Stack payload per files/HANDOFF.md §5:
// { area, overall: {score, band, N, confidence}, aspects: [...] }
export async function getArea(req: Request, res: Response) {
  const { id } = req.params;

  const area = await prisma.area.findUnique({ where: { id } });
  if (!area) {
    return res.status(404).json({ error: "Area not found" });
  }

  const { overall, aspects } = await computeEvidence(id);
  return res.json({ area, overall, aspects });
}

export async function getAreaReviews(req: Request, res: Response) {
  const { id } = req.params;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 20;

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where: { areaId: id, moderationStatus: "approved" },
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { id: true, fullName: true } } },
    }),
    prisma.review.count({ where: { areaId: id, moderationStatus: "approved" } }),
  ]);

  // Reviewer's tier isn't stored directly on Review (only the weight
  // snapshot is, for historical explainability) — derive it for display,
  // per GroundTruth_Design_Implementation_Guide.md §3.9's Review card spec.
  const reviewsWithTier = reviews.map((r) => ({
    ...r,
    tierAtSubmission: tierFromWeight(r.trustWeightAtSubmission),
  }));

  return res.json({ reviews: reviewsWithTier, page, pageSize, total });
}

// Structured ratings required, text/audio optional. Auto-provisions the
// submitter's UserAreaResidency at tier0 if this is their first review for
// this area (GPS-based tier upgrades aren't built yet — see files/HANDOFF.md §2.1).
export async function createReview(req: Request, res: Response) {
  const { id: areaId } = req.params;
  const userId = req.auth!.userId;
  const { originalText, originalLanguage, originalAudioRef, ratings } = req.body as {
    originalText?: string;
    originalLanguage?: string;
    originalAudioRef?: string;
    ratings?: Partial<Record<Aspect, number>>;
  };

  if (!ratings || Object.keys(ratings).length === 0) {
    return res.status(400).json({ error: "At least one aspect rating is required" });
  }
  if (originalAudioRef && !/^\/uploads\/audio\/[\w-]+\.\w+$/.test(originalAudioRef)) {
    return res.status(400).json({ error: "Invalid audio reference" });
  }
  for (const [aspect, rating] of Object.entries(ratings)) {
    if (!ASPECTS.includes(aspect as Aspect) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: `Invalid rating for aspect '${aspect}'` });
    }
  }

  const area = await prisma.area.findUnique({ where: { id: areaId } });
  if (!area) {
    return res.status(404).json({ error: "Area not found" });
  }

  let residency = await prisma.userAreaResidency.findUnique({
    where: { userId_areaId: { userId, areaId } },
  });
  if (!residency) {
    residency = await prisma.userAreaResidency.create({
      data: { userId, areaId, verificationTier: "tier0", trustWeight: TRUST_WEIGHT_BY_TIER.tier0 },
    });
  }

  const ratingData: Record<string, number> = {};
  for (const [aspect, rating] of Object.entries(ratings)) {
    ratingData[RATING_FIELD[aspect as Aspect]] = rating as number;
  }

  const review = await prisma.review.create({
    data: {
      areaId,
      userId,
      originalText,
      originalLanguage,
      originalAudioRef,
      trustWeightAtSubmission: residency.trustWeight,
      ...ratingData,
    },
  });

  for (const aspect of Object.keys(ratings) as Aspect[]) {
    await recomputeAreaScore(areaId, aspect);
  }

  return res.status(201).json({ review });
}
