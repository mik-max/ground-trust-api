import { Request, Response } from "express";
import prisma from "../config/prisma";
import { TIER1_MIN_NIGHT_SAMPLES, TIER2_MIN_DAYS_SINCE_CONFIRMED } from "../config/constants";
import { recordGpsSample } from "../services/verification.service";

type Progress = { toward: "tier1"; nightSamples: number; nightSamplesNeeded: number } | { toward: "tier2"; daysConfirmed: number; daysNeeded: number } | null;

function tierProgress(tier: string, confirmedSince: Date | null, nightSamples: number): Progress {
  if (tier === "tier0") {
    return { toward: "tier1", nightSamples, nightSamplesNeeded: TIER1_MIN_NIGHT_SAMPLES };
  }
  if (tier === "tier1" && confirmedSince) {
    const daysConfirmed = Math.floor((Date.now() - confirmedSince.getTime()) / (1000 * 60 * 60 * 24));
    return { toward: "tier2", daysConfirmed, daysNeeded: TIER2_MIN_DAYS_SINCE_CONFIRMED };
  }
  return null;
}

// Current tier + progress per area, for the "My Contributions" screen.
export async function getVerificationStatus(req: Request, res: Response) {
  const userId = req.auth!.userId;

  const [residencies, nightCounts] = await Promise.all([
    prisma.userAreaResidency.findMany({
      where: { userId },
      include: { area: { select: { id: true, name: true, city: true, state: true } } },
    }),
    prisma.verificationEvent.groupBy({
      by: ["areaId"],
      where: { userId, eventType: "gps_sample", sampledAtNight: true },
      _count: true,
    }),
  ]);

  const nightCountByArea = new Map(nightCounts.map((c) => [c.areaId, c._count]));
  const withProgress = residencies.map((r) => ({
    ...r,
    progress: tierProgress(r.verificationTier, r.confirmedSince, nightCountByArea.get(r.areaId) ?? 0),
  }));

  return res.json({ residencies: withProgress });
}

// files/HANDOFF.md §5 — "resident app periodically posts presence signal."
// See services/verification.service.ts for the geofence + derive-and-discard
// logic; this handler is just the HTTP boundary and input validation.
export async function postGpsSample(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const { areaId, lat, lng } = req.body as { areaId?: string; lat?: number; lng?: number };

  if (!areaId || typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "areaId, lat, and lng are required" });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  const result = await recordGpsSample(userId, areaId, lat, lng);
  if (!result.accepted) {
    if (result.reason === "area_not_found") {
      return res.status(404).json({ error: "Area not found" });
    }
    return res.status(422).json({ error: "Location is outside this area" });
  }

  return res.json({ residency: result.residency });
}
