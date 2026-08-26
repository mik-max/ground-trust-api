import { Router } from "express";
import { createGovernmentAccount, listGovernmentAccounts } from "../controllers/admin.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth, requireRole("admin"));
router.get("/government-accounts", listGovernmentAccounts);
router.post("/government-accounts", createGovernmentAccount);

export default router;
