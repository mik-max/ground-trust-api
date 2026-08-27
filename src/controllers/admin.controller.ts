import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import prisma from "../config/prisma";
import { recomputeReviewAspects } from "../services/scoring.service";

// Government accounts are never self-service — an authenticated admin
// provisions them directly, per files/HANDOFF.md §2.5. No invite-email flow
// yet; that's a reasonable follow-up once there's a real admin UI.
export async function listGovernmentAccounts(_req: Request, res: Response) {
  const accounts = await prisma.user.findMany({
    where: { role: "government" },
    select: { id: true, fullName: true, email: true, createdAt: true },
  });
  return res.json({ accounts });
}

export async function createGovernmentAccount(req: Request, res: Response) {
  const { fullName, email, password } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: "fullName, email, and password are required" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const account = await prisma.user.create({
    data: { fullName, email, passwordHash, role: "government", authProvider: "email" },
  });

  return res.status(201).json({
    account: { id: account.id, fullName: account.fullName, email: account.email },
  });
}

// files/ADDENDUM.md §3 — the human-in-the-loop half of the two-layer
// moderation design. "At MVP scale this can be a simple admin list view,
// not a workflow engine" — so no assignment, no state beyond
// pending/approved/rejected.
export async function listPendingReviews(_req: Request, res: Response) {
  const reviews = await prisma.review.findMany({
    where: { moderationStatus: "pending" },
    orderBy: { submittedAt: "asc" },
    include: {
      user: { select: { id: true, fullName: true } },
      area: { select: { id: true, name: true, city: true, state: true } },
    },
  });
  return res.json({ reviews });
}

export async function moderateReview(req: Request, res: Response) {
  const { id } = req.params;
  const { decision } = req.body as { decision?: "approved" | "rejected" };

  if (decision !== "approved" && decision !== "rejected") {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
  }

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) {
    return res.status(404).json({ error: "Review not found" });
  }
  if (review.moderationStatus !== "pending") {
    return res.status(409).json({ error: "This review has already been moderated" });
  }

  const updated = await prisma.review.update({
    where: { id },
    data: { moderationStatus: decision },
  });

  // Only matters for "approved" (a rejected review was never counted and
  // stays that way), but recomputing unconditionally is simpler and correct
  // either way — recomputeAreaScore just reflects whatever's in the DB now.
  await recomputeReviewAspects(updated);

  return res.json({ review: updated });
}
