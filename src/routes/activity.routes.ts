import { Router } from "express";
import { recordClientEvent } from "../controllers/activity.controller";
import { optionalAuth } from "../middleware/auth.middleware";
import { activityLimiter } from "../middleware/rateLimit";

const router = Router();

router.post("/", activityLimiter, optionalAuth, recordClientEvent);

export default router;
