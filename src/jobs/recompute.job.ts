import cron from "node-cron";
import prisma from "../config/prisma";
import { Aspect } from "../generated/prisma";
import { recomputeAreaScore } from "../services/scoring.service";
import { recomputeResidencyTier } from "../services/verification.service";

const ASPECTS: Aspect[] = ["power", "water", "security", "roads_flooding", "accessibility"];

// files/HANDOFF.md §4.3: "Run on a schedule (e.g. nightly) ... if recompute
// cost is acceptable at MVP scale" — the actual missing piece before this
// job existed. recomputeAreaScore already ran per-review (immediate
// feedback), but an area with zero *new* reviews in a given week never got
// recomputed at all, so its flag streak could never advance from calendar
// time passing alone — only from review-submission coincidence. This sweep
// calls recomputeAreaScore for every area/aspect regardless of new
// activity, which is what actually makes "weeks persistent" mean weeks.
//
// scoring.service.ts's bumpFlagStreak() keeps its own 7-day gate rather
// than being stripped out — with this job now driving weekly calls, the
// gate is redundant for the job's own invocations (~7 days apart by
// construction) but still guards against an interleaved on-demand,
// review-triggered call double-bumping the streak within the same week.
//
// Same underlying gap exists for UserAreaResidency: reaching the tier2
// day-threshold, or a status lapsing when night-time checks stop, are both
// calendar-time transitions (files/HANDOFF.md §2.1) that no incoming ping
// would trigger, so they're swept here too.
export async function recomputeAll(): Promise<void> {
  // Tiers first, so the score sweep below already weighs every rating by
  // its author's up-to-date status. All confirmed tiers are swept, not just
  // tier1: tier2 can now fall back when night-time presence stops.
  const confirmedResidencies = await prisma.userAreaResidency.findMany({
    where: { verificationTier: { in: ["tier1", "tier2"] } },
    select: { userId: true, areaId: true },
  });
  for (const r of confirmedResidencies) {
    try {
      await recomputeResidencyTier(r.userId, r.areaId);
    } catch (err) {
      console.error(`[recompute-job] Tier recompute failed for user ${r.userId} / area ${r.areaId}:`, err);
    }
  }

  const areas = await prisma.area.findMany({ select: { id: true } });
  for (const area of areas) {
    for (const aspect of ASPECTS) {
      try {
        await recomputeAreaScore(area.id, aspect);
      } catch (err) {
        console.error(`[recompute-job] Failed for area ${area.id} / ${aspect}:`, err);
      }
    }
  }
}

// Sunday 3am, Africa/Lagos — a real weekly cadence, not the review-driven
// approximation. A failure here must never crash the server process; every
// per-item error above is already caught, so this only guards the sweep
// functions' own top-level queries.
export function startScheduledJobs(): void {
  cron.schedule(
    "0 3 * * 0",
    async () => {
      console.log("[recompute-job] Starting weekly recompute sweep...");
      try {
        await recomputeAll();
        console.log("[recompute-job] Weekly recompute sweep finished.");
      } catch (err) {
        console.error("[recompute-job] Weekly recompute sweep failed:", err);
      }
    },
    { timezone: "Africa/Lagos" }
  );
}
