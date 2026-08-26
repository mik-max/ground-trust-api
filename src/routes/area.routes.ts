import { Router } from "express";
import { createReview, getArea, getAreaReviews, listAreas } from "../controllers/area.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.get("/", listAreas);
router.get("/:id", getArea);
router.get("/:id/reviews", getAreaReviews);
router.post("/:id/reviews", requireAuth, requireRole("resident"), createReview);

export default router;
