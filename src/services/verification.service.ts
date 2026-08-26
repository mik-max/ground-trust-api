import prisma from "../config/prisma";
import { Prisma, VerificationTier } from "../generated/prisma";
import {
  NIGERIA_UTC_OFFSET_HOURS,
  NIGHT_END_HOUR,
  NIGHT_START_HOUR,
  TIER1_MIN_NIGHT_SAMPLES,
  TIER2_MIN_DAYS_SINCE_CONFIRMED,
  TRUST_WEIGHT_BY_TIER,
} from "../config/constants";

const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Nigeria is a single fixed UTC+1 offset, no DST — see config/constants.ts.
export function isNightInNigeria(date: Date): boolean {
  const localHour = (date.getUTCHours() + NIGERIA_UTC_OFFSET_HOURS) % 24;
  return localHour >= NIGHT_START_HOUR || localHour < NIGHT_END_HOUR;
}

// files/HANDOFF.md §2.1 — Tier 0 -> Tier 1 on repeated night-weighted
// presence; Tier 1 -> Tier 2 once that's sustained 60+ days. Never
// downgrades (no decay policy specified) and never touches tier3
// (document-verified is future work, out of MVP scope entirely).
export async function recomputeResidencyTier(userId: string, areaId: string) {
  const residency = await prisma.userAreaResidency.findUniqueOrThrow({
    where: { userId_areaId: { userId, areaId } },
  });

  if (residency.verificationTier === "tier3") {
    return residency;
  }

  let nextTier: VerificationTier = residency.verificationTier;
  let confirmedSince = residency.confirmedSince;

  if (residency.verificationTier === "tier0") {
    const nightSamples = await prisma.verificationEvent.count({
      where: { userId, areaId, eventType: "gps_sample", sampledAtNight: true },
    });
    if (nightSamples >= TIER1_MIN_NIGHT_SAMPLES) {
      nextTier = "tier1";
      confirmedSince = new Date();
    }
  }

  if (nextTier === "tier1" && confirmedSince) {
    const daysConfirmed = (Date.now() - confirmedSince.getTime()) / (1000 * 60 * 60 * 24);
    if (daysConfirmed >= TIER2_MIN_DAYS_SINCE_CONFIRMED) {
      nextTier = "tier2";
      // confirmedSince stays as the original tier1 date — it represents how
      // long residency has been confirmed overall, not a per-tier timestamp.
    }
  }

  if (nextTier === residency.verificationTier) {
    return residency;
  }

  const [updated] = await prisma.$transaction([
    prisma.userAreaResidency.update({
      where: { userId_areaId: { userId, areaId } },
      data: { verificationTier: nextTier, confirmedSince, trustWeight: TRUST_WEIGHT_BY_TIER[nextTier] },
    }),
    prisma.verificationEvent.create({
      data: { userId, areaId, eventType: "tier_upgrade", sampledAtNight: false },
    }),
  ]);

  return updated;
}

export type GpsSampleResult =
  | { accepted: true; residency: Awaited<ReturnType<typeof recomputeResidencyTier>> }
  | { accepted: false; reason: "area_not_found" | "outside_area" };

// Derive-and-discard, per files/HANDOFF.md §2.1: lat/lng only ever exist as
// function-local values here to compute the geofence check — they are never
// written to any column. Only the boolean outcome (sampledAtNight) and the
// area/user/timestamp are persisted, on the append-only VerificationEvent
// log, which UserAreaResidency (the derived summary) is computed from.
export async function recordGpsSample(userId: string, areaId: string, lat: number, lng: number): Promise<GpsSampleResult> {
  const area = await prisma.area.findUnique({ where: { id: areaId } });
  if (!area) {
    return { accepted: false, reason: "area_not_found" };
  }

  const distance = haversineDistanceMeters(lat, lng, area.geoCentroidLat, area.geoCentroidLng);
  if (distance > area.geoRadiusMeters) {
    return { accepted: false, reason: "outside_area" };
  }

  // upsert() isn't guaranteed atomic under concurrent callers (two samples
  // for the same user+area landing in the same instant — realistic here,
  // since MyContributions fires one request per residency in a tight loop,
  // and even a single page can double-fire in dev under React StrictMode).
  // If a concurrent request already created the row, P2002 just means the
  // desired end state — a residency row existing — is already achieved.
  try {
    await prisma.userAreaResidency.upsert({
      where: { userId_areaId: { userId, areaId } },
      update: {},
      create: { userId, areaId, verificationTier: "tier0", trustWeight: TRUST_WEIGHT_BY_TIER.tier0 },
    });
  } catch (err) {
    const isDuplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (!isDuplicate) throw err;
  }

  await prisma.verificationEvent.create({
    data: { userId, areaId, eventType: "gps_sample", sampledAtNight: isNightInNigeria(new Date()) },
  });

  const residency = await recomputeResidencyTier(userId, areaId);
  return { accepted: true, residency };
}
