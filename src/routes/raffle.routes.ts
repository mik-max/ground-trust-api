import { Router } from 'express';
import { listRaffles, getRaffle, createRaffle, getMyRaffles } from '../controllers/raffle.controller';
import { protect } from '../middleware/auth.middleware';

const router = Router();

router.get('/', listRaffles);
router.post('/', protect, createRaffle);
router.get('/mine', protect, getMyRaffles);
router.get('/:id', getRaffle);

export default router;
