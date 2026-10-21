import { Request, Response } from "express";
import prisma from "../config/prisma";
import { Aspect, FlagResponseStatus } from "../generated/prisma";
import { MIN_WEEKS_PERSISTENT_FOR_DISPLAY } from "../services/scoring.service";
import { trackReq } from "../services/activity.service";

// Areas whose ratings include seeded demo accounts, so a flag raised on them
// is labelled "Demo data" rather than read as a real residents' report.
async function areasWithDemoRatings(areaIds: string[]): Promise<Set<string>> {
  const rows = await prisma.review.findMany({
    where: { areaId: { in: areaIds }, moderationStatus: "approved", user: { isDemo: true } },
    select: { areaId: true },
    distinct: ["areaId"],
  });
  return new Set(rows.map((r) => r.areaId));
}

// Only surfaces flags that have actually persisted for
// MIN_WEEKS_PERSISTENT — earlier streaks exist in the Flag table for
// internal tracking (see scoring.service.ts) but aren't shown to
// government yet, per files/HANDOFF.md §2.5's persistence requirement.
export async function listFlags(req: Request, res: Response) {
  const aspect = typeof req.query.aspect === "string" ? (req.query.aspect as Aspect) : undefined;

  const flags = await prisma.flag.findMany({
    where: {
      resolved: false,
      consecutiveWeeksBelowThreshold: { gte: MIN_WEEKS_PERSISTENT_FOR_DISPLAY },
      ...(aspect ? { aspect } : {}),
    },
    include: {
      area: { select: { id: true, name: true, city: true, state: true } },
      respondedBy: { select: { id: true, fullName: true } },
    },
    orderBy: { consecutiveWeeksBelowThreshold: "desc" },
  });
  const demoAreas = await areasWithDemoRatings(flags.map((f) => f.areaId));

  return res.json({ flags: flags.map((f) => ({ ...f, isDemo: demoAreas.has(f.areaId) })) });
}

export async function getFlag(req: Request, res: Response) {
  const { id } = req.params;

  const flag = await prisma.flag.findUnique({
    where: { id },
    include: { area: true, respondedBy: { select: { id: true, fullName: true } } },
  });
  if (!flag) {
    return res.status(404).json({ error: "Flag not found" });
  }
  const demoAreas = await areasWithDemoRatings([flag.areaId]);

  return res.json({ flag: { ...flag, isDemo: demoAreas.has(flag.areaId) } });
}

const RESPONSE_STATUSES: FlagResponseStatus[] = ["acknowledged", "in_progress"];

// Government's acknowledgement of a flag: "we've seen this" or "action is in
// progress", plus an optional note. This never resolves the flag — only
// residents' scores recovering does that (scoring.service.ts), so the
// resident signal stays the source of truth.
export async function respondToFlag(req: Request, res: Response) {
  const { id } = req.params;
  const { status, note } = req.body as { status?: FlagResponseStatus; note?: string };

  if (!status || !RESPONSE_STATUSES.includes(status)) {
    return res.status(400).json({ error: "status must be 'acknowledged' or 'in_progress'" });
  }
  if (note !== undefined && typeof note !== "string") {
    return res.status(400).json({ error: "note must be a string" });
  }

  const flag = await prisma.flag.findUnique({ where: { id } });
  if (!flag) {
    return res.status(404).json({ error: "Flag not found" });
  }
  if (flag.resolved) {
    return res.status(409).json({ error: "This flag has already been resolved" });
  }

  const updated = await prisma.flag.update({
    where: { id },
    data: {
      responseStatus: status,
      responseNote: note?.trim() || null,
      respondedAt: new Date(),
      respondedByUserId: req.auth!.userId,
    },
    include: {
      area: { select: { id: true, name: true, city: true, state: true } },
      respondedBy: { select: { id: true, fullName: true } },
    },
  });

  trackReq(req, "flag_responded", { areaId: updated.areaId, meta: { status, aspect: updated.aspect } });
  return res.json({ flag: updated });
}
