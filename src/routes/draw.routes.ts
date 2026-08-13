import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { executeDraw } from '../controllers/draw.controller';

const router = Router();

router.post('/:id/draw', protect, executeDraw);

export default router;
