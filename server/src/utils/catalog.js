export const CATALOG = {
  bases: [
    { id: 'classic', name: 'Classic Hand-Tossed', price: 0, inventoryKey: 'base:classic' },
    { id: 'thin', name: 'Thin & Crispy', price: 30, inventoryKey: 'base:thin' },
    { id: 'whole-wheat', name: 'Whole Wheat', price: 40, inventoryKey: 'base:whole-wheat' },
    { id: 'pan', name: 'Pan Crust', price: 50, inventoryKey: 'base:pan' },
    { id: 'cheese-burst', name: 'Cheese Burst', price: 70, inventoryKey: 'base:cheese-burst' },
  ],
  sauces: [
    { id: 'classic-tomato', name: 'Classic Tomato', price: 0, inventoryKey: 'sauce:classic-tomato' },
    { id: 'spicy-arrabbiata', name: 'Spicy Arrabbiata', price: 15, inventoryKey: 'sauce:spicy-arrabbiata' },
    { id: 'pesto', name: 'Basil Pesto', price: 25, inventoryKey: 'sauce:pesto' },
    { id: 'bbq', name: 'Smoky BBQ', price: 20, inventoryKey: 'sauce:bbq' },
    { id: 'white-garlic', name: 'White Garlic', price: 20, inventoryKey: 'sauce:white-garlic' },
  ],
  cheeses: [
    { id: 'mozzarella', name: 'Mozzarella', price: 35, inventoryKey: 'cheese:mozzarella' },
    { id: 'cheddar', name: 'Cheddar Blend', price: 45, inventoryKey: 'cheese:cheddar' },
    { id: 'vegan', name: 'Plant-Based Cheese', price: 55, inventoryKey: 'cheese:vegan' },
  ],
  vegetables: [
    { id: 'capsicum', name: 'Capsicum', price: 15, inventoryKey: 'vegetable:capsicum' },
    { id: 'onion', name: 'Red Onion', price: 10, inventoryKey: 'vegetable:onion' },
    { id: 'mushroom', name: 'Mushrooms', price: 20, inventoryKey: 'vegetable:mushroom' },
    { id: 'olive', name: 'Black Olives', price: 20, inventoryKey: 'vegetable:olive' },
    { id: 'corn', name: 'Sweet Corn', price: 15, inventoryKey: 'vegetable:corn' },
    { id: 'jalapeno', name: 'Jalapeños', price: 15, inventoryKey: 'vegetable:jalapeno' },
    { id: 'tomato', name: 'Cherry Tomato', price: 15, inventoryKey: 'vegetable:tomato' },
  ],
};

export const FEATURED_PIZZAS = [
  { id: 'margherita', name: 'Margherita Classic', description: 'Basil, tomato, and stretchy mozzarella.', price: 249, tag: 'BESTSELLER', emoji: '🍕', ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['tomato'] } },
  { id: 'garden', name: 'Garden Party', description: 'A bright, crunchy mix of garden vegetables.', price: 329, tag: 'FRESH PICK', emoji: '🥦', ingredients: { base: 'thin', sauce: 'pesto', cheese: 'mozzarella', vegetables: ['capsicum', 'onion', 'mushroom', 'olive'] } },
  { id: 'firecracker', name: 'Firecracker', description: 'Smoky heat, jalapeños, and cheddar.', price: 359, tag: 'SPICY', emoji: '🌶️', ingredients: { base: 'pan', sauce: 'spicy-arrabbiata', cheese: 'cheddar', vegetables: ['jalapeno', 'onion', 'corn'] } },
  { id: 'white-garden', name: 'White Garden', description: 'Garlic cream-style sauce and rich plant-based cheese.', price: 379, tag: 'PLANT-BASED', emoji: '🌿', ingredients: { base: 'whole-wheat', sauce: 'white-garlic', cheese: 'vegan', vegetables: ['mushroom', 'capsicum', 'tomato'] } },
];

export function calculateCustomPizza(input) {
  if (!input || typeof input !== 'object') throw new Error('Pizza configuration is required');
  const choose = (group, id, label) => { const option = CATALOG[group].find((item) => item.id === id); if (!option) throw new Error(`Choose a valid ${label}`); return option; };
  const base = choose('bases', input.base, 'base'); const sauce = choose('sauces', input.sauce, 'sauce'); const cheese = choose('cheeses', input.cheese, 'cheese');
  const vegIds = Array.isArray(input.vegetables) ? [...new Set(input.vegetables)] : [];
  if (vegIds.length > 5) throw new Error('Choose up to 5 vegetables');
  const vegetables = vegIds.map((id) => choose('vegetables', id, 'vegetable'));
  const quantity = Number(input.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new Error('Quantity must be between 1 and 10');
  const unitPrice = 199 + base.price + sauce.price + cheese.price + vegetables.reduce((sum, item) => sum + item.price, 0);
  return { name: 'Build Your Own', quantity, unitPrice, lineTotal: unitPrice * quantity, ingredients: { base: base.id, sauce: sauce.id, cheese: cheese.id, vegetables: vegetables.map((v) => v.id) }, inventoryKeys: [base.inventoryKey, sauce.inventoryKey, cheese.inventoryKey, ...vegetables.map((v) => v.inventoryKey)], breakdown: { base: base.price, sauce: sauce.price, cheese: cheese.price, vegetables: vegetables.reduce((s, v) => s + v.price, 0), pizzaBase: 199 } };
}

export function inventoryRequirements(items) {
  const counts = new Map();
  for (const item of items) { const qty = Number(item.quantity || 1); for (const key of item.inventoryKeys) counts.set(key, (counts.get(key) || 0) + qty); }
  return [...counts].map(([key, quantity]) => ({ key, quantity }));
}
