import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  summary, listInventory, updateInventory, listOrders, listPaymentReviews, orderNotificationHealth, sendAdminTestEmail,
  updateOrderStatus, refundPaymentReview, checkPaymentProvider,
  listStaff, createStaff, resendStaffInvitation, setStaffActive, assignOrderStaff,
} from '../controllers/adminController.js';
import { listAdminIssues, updateIssue } from '../controllers/issueController.js';

const router = Router();
const notificationTestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many test emails. Please wait before trying again.' },
});
const staffInvitationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many staff invitations. Please wait before trying again.' },
});
router.use(requireAuth, requireAdmin);
router.get('/summary', summary);
router.get('/payment-provider-check', checkPaymentProvider);
router.get('/inventory', listInventory);
router.patch('/inventory/:key', updateInventory);
router.get('/orders', listOrders);
router.get('/staff', listStaff);
router.post('/staff', staffInvitationLimiter, createStaff);
router.post('/staff/:id/invitation', staffInvitationLimiter, resendStaffInvitation);
router.patch('/staff/:id/active', setStaffActive);
router.patch('/orders/:id/assignments', assignOrderStaff);
router.get('/payment-reviews', listPaymentReviews);
router.get('/notification-health', orderNotificationHealth);
router.post('/test-email', notificationTestLimiter, sendAdminTestEmail);
router.get('/issues', listAdminIssues);
router.patch('/issues/:id', updateIssue);
router.patch('/orders/:id/status', updateOrderStatus);
router.post('/orders/:id/refund', refundPaymentReview);
export default router;
