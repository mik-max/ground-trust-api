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
export const FLAGGABLE_ASPECTS = [
  "power",
  "water",
  "security",
  "roads_flooding",
  "accessibility",
] as const;

// Tier -> trust weight multiplier, per files/HANDOFF.md §2.1.
export const TRUST_WEIGHT_BY_TIER = {
  tier0: 0.3,
  tier1: 0.7,
  tier2: 1.0,
  tier3: 1.2,
} as const;

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
