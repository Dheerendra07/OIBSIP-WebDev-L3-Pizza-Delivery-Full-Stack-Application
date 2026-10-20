const MAX_ORDER_LINES = 12;
const MAX_QUANTITY = 10;

function normalizedIngredients(ingredients = {}) {
  return JSON.stringify({
    base: ingredients.base ?? null,
    sauce: ingredients.sauce ?? null,
    cheese: ingredients.cheese ?? null,
    vegetables: [...(Array.isArray(ingredients.vegetables) ? ingredients.vegetables : [])].sort(),
  });
}

function failed(message) {
  return { ok: false, message, items: [] };
}

/**
 * Rebuild a previous recipe against today's live catalog.
 * This deliberately refuses partial restores and never carries an old price
 * into the cart. Checkout still obtains and validates the authoritative quote.
 */
export function buildReorderCart(order, catalog, featuredPizzas) {
  if (!Array.isArray(order?.items) || order.items.length < 1 || order.items.length > MAX_ORDER_LINES) {
    return failed('We couldn’t rebuild this order because its saved items are incomplete. Choose from the current menu instead.');
  }
  if (!catalog || !Array.isArray(featuredPizzas)) {
    return failed('The current menu is not ready. Refresh it before repeating an order.');
  }

  const items = [];
  const orderKey = String(order.id || order.orderNumber || 'saved-order');

  for (const [index, line] of order.items.entries()) {
    const quantity = Number(line?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return failed('A saved item has an invalid quantity. Nothing was added; choose your items from the current menu.');
    }

    const recipe = line?.ingredients;
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe) ||
        typeof recipe.base !== 'string' || typeof recipe.sauce !== 'string' ||
        typeof recipe.cheese !== 'string' || !Array.isArray(recipe.vegetables) ||
        recipe.vegetables.length > 5 ||
        recipe.vegetables.some((id) => typeof id !== 'string') ||
        new Set(recipe.vegetables).size !== recipe.vegetables.length) {
      return failed('A saved recipe is incomplete. Nothing was added; rebuild it using the current menu.');
    }

    const groups = [
      ['bases', recipe.base],
      ['sauces', recipe.sauce],
      ['cheeses', recipe.cheese],
      ...recipe.vegetables.map((id) => ['vegetables', id]),
    ];
    const selected = [];
    for (const [group, id] of groups) {
      const option = catalog[group]?.find((candidate) => candidate.id === id);
      if (!option) {
        return failed('One of this order’s ingredients is no longer on the menu. No items were added; choose a replacement yourself.');
      }
      if (option.available === false) {
        return failed(`${option.name || 'An ingredient'} is currently unavailable. No items were added and no substitutions were made.`);
      }
      if (!Number.isFinite(Number(option.price)) || Number(option.price) < 0) {
        return failed('The current menu has an invalid price for a saved ingredient. Refresh the menu and try again.');
      }
      selected.push(option);
    }

    const featured = featuredPizzas.find((pizza) =>
      pizza?.name === line.name && pizza?.ingredients &&
      normalizedIngredients(pizza.ingredients) === normalizedIngredients(recipe)
    );

    if (featured && featured.available === false) {
      return failed(`${featured.name || 'This pizza'} is currently unavailable. No items were added; choose another pizza from the current menu.`);
    }

    const cartKey = `repeat:${orderKey}:${index}`;
    if (featured) {
      if (!Number.isFinite(Number(featured.price)) || Number(featured.price) < 0) {
        return failed('The current menu has an invalid price for a saved pizza. Refresh the menu and try again.');
      }
      items.push({
        cartKey,
        type: 'featured',
        pizzaId: featured.id,
        name: featured.name,
        emoji: featured.emoji || '🍕',
        unitPrice: Number(featured.price),
        quantity,
        ingredients: featured.ingredients,
      });
      continue;
    }

    const [base, sauce, cheese, ...vegetables] = selected;
    items.push({
      cartKey,
      type: 'custom',
      name: `Custom ${base.name || 'Pizza'}`,
      emoji: '🍕',
      unitPrice: 199 + Number(base.price) + Number(sauce.price) +
        Number(cheese.price) + vegetables.reduce((sum, item) => sum + Number(item.price), 0),
      quantity,
      base: recipe.base,
      sauce: recipe.sauce,
      cheese: recipe.cheese,
      vegetables: [...recipe.vegetables],
    });
  }

  return { ok: true, items, message: 'Saved recipe rebuilt with current menu prices.' };
}
