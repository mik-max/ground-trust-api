import { Request, Response } from "express";
import prisma from "../config/prisma";
import { Aspect } from "../generated/prisma";
import { MIN_WEEKS_PERSISTENT_FOR_DISPLAY } from "../services/scoring.service";

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
    include: { area: { select: { id: true, name: true, city: true, state: true } } },
    orderBy: { consecutiveWeeksBelowThreshold: "desc" },
  });

  return res.json({ flags });
}

export async function getFlag(req: Request, res: Response) {
  const { id } = req.params;

  const flag = await prisma.flag.findUnique({
    where: { id },
    include: { area: true },
  });
  if (!flag) {
    return res.status(404).json({ error: "Flag not found" });
  }

  return res.json({ flag });
}
