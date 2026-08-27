import { Aspect } from "../generated/prisma";

export const ASPECTS: Aspect[] = ["power", "water", "security", "roads_flooding", "accessibility"];

// Review's rating columns are one-per-aspect (files/HANDOFF.md §4.1) rather
// than a single JSON blob, so every place that reads/writes a rating by
// aspect needs this mapping — centralized here since it had drifted into
// four separate copies (area/admin controllers, scoring/nlp services).
export const RATING_FIELD_BY_ASPECT: Record<Aspect, "ratingPower" | "ratingWater" | "ratingSecurity" | "ratingRoadsFlooding" | "ratingAccessibility"> = {
  power: "ratingPower",
  water: "ratingWater",
  security: "ratingSecurity",
  roads_flooding: "ratingRoadsFlooding",
  accessibility: "ratingAccessibility",
};

// Flag-engine / confidence thresholds, per files/ADDENDUM.md §2. Deliberately
// read from env with these values as fallback defaults, so they're tunable
// post-launch without a redeploy.

export const MIN_N_FOR_FLAG = Number(process.env.MIN_N_FOR_FLAG ?? 8);
export const MIN_N_MEDIUM = Number(process.env.MIN_N_MEDIUM ?? 5);
export const MIN_N_HIGH = Number(process.env.MIN_N_HIGH ?? 15);
export const FLAG_THRESHOLD = Number(process.env.FLAG_THRESHOLD ?? 2.0);
export const MIN_WEEKS_PERSISTENT = Number(process.env.MIN_WEEKS_PERSISTENT ?? 4);

// All five aspects are flaggable — security is simply the primary one by
// project direction, not a schema-level distinction (files/HANDOFF.md §2.5.4).
export const FLAGGABLE_ASPECTS = ASPECTS;

// Tier -> trust weight multiplier, per files/HANDOFF.md §2.1.
export const TRUST_WEIGHT_BY_TIER = {
  tier0: 0.3,
  tier1: 0.7,
  tier2: 1.0,
  tier3: 1.2,
} as const;

// Tier-progression thresholds, per files/HANDOFF.md §2.1. Starting values —
// tune post-launch like the flag-engine thresholds above. HANDOFF gives an
// explicit number for tier2 ("60+ days") but not tier1 ("repeated... samples")
// — TIER1_MIN_NIGHT_SAMPLES is this project's own reasonable starting point.
export const TIER1_MIN_NIGHT_SAMPLES = Number(process.env.TIER1_MIN_NIGHT_SAMPLES ?? 5);
export const TIER2_MIN_DAYS_SINCE_CONFIRMED = Number(process.env.TIER2_MIN_DAYS_SINCE_CONFIRMED ?? 60);

// Nigeria runs a single fixed offset (WAT, UTC+1, no DST) — cheaper and more
// robust than a timezone library or trusting a client-supplied timestamp for
// a signal that feeds trust weighting.
export const NIGERIA_UTC_OFFSET_HOURS = 1;
export const NIGHT_START_HOUR = 21; // 9pm local
export const NIGHT_END_HOUR = 6; // 6am local

// Reverse lookup for displaying the tier a review was submitted at (reviews
// only store the snapshotted weight, not the tier label, per files/HANDOFF.md
// §4.1's trustWeightAtSubmission field).
export function tierFromWeight(weight: number): keyof typeof TRUST_WEIGHT_BY_TIER {
  const entries = Object.entries(TRUST_WEIGHT_BY_TIER) as [keyof typeof TRUST_WEIGHT_BY_TIER, number][];
  const closest = entries.reduce((best, [tier, w]) =>
    Math.abs(w - weight) < Math.abs(TRUST_WEIGHT_BY_TIER[best] - weight) ? tier : best
  , entries[0][0]);
  return closest;
}
