// Licensed food photography is served from Pexels/Unsplash; the in-repo vector art remains a resilient fallback.
export const PIZZA_CARD_PHOTOS = {
  mushroom: {
    src: 'https://images.pexels.com/photos/4394619/pexels-photo-4394619.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Freshly baked mushroom pizza with herbs',
  },
  spicy: {
    src: 'https://images.pexels.com/photos/36295120/pexels-photo-36295120.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Vegetarian pizza with olives and bell peppers',
  },
  pestoForest: {
    src: 'https://images.pexels.com/photos/5639971/pexels-photo-5639971.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Vegetarian pizza with mushrooms, olives and artichokes',
  },
  // Pexels: Roman Odintsov, "Pizza With Green and White Vegetables" (photo 5903095).
  // This source was selected after the previous URL failed the hosted browser image-load gate.
  roastedGarden: {
    src: 'https://images.pexels.com/photos/5903095/pexels-photo-5903095.jpeg?cs=srgb&dl=pexels-roman-odintsov-5903095.jpg&fm=jpg',
    alt: 'Roasted vegetable pizza with zucchini, eggplant and red peppers',
  },
  cornfire: {
    src: 'https://images.pexels.com/photos/34382326/pexels-photo-34382326.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Freshly baked vegetable pizza with olives and peppers',
  },
  oliveAtelier: {
    src: 'https://images.pexels.com/photos/26341212/pexels-photo-26341212.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Vegetable and mushroom pizza on a green background',
  },
  classic: {
    src: 'https://images.unsplash.com/photo-1594007654729-407eedc4be65?auto=format&fit=crop&w=1280&q=85',
    alt: 'Freshly baked pizza with tomato, cheese and basil',
  },
  rustic: {
    src: 'https://images.pexels.com/photos/31450870/pexels-photo-31450870.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Rustic pizza finished with fresh basil',
  },
};

export function getPizzaCardPhoto(pizza, index = 0) {
  const name = String(pizza?.name || '').toLowerCase();

  // Pin the featured recipes first. Broad ingredient matching must not make
  // different named pizzas reuse the same generic tomato-pizza photograph.
  if (name.includes('margherita')) return PIZZA_CARD_PHOTOS.classic;
  if (name.includes('garden party')) return PIZZA_CARD_PHOTOS.rustic;
  if (name.includes('firecracker')) return PIZZA_CARD_PHOTOS.spicy;
  if (name.includes('white garden')) return PIZZA_CARD_PHOTOS.mushroom;
  if (name.includes('pesto forest')) return PIZZA_CARD_PHOTOS.pestoForest;
  if (name.includes('roasted garden')) return PIZZA_CARD_PHOTOS.roastedGarden;
  if (name.includes('cornfire')) return PIZZA_CARD_PHOTOS.cornfire;
  if (name.includes('olive atelier')) return PIZZA_CARD_PHOTOS.oliveAtelier;

  const recipe = pizza?.ingredients;
  const ingredientNames = recipe && typeof recipe === 'object'
    ? Object.entries(recipe).flatMap(([key, value]) => [key, ...(Array.isArray(value) ? value : [value])])
        .filter((value) => typeof value === 'string').join(' ')
    : '';
  const searchable = `${name} ${ingredientNames}`;

  if (/(mushroom|fung|pollo|chicken)/.test(searchable)) return PIZZA_CARD_PHOTOS.mushroom;
  if (/(pepperoni|salami|sausage|jalape|chili|chilli|spicy|hot)/.test(searchable)) return PIZZA_CARD_PHOTOS.spicy;
  if (/(tomato|basil)/.test(searchable)) return PIZZA_CARD_PHOTOS.classic;
  if (/(garden|veggie|vegetable|olive|corn|spinach|plant-based)/.test(searchable)) return PIZZA_CARD_PHOTOS.rustic;
  return [PIZZA_CARD_PHOTOS.classic, PIZZA_CARD_PHOTOS.rustic, PIZZA_CARD_PHOTOS.mushroom, PIZZA_CARD_PHOTOS.pestoForest][index % 4];
}

