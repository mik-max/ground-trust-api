import { Router } from "express";
import { getVerificationStatus, postGpsSample } from "../controllers/verification.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { gpsSampleLimiter } from "../middleware/rateLimit";

const router = Router();

router.get("/status", requireAuth, requireRole("resident"), getVerificationStatus);
router.post("/gps-sample", requireAuth, requireRole("resident"), gpsSampleLimiter, postGpsSample);

export default router;
