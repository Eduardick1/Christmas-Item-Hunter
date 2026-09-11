const imageUrl = filename => new URL(`../img/${filename}`, import.meta.url).href;

export const items = [
  {
    id: 'cans-color',
    name: 'Краски Lavelly Gamma',
    images: {
      icon: imageUrl('item-1.svg'),
      placeholder: imageUrl('item-1_placeholder.svg'),
      card: imageUrl('item-1_card.svg'),
    },
  },
  {
    id: 'chair-1',
    name: 'Стул «Фирес»',
    images: {
      icon: imageUrl('item-2.svg'),
      placeholder: imageUrl('item-2_placeholder.svg'),
      card: imageUrl('item-2_card.svg'),
    },
  },
  {
    id: 'tool-level',
    name: 'Уровень Bolt',
    images: {
      icon: imageUrl('item-3.svg'),
      placeholder: imageUrl('item-3_placeholder.svg'),
      card: imageUrl('item-3_card.svg'),
    },
  },
];

export const itemsById = new Map(items.map(item => [item.id, item]));
