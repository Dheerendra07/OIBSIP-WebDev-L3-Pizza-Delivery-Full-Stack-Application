function normalizedIngredients(ingredients = {}) {
  return {
    base: ingredients.base ?? null,
    sauce: ingredients.sauce ?? null,
    cheese: ingredients.cheese ?? null,
    vegetables: [...(Array.isArray(ingredients.vegetables) ? ingredients.vegetables : [])].sort(),
  };
}

export function snapshotCart(cart) {
  if (!Array.isArray(cart)) return null;
  return cart.map((item) => ({
    cartKey: item.cartKey ?? null,
    type: item.type ?? null,
    pizzaId: item.pizzaId ?? null,
    name: item.name ?? null,
    unitPrice: Number(item.unitPrice),
    quantity: Number(item.quantity),
    base: item.base ?? null,
    sauce: item.sauce ?? null,
    cheese: item.cheese ?? null,
    vegetables: [...(Array.isArray(item.vegetables) ? item.vegetables : [])].sort(),
  }));
}

export function matchesCartSnapshot(snapshot, cart) {
  if (!Array.isArray(snapshot) || !Array.isArray(cart)) return false;
  return JSON.stringify(snapshot) === JSON.stringify(snapshotCart(cart));
}

/**
 * Compare the exact amounts the customer saw with the server-priced order.
 * cartMatchesServerOrder is the recipe/identity check from checkout.js.
 */
export function requiresPriceConfirmation({
  cart,
  order,
  displayedSubtotal,
  displayedDeliveryFee,
  cartMatchesServerOrder,
}) {
  if (!Array.isArray(cart) || !order || !Array.isArray(order.items)) return true;
  if (cart.length !== order.items.length) return true;

  const lineChanged = cart.some((item, index) => {
    const line = order.items[index];
    if (!line) return true;
    return Number(line.quantity) !== Number(item.quantity) ||
      Number(line.unitPrice) !== Number(item.unitPrice) ||
      Number(line.lineTotal) !== Number(item.unitPrice) * Number(item.quantity);
  });

  return !cartMatchesServerOrder ||
    lineChanged ||
    Number(order.subtotal) !== Number(displayedSubtotal) ||
    Number(order.deliveryFee) !== Number(displayedDeliveryFee) ||
    Number(order.total) !== Number(displayedSubtotal) + Number(displayedDeliveryFee);
}

/** Confirm the saved price quote did not change between display and consent. */
export function sameServerQuote(previous, latest) {
  if (!previous || !latest || previous.id !== latest.id ||
      previous.status !== latest.status || previous.paymentStatus !== latest.paymentStatus ||
      Number(previous.subtotal) !== Number(latest.subtotal) ||
      Number(previous.deliveryFee) !== Number(latest.deliveryFee) ||
      Number(previous.total) !== Number(latest.total) ||
      !Array.isArray(previous.items) || !Array.isArray(latest.items) ||
      previous.items.length !== latest.items.length) {
    return false;
  }

  return previous.items.every((line, index) => {
    const next = latest.items[index];
    return Boolean(next) &&
      line.name === next.name &&
      Number(line.quantity) === Number(next.quantity) &&
      Number(line.unitPrice) === Number(next.unitPrice) &&
      Number(line.lineTotal) === Number(next.lineTotal) &&
      JSON.stringify(normalizedIngredients(line.ingredients)) ===
        JSON.stringify(normalizedIngredients(next.ingredients));
  });
}
