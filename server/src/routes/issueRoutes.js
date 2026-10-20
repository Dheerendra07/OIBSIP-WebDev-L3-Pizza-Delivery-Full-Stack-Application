import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createIssue, myIssues } from '../controllers/issueController.js';

const router = Router();
router.use(requireAuth);
router.get('/my', myIssues);
router.post('/', createIssue);
export default router;
