const OPTION_GROUPS = ['bases', 'sauces', 'cheeses', 'vegetables'];

function isPricedOption(item) {
  return Boolean(
    item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    item.id.trim() &&
    typeof item.name === 'string' &&
    item.name.trim() &&
    typeof item.price === 'number' &&
    Number.isFinite(item.price) &&
    item.price >= 0
  );
}

/**
 * Reject incomplete API data rather than silently showing the UI's demo defaults
 * as if those prices and stock flags came from the live catalog.
 */
export function canCheckoutWithCatalog(status) {
  return status === 'ready';
}

export function normalizeCatalogResponse(data) {
  const catalog = data?.catalog;
  const featuredPizzas = data?.featuredPizzas;

  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog) ||
      !Array.isArray(featuredPizzas) || featuredPizzas.length === 0) {
    throw new Error('The live menu response is incomplete.');
  }

  for (const group of OPTION_GROUPS) {
    if (!Array.isArray(catalog[group]) || catalog[group].length === 0 ||
        !catalog[group].every((item) => isPricedOption(item) && typeof item.available === 'boolean')) {
      throw new Error(`The live menu is missing valid ${group} options.`);
    }
  }

  const validFeatured = featuredPizzas.every((pizza) =>
    isPricedOption(pizza) &&
    typeof pizza.description === 'string' &&
    typeof pizza.tag === 'string' &&
    typeof pizza.available === 'boolean' &&
    pizza.ingredients &&
    typeof pizza.ingredients === 'object' &&
    !Array.isArray(pizza.ingredients)
  );
  if (!validFeatured) {
    throw new Error('The live menu contains an invalid featured pizza.');
  }

  return { catalog, featuredPizzas };
}
