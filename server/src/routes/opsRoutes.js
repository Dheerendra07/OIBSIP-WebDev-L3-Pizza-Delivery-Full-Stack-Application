import { Router } from 'express';
import { requireAuth, requireOperationsStaff } from '../middleware/auth.js';
import { listOpsOrders, updateOpsOrderStatus, requestDeliveryConfirmation } from '../controllers/opsController.js';

const router = Router();
router.use(requireAuth, requireOperationsStaff);
router.get('/orders', listOpsOrders);
router.patch('/orders/:id/status', updateOpsOrderStatus);
router.post('/orders/:id/request-delivery-confirmation', requestDeliveryConfirmation);
export default router;
