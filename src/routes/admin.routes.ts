import { Router } from "express";
import {
  createGovernmentAccount,
  listGovernmentAccounts,
  listPendingAreas,
  listPendingReviews,
  listReportedReviews,
  moderateArea,
  moderateReview,
  resolveReportedReview,
} from "../controllers/admin.controller";
import { listPendingPhotos, moderatePhoto } from "../controllers/photo.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth, requireRole("admin"));
router.get("/government-accounts", listGovernmentAccounts);
router.post("/government-accounts", createGovernmentAccount);
router.get("/reviews/pending", listPendingReviews);
router.post("/reviews/:id/moderate", moderateReview);
router.get("/reviews/reported", listReportedReviews);
router.post("/reviews/:id/reports/resolve", resolveReportedReview);
router.get("/areas/pending", listPendingAreas);
router.post("/areas/:id/moderate", moderateArea);
router.get("/photos/pending", listPendingPhotos);
router.post("/photos/:id/moderate", moderatePhoto);

export default router;
