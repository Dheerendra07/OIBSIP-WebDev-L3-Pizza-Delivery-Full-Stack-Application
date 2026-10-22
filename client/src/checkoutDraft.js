const OBJECT_ID = /^[a-f0-9]{24}$/i;
const CATALOG_ID = /^[a-z0-9][a-z0-9-]{0,79}$/i;
export const CHECKOUT_DRAFT_STORAGE_KEY = 'pizza-house.checkout-draft';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeVegetables(value) {
  if (!Array.isArray(value) || value.length > 5 ||
      value.some((id) => typeof id !== 'string' || !CATALOG_ID.test(id)) ||
      new Set(value).size !== value.length) return null;
  return [...value];
}

function normalizeIngredients(value) {
  if (!isRecord(value) ||
      !['base', 'sauce', 'cheese'].every((key) =>
        typeof value[key] === 'string' && CATALOG_ID.test(value[key]))) return null;
  const vegetables = normalizeVegetables(value.vegetables);
  if (!vegetables) return null;
  return { base: value.base, sauce: value.sauce, cheese: value.cheese, vegetables };
}

function normalizeCartItem(value) {
  if (!isRecord(value) ||
      typeof value.name !== 'string' || value.name.trim().length < 1 || value.name.length > 120 ||
      typeof value.emoji !== 'string' || value.emoji.length > 24 ||
      typeof value.unitPrice !== 'number' || !Number.isFinite(value.unitPrice) || value.unitPrice < 0 ||
      !Number.isInteger(value.quantity) || value.quantity < 1 || value.quantity > 10 ||
      typeof value.cartKey !== 'string' || value.cartKey.length > 160) return null;

  if (value.type === 'featured') {
    if (typeof value.pizzaId !== 'string' || !CATALOG_ID.test(value.pizzaId) ||
        value.cartKey !== `featured:${value.pizzaId}`) return null;
    const ingredients = normalizeIngredients(value.ingredients);
    if (!ingredients) return null;
    return {
      cartKey: value.cartKey,
      type: 'featured',
      pizzaId: value.pizzaId,
      name: value.name,
      emoji: value.emoji,
      unitPrice: value.unitPrice,
      quantity: value.quantity,
      ingredients,
    };
  }

  if (value.type === 'custom') {
    if (!/^custom:[a-z0-9-]{1,100}$/i.test(value.cartKey)) return null;
    const ingredients = normalizeIngredients({
      base: value.base,
      sauce: value.sauce,
      cheese: value.cheese,
      vegetables: value.vegetables,
    });
    if (!ingredients) return null;
    return {
      cartKey: value.cartKey,
      type: 'custom',
      name: value.name,
      emoji: value.emoji,
      unitPrice: value.unitPrice,
      quantity: value.quantity,
      base: ingredients.base,
      sauce: ingredients.sauce,
      cheese: ingredients.cheese,
      vegetables: ingredients.vegetables,
    };
  }

  return null;
}

/**
 * Restores only the current-tab basket and its pending server order ID.
 * Delivery addresses and other personal details are intentionally not persisted.
 * The server remains authoritative for item availability and final prices.
 */
export function parseCheckoutDraft(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.cart) || value.cart.length > 100) return null;

  const cart = value.cart.map(normalizeCartItem);
  if (cart.some((item) => item === null)) return null;

  let activeOrderId = null;
  if (value.activeOrderId !== null && value.activeOrderId !== undefined) {
    if (typeof value.activeOrderId !== 'string' || !OBJECT_ID.test(value.activeOrderId)) return null;
    activeOrderId = value.activeOrderId;
  }
  if (cart.length === 0) activeOrderId = null;

  return { version: 1, cart, activeOrderId };
}

export function serializeCheckoutDraft(draft) {
  if (!isRecord(draft)) return null;
  const normalized = parseCheckoutDraft(JSON.stringify({
    version: 1,
    cart: draft.cart,
    activeOrderId: draft.activeOrderId ?? null,
  }));
  return normalized ? JSON.stringify(normalized) : null;
}

/** An address is being edited when the customer has started entering required address fields. */
export function hasDeliveryDetailsForUpdate(details) {
  if (!isRecord(details)) return false;
  return ['phone', 'addressLine', 'city', 'state', 'postalCode'].some((key) =>
    typeof details[key] === 'string' && details[key].trim().length > 0);
}

export function readCheckoutDraft() {
  try {
    return parseCheckoutDraft(sessionStorage.getItem(CHECKOUT_DRAFT_STORAGE_KEY)) ||
      { version: 1, cart: [], activeOrderId: null };
  } catch {
    return { version: 1, cart: [], activeOrderId: null };
  }
}
