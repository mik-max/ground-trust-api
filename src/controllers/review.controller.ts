import { Request, Response } from "express";
import prisma from "../config/prisma";
import { Prisma, ReviewReportReason } from "../generated/prisma";

const REASONS: ReviewReportReason[] = ["false_information", "offensive", "spam", "other"];
const MAX_NOTE_LENGTH = 500;

// Any signed-in user can report a public review once. The report doesn't
// hide the review — it queues it for an administrator (see
// admin.controller.ts's listReportedReviews), so a report can't be used to
// silence a true review on its own.
export async function reportReview(req: Request, res: Response) {
  const { id } = req.params;
  const userId = req.auth!.userId;
  const { reason, note } = req.body as { reason?: ReviewReportReason; note?: string };

  if (!reason || !REASONS.includes(reason)) {
    return res.status(400).json({ error: "reason must be one of: false_information, offensive, spam, other" });
  }
  if (note !== undefined && (typeof note !== "string" || note.length > MAX_NOTE_LENGTH)) {
    return res.status(400).json({ error: `note must be a string of at most ${MAX_NOTE_LENGTH} characters` });
  }

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review || review.moderationStatus !== "approved") {
    return res.status(404).json({ error: "Review not found" });
  }
  if (review.userId === userId) {
    return res.status(400).json({ error: "You can't report your own review" });
  }

  try {
    const report = await prisma.reviewReport.create({
      data: { reviewId: id, reporterUserId: userId, reason, note: note?.trim() || null },
    });
    return res.status(201).json({ report: { id: report.id, reason: report.reason } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "You have already reported this review" });
    }
    throw err;
  }
}
