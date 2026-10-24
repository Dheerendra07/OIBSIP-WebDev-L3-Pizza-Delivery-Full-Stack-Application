const KNOWN_VARIANTS = Object.freeze({
  margherita: 'tomato',
  garden: 'green',
  firecracker: 'orange',
  'white-garden': 'cream',
});

const FALLBACK_VARIANTS = ['tomato', 'green', 'orange', 'cream'];

function normalized(value) {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '';
}

/**
 * The API catalog intentionally owns prices/stock and does not publish visual tone.
 * Derive the artwork theme from the stable catalog id and recipe instead of
 * assuming a missing optional tone field means every pizza is tomato.
 */
export function getPizzaArtworkVariant(pizza, index = 0) {
  const id = normalized(pizza?.id || pizza?.pizzaId).replace(/ /g, '-');
  if (KNOWN_VARIANTS[id]) return KNOWN_VARIANTS[id];

  const name = normalized(pizza?.name);
  const tag = normalized(pizza?.tag);
  const ingredients = pizza?.ingredients && typeof pizza.ingredients === 'object'
    ? pizza.ingredients
    : {};
  const sauce = normalized(ingredients.sauce ?? pizza?.sauce);
  const cheese = normalized(ingredients.cheese ?? pizza?.cheese);
  const rawVegetables = ingredients.vegetables ?? pizza?.vegetables;
  const vegetables = Array.isArray(rawVegetables) ? rawVegetables.map(normalized).join(' ') : '';
  const recipe = [name, tag, sauce, cheese, vegetables].join(' ');

  if (/white garden|plant based|vegan|white garlic|cream sauce/.test(recipe) ||
      cheese === 'vegan' || sauce === 'white garlic') {
    return 'cream';
  }
  if (/firecracker|spicy|hot|jalapeno|arrabbiata|smoky bbq|pepperoni/.test(recipe) ||
      sauce === 'spicy arrabbiata' || sauce === 'bbq' || vegetables.includes('jalapeno')) {
    return 'orange';
  }
  if (/garden|fresh pick|pesto|capsicum|mushroom|olive|spinach/.test(recipe) ||
      sauce === 'pesto') {
    return 'green';
  }
  if (/margherita|tomato|basil/.test(recipe) || sauce === 'classic tomato') {
    return 'tomato';
  }

  const safeIndex = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return FALLBACK_VARIANTS[safeIndex % FALLBACK_VARIANTS.length];
}
