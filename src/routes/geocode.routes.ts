import { Router } from "express";
import { searchLocations } from "../controllers/geocode.controller";
import { geocodeLimiter } from "../middleware/rateLimit";

const router = Router();

router.get("/search", geocodeLimiter, searchLocations);

export default router;
