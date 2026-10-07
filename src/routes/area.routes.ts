import { Router } from "express";
import {
  createArea,
  createReview,
  findNearestArea,
  getArea,
  getAreaReviews,
  listAreas,
} from "../controllers/area.controller";
import { uploadPhoto } from "../config/upload";
import { addAreaPhoto } from "../controllers/photo.controller";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth.middleware";
import { areaProposalLimiter, reviewLimiter, uploadLimiter } from "../middleware/rateLimit";

const router = Router();

router.get("/", listAreas);
router.get("/nearest", findNearestArea);
router.post("/", requireAuth, requireRole("resident"), areaProposalLimiter, createArea);
router.get("/:id", optionalAuth, getArea);
router.get("/:id/reviews", optionalAuth, getAreaReviews);
router.post("/:id/reviews", requireAuth, requireRole("resident"), reviewLimiter, createReview);
// Errors from uploadPhoto (too large, wrong type) reach app.ts's error handler via multer.
router.post("/:id/photos", requireAuth, requireRole("resident"), uploadLimiter, uploadPhoto.single("photo"), addAreaPhoto);

export default router;
