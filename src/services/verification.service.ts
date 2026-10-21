import prisma from "../config/prisma";
import { Prisma, VerificationTier } from "../generated/prisma";
import {
  ASPECTS,
  GPS_MAX_ACCURACY_METERS,
  GPS_MAX_TRAVEL_KMH,
  GPS_MIN_INTERVAL_MINUTES,
  MAX_CONFIRMED_AREAS,
  NIGERIA_UTC_OFFSET_HOURS,
  NIGHT_END_HOUR,
  NIGHT_START_HOUR,
  RESIDENCY_LAPSE_DAYS,
  TIER1_MIN_NIGHTS,
  TIER1_WINDOW_DAYS,
  TIER2_MIN_DAYS_SINCE_CONFIRMED,
  TIER2_RECENT_NIGHT_DAYS,
  TRUST_WEIGHT_BY_TIER,
} from "../config/constants";
import { recomputeAreaScore } from "./scoring.service";

const EARTH_RADIUS_METERS = 6371000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIRMED_TIERS: VerificationTier[] = ["tier1", "tier2", "tier3"];

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

// A night runs 9pm–6am local time, so checks either side of midnight belong
// to the same night: shifting by the 6am end hour maps them all to the date
// the night began on.
export function nightKey(date: Date): string {
  const shifted = new Date(date.getTime() + (NIGERIA_UTC_OFFSET_HOURS - NIGHT_END_HOUR) * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export interface TierEvidence {
  currentTier: VerificationTier;
  confirmedSince: Date | null;
  nightChecks: Date[];
  otherConfirmedAreas: number;
  now: Date;
}

// files/HANDOFF.md §2.1, tightened. The tier is derived from the evidence
// each time rather than only ever moving up, so it can also fall when the
// presence behind it stops:
//   tier0 -> tier1  on TIER1_MIN_NIGHTS distinct nights within the last
//                   TIER1_WINDOW_DAYS, if the account doesn't already hold
//                   MAX_CONFIRMED_AREAS other confirmed areas;
//   tier1 -> tier2  once confirmed TIER2_MIN_DAYS_SINCE_CONFIRMED days and
//                   seen at night within TIER2_RECENT_NIGHT_DAYS;
//   tier2 -> tier1  when not seen at night for TIER2_RECENT_NIGHT_DAYS;
//   tier1+ -> tier0 when not seen at night for RESIDENCY_LAPSE_DAYS.
// tier3 (document-verified, future work) is never changed here.
export function deriveTier(e: TierEvidence): { tier: VerificationTier; confirmedSince: Date | null } {
  if (e.currentTier === "tier3") {
    return { tier: "tier3", confirmedSince: e.confirmedSince };
  }

  const nowMs = e.now.getTime();
  const lastNight = e.nightChecks.reduce<number | null>((max, d) => (max === null || d.getTime() > max ? d.getTime() : max), null);

  if (e.currentTier === "tier1" || e.currentTier === "tier2") {
    if (lastNight === null || nowMs - lastNight > RESIDENCY_LAPSE_DAYS * DAY_MS || !e.confirmedSince) {
      return { tier: "tier0", confirmedSince: null };
    }
    const confirmedDays = (nowMs - e.confirmedSince.getTime()) / DAY_MS;
    const seenRecently = nowMs - lastNight <= TIER2_RECENT_NIGHT_DAYS * DAY_MS;
    const tier = confirmedDays >= TIER2_MIN_DAYS_SINCE_CONFIRMED && seenRecently ? "tier2" : "tier1";
    return { tier, confirmedSince: e.confirmedSince };
  }

  const recentNights = new Set(
    e.nightChecks.filter((d) => nowMs - d.getTime() <= TIER1_WINDOW_DAYS * DAY_MS).map(nightKey)
  );
  if (recentNights.size >= TIER1_MIN_NIGHTS && e.otherConfirmedAreas < MAX_CONFIRMED_AREAS) {
    return { tier: "tier1", confirmedSince: e.now };
  }
  return { tier: "tier0", confirmedSince: null };
}

const TIER_RANK: Record<VerificationTier, number> = { tier0: 0, tier1: 1, tier2: 2, tier3: 3 };

export async function recomputeResidencyTier(userId: string, areaId: string) {
  const residency = await prisma.userAreaResidency.findUniqueOrThrow({
    where: { userId_areaId: { userId, areaId } },
  });

  const [nightEvents, otherConfirmedAreas] = await Promise.all([
    prisma.verificationEvent.findMany({
      where: { userId, areaId, eventType: "gps_sample", sampledAtNight: true },
      select: { createdAt: true },
    }),
    prisma.userAreaResidency.count({
      where: { userId, areaId: { not: areaId }, verificationTier: { in: CONFIRMED_TIERS } },
    }),
  ]);

  const next = deriveTier({
    currentTier: residency.verificationTier,
    confirmedSince: residency.confirmedSince,
    nightChecks: nightEvents.map((e) => e.createdAt),
    otherConfirmedAreas,
    now: new Date(),
  });

  if (next.tier === residency.verificationTier) {
    return residency;
  }

  const upgraded = TIER_RANK[next.tier] > TIER_RANK[residency.verificationTier];
  const [updated] = await prisma.$transaction([
    prisma.userAreaResidency.update({
      where: { userId_areaId: { userId, areaId } },
      data: { verificationTier: next.tier, confirmedSince: next.confirmedSince, trustWeight: TRUST_WEIGHT_BY_TIER[next.tier] },
    }),
    prisma.verificationEvent.create({
      data: {
        userId,
        areaId,
        eventType: upgraded ? "tier_upgrade" : "tier_downgrade",
        sampledAtNight: false,
        detail: `${residency.verificationTier} -> ${next.tier}`,
      },
    }),
  ]);

  // The area's scores weight each rating by its author's current tier, so
  // they're refreshed now instead of waiting for the weekly sweep.
  for (const aspect of ASPECTS) {
    await recomputeAreaScore(areaId, aspect);
  }

  return updated;
}

export type GpsRejection = "imprecise" | "implausible_coordinates" | "impossible_travel" | "outside_area";

export type GpsSampleResult =
  | { accepted: true; residency: Awaited<ReturnType<typeof recomputeResidencyTier>> }
  | { accepted: false; reason: "area_not_found" | GpsRejection };

// A real device reports coordinates to many decimal places; values with
// three or fewer on both axes (~110m steps) are what typed-in fakes look like.
function looksHandTyped(lat: number, lng: number): boolean {
  const coarse = (v: number) => Math.round(v * 1000) / 1000 === v;
  return coarse(lat) && coarse(lng);
}

// Shortest possible distance between two areas: centroid distance minus both
// radii, so two overlapping areas are 0m apart (one reading can sit in both).
function minDistanceBetweenAreasMeters(
  a: { geoCentroidLat: number; geoCentroidLng: number; geoRadiusMeters: number },
  b: { geoCentroidLat: number; geoCentroidLng: number; geoRadiusMeters: number }
): number {
  const centres = haversineDistanceMeters(a.geoCentroidLat, a.geoCentroidLng, b.geoCentroidLat, b.geoCentroidLng);
  return Math.max(0, centres - a.geoRadiusMeters - b.geoRadiusMeters);
}

// Derive-and-discard, per files/HANDOFF.md §2.1: lat/lng/accuracy only ever
// exist as function-local values here — they are never written to any
// column. Only the outcome (accepted at night or not, or the reason it was
// refused) and the area/user/timestamp are persisted, on the append-only
// VerificationEvent log, which UserAreaResidency (the derived summary) is
// computed from.
export async function recordGpsSample(
  userId: string,
  areaId: string,
  lat: number,
  lng: number,
  accuracy: number
): Promise<GpsSampleResult> {
  const area = await prisma.area.findUnique({ where: { id: areaId } });
  if (!area) {
    return { accepted: false, reason: "area_not_found" };
  }

  const reject = async (reason: GpsRejection): Promise<GpsSampleResult> => {
    await prisma.verificationEvent.create({
      data: { userId, areaId, eventType: "gps_rejected", sampledAtNight: false, detail: reason },
    });
    return { accepted: false, reason };
  };

  if (accuracy > Math.min(GPS_MAX_ACCURACY_METERS, area.geoRadiusMeters)) {
    return reject("imprecise");
  }
  if (looksHandTyped(lat, lng)) {
    return reject("implausible_coordinates");
  }
  if (haversineDistanceMeters(lat, lng, area.geoCentroidLat, area.geoCentroidLng) > area.geoRadiusMeters) {
    return { accepted: false, reason: "outside_area" };
  }

  const now = new Date();
  const previous = await prisma.verificationEvent.findFirst({
    where: { userId, eventType: "gps_sample" },
    orderBy: { createdAt: "desc" },
    include: { area: { select: { geoCentroidLat: true, geoCentroidLng: true, geoRadiusMeters: true } } },
  });
  if (previous && previous.areaId !== areaId) {
    const hours = Math.max((now.getTime() - previous.createdAt.getTime()) / (60 * 60 * 1000), 1 / 60);
    const km = minDistanceBetweenAreasMeters(previous.area, area) / 1000;
    if (km / hours > GPS_MAX_TRAVEL_KMH) {
      return reject("impossible_travel");
    }
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

  const recentSame = await prisma.verificationEvent.findFirst({
    where: {
      userId,
      areaId,
      eventType: "gps_sample",
      createdAt: { gte: new Date(now.getTime() - GPS_MIN_INTERVAL_MINUTES * 60 * 1000) },
    },
  });
  if (!recentSame) {
    await prisma.verificationEvent.create({
      data: { userId, areaId, eventType: "gps_sample", sampledAtNight: isNightInNigeria(now) },
    });
  }

  const residency = await recomputeResidencyTier(userId, areaId);
  return { accepted: true, residency };
}
