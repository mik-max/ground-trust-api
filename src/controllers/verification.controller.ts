import { Request, Response } from "express";
import prisma from "../config/prisma";
import {
  RESIDENCY_LAPSE_DAYS,
  TIER1_MIN_NIGHTS,
  TIER1_WINDOW_DAYS,
  TIER2_MIN_DAYS_SINCE_CONFIRMED,
  TIER2_RECENT_NIGHT_DAYS,
} from "../config/constants";
import { nightKey, recordGpsSample } from "../services/verification.service";

const DAY_MS = 24 * 60 * 60 * 1000;

type Progress =
  | { toward: "tier1"; nights: number; nightsNeeded: number; windowDays: number }
  | { toward: "tier2"; daysConfirmed: number; daysNeeded: number }
  | null;

function tierProgress(tier: string, confirmedSince: Date | null, nightChecks: Date[]): Progress {
  if (tier === "tier0") {
    const since = Date.now() - TIER1_WINDOW_DAYS * DAY_MS;
    const nights = new Set(nightChecks.filter((d) => d.getTime() >= since).map(nightKey)).size;
    return { toward: "tier1", nights, nightsNeeded: TIER1_MIN_NIGHTS, windowDays: TIER1_WINDOW_DAYS };
  }
  if (tier === "tier1" && confirmedSince) {
    const daysConfirmed = Math.floor((Date.now() - confirmedSince.getTime()) / DAY_MS);
    return { toward: "tier2", daysConfirmed, daysNeeded: TIER2_MIN_DAYS_SINCE_CONFIRMED };
  }
  return null;
}

// When a confirmed status needs a fresh night check to keep it: long-term
// drops back after TIER2_RECENT_NIGHT_DAYS without one, any confirmed status
// lapses after RESIDENCY_LAPSE_DAYS.
function keepBy(tier: string, lastNight: Date | null): Date | null {
  if (!lastNight || tier === "tier0" || tier === "tier3") return null;
  const days = tier === "tier2" ? TIER2_RECENT_NIGHT_DAYS : RESIDENCY_LAPSE_DAYS;
  return new Date(lastNight.getTime() + days * DAY_MS);
}

// Current tier + progress per area, for the "My Contributions" screen. A
// UserAreaResidency row alone doesn't mean "I contributed" — it's also
// created silently by a background GPS check-in (useGpsPresenceSample fires
// on the review page itself, before any review is actually submitted), so
// just being verified as physically present somewhere isn't the same thing
// as having reviewed it. This only lists areas the resident has actually
// submitted at least one review for (any moderation status — the point is
// "did I do this", not "is it currently public").
export async function getVerificationStatus(req: Request, res: Response) {
  const userId = req.auth!.userId;

  const [residencies, nightEvents, reviewedAreaIds] = await Promise.all([
    prisma.userAreaResidency.findMany({
      where: { userId },
      include: { area: { select: { id: true, name: true, city: true, state: true, status: true } } },
    }),
    prisma.verificationEvent.findMany({
      where: { userId, eventType: "gps_sample", sampledAtNight: true },
      select: { areaId: true, createdAt: true },
    }),
    prisma.review.groupBy({ by: ["areaId"], where: { userId }, _max: { submittedAt: true } }),
  ]);

  // lastReviewedAt lets My Contributions ask residents whose rating is old
  // whether anything has changed, since their latest rating replaces older ones.
  const lastReviewedByArea = new Map(reviewedAreaIds.map((r) => [r.areaId, r._max.submittedAt]));
  const reviewedSet = new Set(lastReviewedByArea.keys());
  const nightsByArea = new Map<string, Date[]>();
  for (const e of nightEvents) {
    nightsByArea.set(e.areaId, [...(nightsByArea.get(e.areaId) ?? []), e.createdAt]);
  }
  const withProgress = residencies
    .filter((r) => reviewedSet.has(r.areaId))
    .map((r) => {
      const nights = nightsByArea.get(r.areaId) ?? [];
      const lastNight = nights.reduce<Date | null>((max, d) => (!max || d > max ? d : max), null);
      return {
        ...r,
        lastReviewedAt: lastReviewedByArea.get(r.areaId) ?? null,
        progress: tierProgress(r.verificationTier, r.confirmedSince, nights),
        keepBy: keepBy(r.verificationTier, lastNight),
      };
    });

  return res.json({ residencies: withProgress });
}

// files/HANDOFF.md §5 — "resident app periodically posts presence signal."
// See services/verification.service.ts for the geofence + derive-and-discard
// logic; this handler is just the HTTP boundary and input validation.
export async function postGpsSample(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const { areaId, lat, lng, accuracy } = req.body as { areaId?: string; lat?: number; lng?: number; accuracy?: number };

  if (!areaId || typeof lat !== "number" || typeof lng !== "number" || typeof accuracy !== "number") {
    return res.status(400).json({ error: "areaId, lat, lng and accuracy are required" });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || !(accuracy >= 0)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  const result = await recordGpsSample(userId, areaId, lat, lng, accuracy);
  if (!result.accepted) {
    if (result.reason === "area_not_found") {
      return res.status(404).json({ error: "Area not found" });
    }
    const message =
      result.reason === "outside_area"
        ? "Location is outside this area"
        : result.reason === "imprecise"
          ? "Location isn't precise enough to confirm residency"
          : "Location check couldn't be accepted";
    return res.status(422).json({ error: message, reason: result.reason });
  }

  return res.json({ residency: result.residency });
}
