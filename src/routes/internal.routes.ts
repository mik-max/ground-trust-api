import { Router } from "express";
import { triggerNlpProcess, triggerRecomputeAll } from "../controllers/internal.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.post("/nlp/process", requireAuth, requireRole("admin"), triggerNlpProcess);
router.post("/recompute-all", requireAuth, requireRole("admin"), triggerRecomputeAll);

export default router;
