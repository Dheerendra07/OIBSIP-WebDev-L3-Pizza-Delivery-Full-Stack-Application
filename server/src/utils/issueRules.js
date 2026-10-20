export const ISSUE_CATEGORIES = Object.freeze([
  'missing_item',
  'wrong_item',
  'quality_issue',
  'delivery_delay',
  'other',
]);

const REPORTABLE_ORDER_STATUSES = new Set([
  'order_received',
  'in_kitchen',
  'sent_to_delivery',
  'delivered',
]);

const ISSUE_STATUSES = new Set(['open', 'under_review', 'resolved']);

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeIssueReport(body) {
  if (!isObjectRecord(body)) throw inputError('Provide a valid issue report.');
  const allowed = new Set(['orderId', 'category', 'description']);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw inputError('The issue report contains an unsupported field.');
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  if (!/^[a-f\d]{24}$/i.test(orderId)) throw inputError('Choose a valid order.');

  const category = typeof body.category === 'string' ? body.category.trim() : '';
  if (!ISSUE_CATEGORIES.includes(category)) throw inputError('Choose a valid issue category.');

  if (typeof body.description !== 'string') throw inputError('The description must be text.');
  const description = body.description.trim().replace(/[ \t]+/g, ' ');
  if (description.length < 10) throw inputError('Add at least 10 characters so the team can understand the issue.');
  if (description.length > 600) throw inputError('The description must be 600 characters or fewer.');

  return { orderId, category, description };
}

export function canReportOrderIssue(order) {
  return Boolean(order) &&
    order.paymentStatus === 'paid' &&
    order.paymentReviewRequired !== true &&
    !['payment_review', 'cancelled'].includes(order.status) &&
    order.refundStatus !== 'processed' &&
    REPORTABLE_ORDER_STATUSES.has(order.status);
}

export function validateIssueUpdate(issue, body) {
  if (!isObjectRecord(body)) {
    return { allowed: false, statusCode: 400, message: 'Provide a valid case update.' };
  }

  const allowedKeys = new Set(['status', 'customerUpdate']);
  if (!Object.keys(body).length || Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return { allowed: false, statusCode: 400, message: 'Provide a case status and/or customer message only.' };
  }

  const updates = {};
  if (Object.hasOwn(body, 'customerUpdate')) {
    if (typeof body.customerUpdate !== 'string') {
      return { allowed: false, statusCode: 400, message: 'The customer message must be text.' };
    }
    const customerUpdate = body.customerUpdate.trim().replace(/[ \t]+/g, ' ');
    if (customerUpdate.length > 600) {
      return { allowed: false, statusCode: 400, message: 'The customer message must be 600 characters or fewer.' };
    }
    updates.customerUpdate = customerUpdate;
  }

  if (Object.hasOwn(body, 'status')) {
    const nextStatus = body.status;
    if (typeof nextStatus !== 'string' || !ISSUE_STATUSES.has(nextStatus) || nextStatus === 'open') {
      return { allowed: false, statusCode: 400, message: 'Choose under_review or resolved.' };
    }
    const currentStatus = issue?.status;
    if (currentStatus === 'resolved' && nextStatus !== 'resolved') {
      return { allowed: false, statusCode: 409, message: 'Resolved cases cannot be reopened from this action.' };
    }
    if (currentStatus === 'open' && !['under_review', 'resolved'].includes(nextStatus)) {
      return { allowed: false, statusCode: 409, message: 'Invalid case status transition.' };
    }
    if (currentStatus === 'under_review' && !['under_review', 'resolved'].includes(nextStatus)) {
      return { allowed: false, statusCode: 409, message: 'Invalid case status transition.' };
    }
    if (!ISSUE_STATUSES.has(currentStatus)) {
      return { allowed: false, statusCode: 409, message: 'This case has an invalid current status.' };
    }
    updates.status = nextStatus;
  }

  return { allowed: true, updates };
}
