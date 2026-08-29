import { Router } from "express";
import {
  createGovernmentAccount,
  listGovernmentAccounts,
  listPendingAreas,
  listPendingReviews,
  moderateArea,
  moderateReview,
} from "../controllers/admin.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth, requireRole("admin"));
router.get("/government-accounts", listGovernmentAccounts);
router.post("/government-accounts", createGovernmentAccount);
router.get("/reviews/pending", listPendingReviews);
router.post("/reviews/:id/moderate", moderateReview);
router.get("/areas/pending", listPendingAreas);
router.post("/areas/:id/moderate", moderateArea);

export default router;
