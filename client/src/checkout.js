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
