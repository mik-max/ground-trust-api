import { Request, Response } from "express";
import prisma from "../config/prisma";

// Current tier + progress per area, for the "My Contributions" screen.
// GPS sampling isn't built yet, so every resident will show tier0 for now —
// the endpoint shape is stable so the frontend doesn't need to change once
// the sampling job (files/HANDOFF.md §2.1) lands.
export async function getVerificationStatus(req: Request, res: Response) {
  const userId = req.auth!.userId;

  const residencies = await prisma.userAreaResidency.findMany({
    where: { userId },
    include: { area: { select: { id: true, name: true, city: true, state: true } } },
  });

  return res.json({ residencies });
}
