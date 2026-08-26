import { Router } from "express";
import { getVerificationStatus } from "../controllers/verification.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.get("/status", requireAuth, requireRole("resident"), getVerificationStatus);

export default router;
