import { Router } from "express";
import { getVerificationStatus, postGpsSample } from "../controllers/verification.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.get("/status", requireAuth, requireRole("resident"), getVerificationStatus);
router.post("/gps-sample", requireAuth, requireRole("resident"), postGpsSample);

export default router;
