import { Router } from "express";
import { triggerNlpProcess } from "../controllers/internal.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.post("/nlp/process", requireAuth, requireRole("admin"), triggerNlpProcess);

export default router;
