import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { enterRaffle, getMyEntry, getMyEntries } from '../controllers/entry.controller';

const router = Router();

router.post('/raffles/:id/enter', protect, enterRaffle);
router.get('/raffles/:id/my-entry', protect, getMyEntry);
router.get('/me/entries', protect, getMyEntries);

export default router;
