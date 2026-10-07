import { Router } from "express";
import { forgotPassword, googleAuth, login, resetPassword, signup } from "../controllers/auth.controller";
import { authLimiter, forgotEmailLimiter, forgotIpLimiter, loginAccountLimiter, resetLimiter } from "../middleware/rateLimit";

const router = Router();

router.post("/signup", authLimiter, signup);
router.post("/login", authLimiter, loginAccountLimiter, login);
router.post("/google", authLimiter, googleAuth);
router.post("/forgot-password", forgotIpLimiter, forgotEmailLimiter, forgotPassword);
router.post("/reset-password", resetLimiter, resetPassword);

export default router;
