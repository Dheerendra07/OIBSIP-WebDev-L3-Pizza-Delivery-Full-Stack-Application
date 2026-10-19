import { Router } from 'express';
import { getCatalog } from '../controllers/catalogController.js';
const router = Router(); router.get('/', getCatalog); export default router;
