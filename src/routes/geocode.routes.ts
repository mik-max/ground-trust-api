import { Router } from "express";
import { searchLocations } from "../controllers/geocode.controller";

const router = Router();

router.get("/search", searchLocations);

export default router;
