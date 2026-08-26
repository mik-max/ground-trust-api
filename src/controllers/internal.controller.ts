import { Request, Response } from "express";
import prisma from "../config/prisma";
import { processReview } from "../services/nlp.service";

// files/HANDOFF.md §3 — "internal service interface" for the NLP pipeline.
// createReview already triggers this fire-and-forget on submission; this
// route is the literal POST /internal/nlp/process boundary the doc names,
// useful for re-processing or debugging a specific review. Admin-only —
// it's an operational surface, not something residents/newcomers call.
export async function triggerNlpProcess(req: Request, res: Response) {
  const { reviewId } = req.body as { reviewId?: string };
  if (!reviewId) {
    return res.status(400).json({ error: "reviewId is required" });
  }

  await processReview(reviewId);

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, translatedText: true, originalLanguage: true, nlpAspects: true },
  });
  if (!review) {
    return res.status(404).json({ error: "Review not found" });
  }

  return res.json({ review });
}
