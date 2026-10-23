const CATALOG_ID = /^[a-z0-9][a-z0-9-]{0,79}$/i;
function normalizedIngredients(ingredients = {}) {
  return { base: ingredients.base ?? null, sauce: ingredients.sauce ?? null, cheese: ingredients.cheese ?? null, vegetables: [...(Array.isArray(ingredients.vegetables) ? ingredients.vegetables : [])].sort() };
}
/** Only resume a pending checkout if the visible cart still matches the server order. */
export function orderMatchesCart(orderItems, cart, featuredPizzas) {
  if (!Array.isArray(orderItems) || !Array.isArray(cart) || orderItems.length !== cart.length) return false;
  return orderItems.every((line, index) => {
    const cartItem = cart[index];
    if (!cartItem || Number(line.quantity) !== Number(cartItem.quantity)) return false;
    let expectedIngredients;
    if (cartItem.type === 'featured') { const pizza = featuredPizzas.find((item) => item.id === cartItem.pizzaId); if (!pizza) return false; expectedIngredients = pizza.ingredients; }
    else if (cartItem.type === 'custom') expectedIngredients = { base: cartItem.base, sauce: cartItem.sauce, cheese: cartItem.cheese, vegetables: cartItem.vegetables };
    else return false;
    return Number(line.unitPrice) === Number(cartItem.unitPrice) && JSON.stringify(normalizedIngredients(line.ingredients)) === JSON.stringify(normalizedIngredients(expectedIngredients));
  });
}

/** Keep captured/manual-review orders from being reported as successful or re-paid. */
export function classifyExistingCheckout(order, cartMatches) {
  if (!order || typeof order !== 'object') return 'new';
  if (order.status === 'payment_review' || order.paymentReviewRequired) return 'review';
  if (order.paymentStatus === 'paid' && cartMatches) return 'already-paid';
  if (order.status !== 'pending_payment' || !cartMatches) return 'new';
  return 'resume';
}


/**
 * Rebuild a still-pending checkout from its saved server quote so customers
 * can resume payment from order history after losing the current-tab draft.
 * Prices are restored from the order, never from the browser or today's menu.
 */
export function buildPendingCheckoutCart(order, catalog, featuredPizzas) {
  const failed = (message) => ({ ok: false, message, items: [] });
  if (!order || order.status !== 'pending_payment' || order.paymentStatus !== 'pending') {
    return failed('This order is no longer awaiting payment. Refresh your order history before continuing.');
  }
  if (!Array.isArray(order.items) || order.items.length < 1 || order.items.length > 12 ||
      !catalog || !Array.isArray(featuredPizzas)) {
    return failed('The saved checkout is incomplete or the current catalog is unavailable. Refresh and try again.');
  }

  const items = [];
  const usedCartKeys = new Set();
  let subtotal = 0;
  const orderKey = String(order.id || order.orderNumber || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(-40);
  if (!orderKey) return failed('The saved order identifier is invalid. Refresh your order history.');

  for (const [index, line] of order.items.entries()) {
    const quantity = Number(line?.quantity);
    const unitPrice = Number(line?.unitPrice);
    const ingredients = line?.ingredients;
    if (typeof line?.name !== 'string' || !line.name.trim() ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 10 ||
        !Number.isSafeInteger(unitPrice) || unitPrice < 0 ||
        !ingredients || typeof ingredients !== 'object' || Array.isArray(ingredients) ||
        !['base', 'sauce', 'cheese'].every(key => typeof ingredients[key] === 'string' && CATALOG_ID.test(ingredients[key])) ||
        !Array.isArray(ingredients.vegetables) || ingredients.vegetables.length > 5 ||
        ingredients.vegetables.some(id => typeof id !== 'string' || !CATALOG_ID.test(id)) ||
        new Set(ingredients.vegetables).size !== ingredients.vegetables.length) {
      return failed('A saved item could not be validated. Nothing was added to your bag.');
    }

    const choices = [
      ['bases', ingredients.base],
      ['sauces', ingredients.sauce],
      ['cheeses', ingredients.cheese],
      ...ingredients.vegetables.map(id => ['vegetables', id]),
    ];
    for (const [group, id] of choices) {
      const option = catalog[group]?.find(candidate => candidate.id === id);
      if (!option || !Number.isSafeInteger(Number(option.price)) || Number(option.price) < 0) {
        return failed('An ingredient from this saved order is no longer in the catalog. Refresh the menu before continuing.');
      }
    }

    const matchesRecipe = pizza => pizza?.name === line.name && pizza?.ingredients &&
      JSON.stringify(normalizedIngredients(pizza.ingredients)) === JSON.stringify(normalizedIngredients(ingredients));
    const featured = featuredPizzas.find(matchesRecipe);
    let cartItem;
    if (featured) {
      const cartKey = `featured:${featured.id}`;
      if (usedCartKeys.has(cartKey)) {
        return failed('This saved order contains duplicate pizza lines that cannot be safely resumed. Contact support before retrying payment.');
      }
      cartItem = {
        cartKey,
        type: 'featured',
        pizzaId: featured.id,
        name: featured.name,
        emoji: featured.emoji || '🍕',
        unitPrice,
        quantity,
        ingredients: {
          base: ingredients.base,
          sauce: ingredients.sauce,
          cheese: ingredients.cheese,
          vegetables: [...ingredients.vegetables],
        },
      };
    } else {
      cartItem = {
        cartKey: `custom:resume-${orderKey}-${index}`,
        type: 'custom',
        name: line.name,
        emoji: '🍕',
        unitPrice,
        quantity,
        base: ingredients.base,
        sauce: ingredients.sauce,
        cheese: ingredients.cheese,
        vegetables: [...ingredients.vegetables],
      };
    }
    if (usedCartKeys.has(cartItem.cartKey)) {
      return failed('The saved order contains duplicate cart lines. Nothing was added.');
    }
    usedCartKeys.add(cartItem.cartKey);
    items.push(cartItem);
    subtotal += unitPrice * quantity;
    if (!Number.isSafeInteger(subtotal)) {
      return failed('The saved order total is invalid. Refresh your order history before continuing.');
    }
  }

  if (!Number.isSafeInteger(order.subtotal) || order.subtotal !== subtotal ||
      !Number.isSafeInteger(order.deliveryFee) || order.deliveryFee < 0 ||
      !Number.isSafeInteger(order.total) || order.total !== order.subtotal + order.deliveryFee) {
    return failed('The saved order totals do not match its items. Do not retry payment until the order is reviewed.');
  }

  return { ok: true, items, message: 'Saved order restored using its server-confirmed price.' };
}
