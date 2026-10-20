import mongoose from 'mongoose';
import crypto from 'node:crypto';
import Order from '../models/Order.js';
import OrderIssue from '../models/OrderIssue.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { canReportOrderIssue, normalizeIssueReport, validateIssueUpdate } from '../utils/issueRules.js';
import { publishAdminRefresh } from '../services/realtime.js';

function summaryOrder(order) {
  if (!order) return null;
  const id = String(order._id || order.id || order);
  if (!order.orderNumber) return { id };
  return {
    id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: order.total,
    paymentStatus: order.paymentStatus,
  };
}

function serializeIssue(issue, { includeUser = false } = {}) {
  const raw = issue?.toObject ? issue.toObject() : issue;
  if (!raw) return null;
  const populatedOrder = raw.order && typeof raw.order === 'object' &&
    (raw.order.orderNumber || raw.order.status) ? summaryOrder(raw.order) : null;
  const populatedUser = raw.user && typeof raw.user === 'object' &&
    (raw.user.name || raw.user.email) ? {
      id: String(raw.user._id || raw.user.id),
      name: raw.user.name,
      email: raw.user.email,
    } : null;

  return {
    id: String(raw._id || raw.id),
    reference: raw.reference,
    orderId: String(raw.order?._id || raw.order?.id || raw.order),
    order: populatedOrder,
    user: includeUser ? populatedUser : undefined,
    category: raw.category,
    description: raw.description,
    status: raw.status,
    active: raw.active,
    adminNote: raw.adminNote || '',
    statusChangedAt: raw.statusChangedAt,
    resolvedAt: raw.resolvedAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export const myIssues = asyncHandler(async (req, res) => {
  const issues = await OrderIssue.find({ user: req.user._id })
    .sort({ updatedAt: -1 })
    .limit(100)
    .populate('order', 'orderNumber status total paymentStatus')
    .lean();
  res.json({ issues: issues.map((issue) => serializeIssue(issue)) });
});

export const createIssue = asyncHandler(async (req, res) => {
  let input;
  try {
    input = normalizeIssueReport(req.body);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message || 'Invalid issue report.' });
  }

  const order = await Order.findOne({ _id: input.orderId, user: req.user._id });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (!canReportOrderIssue(order)) {
    return res.status(409).json({
      error: 'A case can only be opened for a paid order that is in preparation, on the way, or delivered.',
    });
  }

  const existing = await OrderIssue.findOne({ order: order._id, user: req.user._id, active: true }).lean();
  if (existing) {
    return res.status(409).json({
      error: 'An active case already exists for this order. Use its reference to follow up.',
      issue: serializeIssue(existing),
    });
  }

  let issue;
  try {
    issue = await OrderIssue.create({
      reference: `PH-ISS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      order: order._id,
      user: req.user._id,
      category: input.category,
      description: input.description,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const activeIssue = await OrderIssue.findOne({ order: order._id, user: req.user._id, active: true }).lean();
      if (activeIssue) {
        return res.status(409).json({
          error: 'An active case already exists for this order. Use its reference to follow up.',
          issue: serializeIssue(activeIssue),
        });
      }
    }
    throw error;
  }

  publishAdminRefresh();
  res.status(201).json({
    issue: {
      ...serializeIssue(issue),
      order: summaryOrder(order),
    },
  });
});

export const listAdminIssues = asyncHandler(async (_req, res) => {
  const issues = await OrderIssue.find()
    .sort({ active: -1, updatedAt: -1 })
    .limit(200)
    .populate('order', 'orderNumber status total paymentStatus')
    .populate('user', 'name email')
    .lean();
  res.json({ issues: issues.map((issue) => serializeIssue(issue, { includeUser: true })) });
});

export const updateIssue = asyncHandler(async (req, res) => {
  if (typeof req.params.id !== 'string' || !mongoose.isObjectIdOrHexString(req.params.id)) {
    return res.status(400).json({ error: 'Invalid case identifier.' });
  }

  const issue = await OrderIssue.findById(req.params.id);
  if (!issue) return res.status(404).json({ error: 'Case not found.' });

  const result = validateIssueUpdate(issue, req.body);
  if (!result.allowed) return res.status(result.statusCode).json({ error: result.message });

  const previousStatus = issue.status;
  if (result.updates.status !== undefined) issue.status = result.updates.status;
  if (result.updates.adminNote !== undefined) issue.adminNote = result.updates.adminNote;
  if (previousStatus !== issue.status) {
    issue.statusChangedAt = new Date();
    if (issue.status === 'resolved') {
      issue.active = false;
      issue.resolvedAt = new Date();
    }
  }
  await issue.save();
  publishAdminRefresh();

  const populated = await OrderIssue.findById(issue._id)
    .populate('order', 'orderNumber status total paymentStatus')
    .lean();
  res.json({ issue: serializeIssue(populated) });
});
