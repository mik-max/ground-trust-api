import { Router } from "express";
import { createReview, findNearestArea, getArea, getAreaReviews, listAreas } from "../controllers/area.controller";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.get("/", listAreas);
router.get("/nearest", findNearestArea);
router.get("/:id", getArea);
router.get("/:id/reviews", optionalAuth, getAreaReviews);
router.post("/:id/reviews", requireAuth, requireRole("resident"), createReview);

export default router;
