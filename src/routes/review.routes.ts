import { Router } from "express";
import { reportReview } from "../controllers/review.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { reportLimiter } from "../middleware/rateLimit";

const router = Router();

router.post("/:id/report", requireAuth, reportLimiter, reportReview);

export default router;
