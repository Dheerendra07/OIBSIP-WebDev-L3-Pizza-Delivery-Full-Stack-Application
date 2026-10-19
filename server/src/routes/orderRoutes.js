import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createOrder, myOrders, getOrder } from '../controllers/orderController.js';
const router = Router(); router.use(requireAuth); router.post('/', createOrder); router.get('/my', myOrders); router.get('/:id', getOrder); export default router;
