import { Router } from "express";
import { reportReview } from "../controllers/review.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/:id/report", requireAuth, reportReview);

export default router;
