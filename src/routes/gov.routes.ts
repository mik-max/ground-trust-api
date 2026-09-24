import { Router } from "express";
import { getFlag, listFlags, respondToFlag } from "../controllers/gov.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth, requireRole("government"));
router.get("/flags", listFlags);
router.get("/flags/:id", getFlag);
router.patch("/flags/:id/response", respondToFlag);

export default router;
