import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { summary, listInventory, updateInventory, listOrders, listPaymentReviews, updateOrderStatus, refundPaymentReview } from '../controllers/adminController.js';
const router = Router(); router.use(requireAuth, requireAdmin); router.get('/summary', summary); router.get('/inventory', listInventory); router.patch('/inventory/:key', updateInventory); router.get('/orders', listOrders); router.get('/payment-reviews', listPaymentReviews); router.patch('/orders/:id/status', updateOrderStatus); router.post('/orders/:id/refund', refundPaymentReview); export default router;
