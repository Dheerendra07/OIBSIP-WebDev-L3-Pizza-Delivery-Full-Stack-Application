import { Router } from 'express';
import { requireAuth, requireOperationsStaff } from '../middleware/auth.js';
import { listOpsOrders, updateOpsOrderStatus } from '../controllers/opsController.js';

const router = Router();
router.use(requireAuth, requireOperationsStaff);
router.get('/orders', listOpsOrders);
router.patch('/orders/:id/status', updateOpsOrderStatus);
export default router;
