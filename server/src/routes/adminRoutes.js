import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  summary, listInventory, updateInventory, listOrders, listPaymentReviews, orderNotificationHealth,
  updateOrderStatus, refundPaymentReview, checkPaymentProvider,
  listStaff, createStaff, setStaffActive, assignOrderStaff,
} from '../controllers/adminController.js';
import { listAdminIssues, updateIssue } from '../controllers/issueController.js';

const router = Router();
router.use(requireAuth, requireAdmin);
router.get('/summary', summary);
router.get('/payment-provider-check', checkPaymentProvider);
router.get('/inventory', listInventory);
router.patch('/inventory/:key', updateInventory);
router.get('/orders', listOrders);
router.get('/staff', listStaff);
router.post('/staff', createStaff);
router.patch('/staff/:id/active', setStaffActive);
router.patch('/orders/:id/assignments', assignOrderStaff);
router.get('/payment-reviews', listPaymentReviews);
router.get('/notification-health', orderNotificationHealth);
router.get('/issues', listAdminIssues);
router.patch('/issues/:id', updateIssue);
router.patch('/orders/:id/status', updateOrderStatus);
router.post('/orders/:id/refund', refundPaymentReview);
export default router;
