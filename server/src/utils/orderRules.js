import { FEATURED_PIZZAS, calculateCustomPizza } from './catalog.js';

const NEXT_ORDER_STATUSES = Object.freeze({
  order_received: ['in_kitchen'],
  in_kitchen: ['sent_to_delivery'],
  sent_to_delivery: ['delivered'],
});

function invalidInput(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

/** Build a persisted order line exclusively from allowlisted server catalog data. */
export function buildOrderItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidInput('Each order line must be a valid featured or custom pizza');
  }

  if (raw.type === 'featured') {
    const pizza = FEATURED_PIZZAS.find((item) => item.id === raw.pizzaId);
    if (!pizza) throw invalidInput('Choose a valid menu pizza');

    const quantity = Number(raw.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      throw invalidInput('Quantity must be between 1 and 10');
    }

    const inventory = calculateCustomPizza({ ...pizza.ingredients, quantity });
    return {
      name: pizza.name,
      quantity,
      unitPrice: pizza.price,
      lineTotal: pizza.price * quantity,
      ingredients: pizza.ingredients,
      inventoryKeys: inventory.inventoryKeys,
    };
  }

  if (raw.type === 'custom') {
    let item;
    try {
      item = calculateCustomPizza(raw);
    } catch (error) {
      // Invalid client-selected ingredients/configuration are a 400, not an
      // internal server error. Keep internal failures otherwise unchanged.
      if (error?.statusCode === 400) throw error;
      throw invalidInput(error?.message || 'Choose a valid custom pizza configuration');
    }
    return {
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      ingredients: item.ingredients,
      inventoryKeys: item.inventoryKeys,
    };
  }

  throw invalidInput('Each order line must be a valid featured or custom pizza');
}

/** Validate the collection before mapping to avoid malformed bodies becoming 500 errors. */
export function buildOrderItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 12) {
    throw invalidInput('An order must contain 1–12 pizza lines');
  }
  return rawItems.map(buildOrderItem);
}

/** Client-supplied totals are never used. */
export function calculateOrderTotals(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 12) {
    throw invalidInput('An order must contain 1–12 pizza lines');
  }
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const deliveryFee = subtotal >= 499 ? 0 : 29;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

/** Validate and normalize the address before an order can be created or paid. */
export function validateDeliveryDetails(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidInput('Delivery details are required before checkout');
  }

  const text = (value, label, min, max, required = true) => {
    if (value == null && !required) return '';
    if (typeof value !== 'string') throw invalidInput(`${label} must be text`);
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (required && normalized.length < min) throw invalidInput(`${label} is required`);
    if (normalized.length > max) throw invalidInput(`${label} must be at most ${max} characters`);
    return normalized;
  };

  const recipientName = text(raw.recipientName, 'Recipient name', 2, 80);
  const phone = text(raw.phone, 'Mobile number', 10, 24).replace(/[\s()-]/g, '');
  if (!/^[6-9]\d{9}$/.test(phone)) throw invalidInput('Enter a valid 10-digit Indian mobile number');
  const addressLine = text(raw.addressLine, 'Street address', 5, 180);
  const landmark = text(raw.landmark, 'Landmark', 0, 100, false);
  const city = text(raw.city, 'City', 2, 80);
  const state = text(raw.state, 'State', 2, 80);
  const postalCode = text(raw.postalCode, 'PIN code', 6, 6);
  if (!/^[1-9]\d{5}$/.test(postalCode)) throw invalidInput('Enter a valid 6-digit Indian PIN code');
  const instructions = text(raw.instructions, 'Delivery instructions', 0, 200, false);

  return { recipientName, phone, addressLine, landmark, city, state, postalCode, instructions };
}

export function validateOrderStatusTransition(order, nextStatus) {
  if (order?.paymentStatus !== 'paid') {
    return { allowed: false, statusCode: 409, message: 'Only paid orders can be moved through fulfillment' };
  }
  if (!NEXT_ORDER_STATUSES[order.status]?.includes(nextStatus)) {
    return { allowed: false, statusCode: 400, message: `Invalid status transition from ${order.status}` };
  }
  return { allowed: true };
}
