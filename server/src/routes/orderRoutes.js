import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createOrder, myOrders, getOrder, updateDeliveryDetails, confirmDelivery } from '../controllers/orderController.js';
const router = Router(); router.use(requireAuth); router.post('/', createOrder); router.get('/my', myOrders); router.patch('/:id/delivery-details', updateDeliveryDetails); router.post('/:id/confirm-delivery', confirmDelivery); router.get('/:id', getOrder); export default router;
