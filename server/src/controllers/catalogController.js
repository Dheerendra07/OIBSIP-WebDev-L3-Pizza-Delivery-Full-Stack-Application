import InventoryItem from '../models/InventoryItem.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { CATALOG, FEATURED_PIZZAS } from '../utils/catalog.js';
export const getCatalog = asyncHandler(async (_req, res) => {
  const inventory = await InventoryItem.find({}, 'key stock').lean(); const stockByKey = Object.fromEntries(inventory.map((x) => [x.key, x.stock]));
  const withStock = (items) => items.map((item) => ({ ...item, available: (stockByKey[item.inventoryKey] ?? 0) > 0 }));
  res.json({ catalog: { bases: withStock(CATALOG.bases), sauces: withStock(CATALOG.sauces), cheeses: withStock(CATALOG.cheeses), vegetables: withStock(CATALOG.vegetables) }, featuredPizzas: FEATURED_PIZZAS.map((p) => ({ ...p, available: [...p.ingredients.vegetables, p.ingredients.base, p.ingredients.sauce, p.ingredients.cheese].every((ingredient) => { const key = ingredient.includes(':') ? ingredient : (p.ingredients.base === ingredient ? `base:${ingredient}` : p.ingredients.sauce === ingredient ? `sauce:${ingredient}` : p.ingredients.cheese === ingredient ? `cheese:${ingredient}` : `vegetable:${ingredient}`); return (stockByKey[key] ?? 0) > 0; }) })) });
});
