import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createPaymentOrder, verifyPayment } from '../controllers/orderController.js';
const router = Router(); router.use(requireAuth); router.post('/create-order', createPaymentOrder); router.post('/verify', verifyPayment); export default router;
