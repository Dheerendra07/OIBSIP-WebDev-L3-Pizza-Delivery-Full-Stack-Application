function normalizedIngredients(ingredients = {}) {
  return {
    base: ingredients.base ?? null,
    sauce: ingredients.sauce ?? null,
    cheese: ingredients.cheese ?? null,
    vegetables: [...(Array.isArray(ingredients.vegetables) ? ingredients.vegetables : [])].sort(),
  };
}

function cartIngredients(item = {}) {
  if (item.type === 'featured') return item.ingredients || {};
  if (item.type === 'custom') return {
    base: item.base ?? null,
    sauce: item.sauce ?? null,
    cheese: item.cheese ?? null,
    vegetables: item.vegetables ?? [],
  };
  return {};
}

export function cartMatchesServerRecipe(cart, order) {
  if (!Array.isArray(cart) || !order || !Array.isArray(order.items) || cart.length !== order.items.length) {
    return false;
  }
  return cart.every((item, index) => {
    const line = order.items[index];
    if (!line || Number(line.quantity) !== Number(item.quantity)) return false;
    if (item.type === 'featured' && line.name !== item.name) return false;
    if (item.type !== 'featured' && item.type !== 'custom') return false;
    return JSON.stringify(normalizedIngredients(line.ingredients)) ===
      JSON.stringify(normalizedIngredients(cartIngredients(item)));
  });
}

export function cartMatchesServerSnapshot(cart, order) {
  if (!cartMatchesServerRecipe(cart, order)) return false;
  return cart.every((item, index) => {
    const line = order.items[index];
    return Number(line.unitPrice) === Number(item.unitPrice) &&
      Number(line.lineTotal) === Number(item.unitPrice) * Number(item.quantity);
  });
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
    ingredients: normalizedIngredients(cartIngredients(item)),
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
}) {
  if (!cartMatchesServerRecipe(cart, order)) return true;
  const lineChanged = cart.some((item, index) => {
    const line = order.items[index];
    return Number(line.unitPrice) !== Number(item.unitPrice) ||
      Number(line.lineTotal) !== Number(item.unitPrice) * Number(item.quantity);
  });
  return lineChanged ||
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

/** Apply a quote only after the user explicitly accepts the server's amounts. */
export function syncCartToServerQuote(cart, order, catalog) {
  if (!Array.isArray(cart) || !Array.isArray(order?.items) || cart.length !== order.items.length) {
    throw new Error('The reviewed order no longer matches your bag. Refresh your bag before checkout.');
  }

  return cart.map((item, index) => {
    const line = order.items[index];
    const unitPrice = Number(line?.unitPrice);
    const quantity = Number(line?.quantity);
    if (!line || !Number.isFinite(unitPrice) || unitPrice < 0 ||
        !Number.isInteger(quantity) || quantity < 1) {
      throw new Error('The reviewed order contains invalid item pricing. Please refresh the menu.');
    }

    if (item.type === 'featured') {
      return {
        ...item,
        name: line.name,
        unitPrice,
        quantity,
        ingredients: line.ingredients,
      };
    }

    if (item.type === 'custom') {
      const base = line.ingredients?.base;
      const sauce = line.ingredients?.sauce;
      const cheese = line.ingredients?.cheese;
      const vegetables = Array.isArray(line.ingredients?.vegetables) ? [...line.ingredients.vegetables] : [];
      const baseName = catalog?.bases?.find((option) => option.id === base)?.name || 'Pizza';
      return {
        ...item,
        name: `Custom ${baseName}`,
        unitPrice,
        quantity,
        base,
        sauce,
        cheese,
        vegetables,
      };
    }

    throw new Error('The reviewed order contains an unsupported item type.');
  });
}
