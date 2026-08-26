import { Router } from "express";
import { uploadAudio } from "../config/upload";
import { handleAudioUpload } from "../controllers/upload.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

// Errors from uploadAudio (file too large, wrong mimetype) are passed to
// next(err) by multer itself and caught by app.ts's error-handling
// middleware — no manual wrapping needed here.
router.post("/audio", requireAuth, requireRole("resident"), uploadAudio.single("audio"), handleAudioUpload);

export default router;
