'use strict';
/**
 * seed-test-data.js
 * Generates realistic dummy data for development/testing.
 *
 * Can be run standalone:
 *   node api/scripts/seed-test-data.js
 *
 * Or imported by the /api/seed route.
 */

const pool = require('../src/db/pool');

// ── Reference data ─────────────────────────────────────────────────────────────

const UNITS = [
  { name: 'Kilogram',     abbreviation: 'kg',    type: 'mass'   },
  { name: 'Gram',         abbreviation: 'g',     type: 'mass'   },
  { name: 'Litre',        abbreviation: 'l',     type: 'volume' },
  { name: 'Millilitre',   abbreviation: 'ml',    type: 'volume' },
  { name: 'Each',         abbreviation: 'ea',    type: 'count'  },
  { name: 'Pound',        abbreviation: 'lb',    type: 'mass'   },
  { name: 'Ounce',        abbreviation: 'oz',    type: 'mass'   },
  { name: 'Fluid Ounce',  abbreviation: 'fl oz', type: 'volume' },
  { name: 'Portion',      abbreviation: 'ptn',   type: 'count'  },
  { name: 'Box',          abbreviation: 'box',   type: 'count'  },
];

const PRICE_LEVELS = [
  { name: 'Eat-In',   description: 'Table service / dine in', is_default: true  },
  { name: 'Takeaway', description: 'Counter / takeaway',      is_default: false },
  { name: 'Delivery', description: 'Home delivery via app',   is_default: false },
];

const COUNTRIES = [
  {
    name: 'United Kingdom', currency_code: 'GBP', currency_symbol: '£', exchange_rate: 1.27,
    taxes: [
      { name: 'Standard VAT', rate: 0.20,    is_default: true  },
      { name: 'Zero Rate',    rate: 0.00,    is_default: false },
    ],
    // UK: Eat-In food is standard-rated; cold takeaway is zero-rated; delivery is standard-rated
    levelTax: { 'Eat-In': 'Standard VAT', 'Takeaway': 'Zero Rate', 'Delivery': 'Standard VAT' },
  },
  {
    name: 'United States', currency_code: 'USD', currency_symbol: '$', exchange_rate: 1.00,
    taxes: [
      { name: 'Sales Tax',  rate: 0.08875, is_default: true  },
      { name: 'Tax Exempt', rate: 0.00,    is_default: false },
    ],
    // US: Eat-In and Delivery are taxable; Takeaway grocery food often exempt
    levelTax: { 'Eat-In': 'Sales Tax', 'Takeaway': 'Tax Exempt', 'Delivery': 'Sales Tax' },
  },
  {
    name: 'France', currency_code: 'EUR', currency_symbol: '€', exchange_rate: 1.08,
    taxes: [
      { name: 'TVA Service', rate: 0.10,   is_default: true  },
      { name: 'TVA Réduit',  rate: 0.055,  is_default: false },
    ],
    // France: restaurant service 10%; takeaway food 5.5% reduced rate
    levelTax: { 'Eat-In': 'TVA Service', 'Takeaway': 'TVA Réduit', 'Delivery': 'TVA Service' },
  },
  {
    name: 'Germany', currency_code: 'EUR', currency_symbol: '€', exchange_rate: 1.08,
    taxes: [
      { name: 'MwSt Standard', rate: 0.19, is_default: true  },
      { name: 'MwSt Ermäßigt', rate: 0.07, is_default: false },
    ],
    // Germany: Eat-In 19%; Takeaway and Delivery reduced 7%
    levelTax: { 'Eat-In': 'MwSt Standard', 'Takeaway': 'MwSt Ermäßigt', 'Delivery': 'MwSt Ermäßigt' },
  },
];

const ING_CATEGORIES = [
  'Meat & Poultry', 'Seafood', 'Dairy & Eggs', 'Produce - Vegetables',
  'Produce - Fruit', 'Dry Goods & Grains', 'Canned & Preserved',
  'Oils & Fats', 'Spices & Herbs', 'Sauces & Condiments', 'Bakery', 'Beverages',
];

const REC_CATEGORIES = ['Starters', 'Mains', 'Sides', 'Desserts', 'Beverages'];

const VENDORS = [
  { name: 'Metro Foodservice',    country: 'United Kingdom' },
  { name: 'Brakes Wholesale',     country: 'United Kingdom' },
  { name: 'Bidvest Foodservice',  country: 'United Kingdom' },
  { name: 'Sysco Corporation',    country: 'United States'  },
  { name: 'US Foods',             country: 'United States'  },
  { name: 'Gordon Food Service',  country: 'United States'  },
  { name: 'Transgourmet France',  country: 'France'         },
  { name: 'Pomona Qualité',       country: 'France'         },
  { name: 'CHEFS Culinar',        country: 'Germany'        },
  { name: 'Transgourmet Germany', country: 'Germany'        },
];

// Ingredient templates: [name, category, unit, waste%, basePrice USD/unit]
const ING_TEMPLATES = [
  // Meat & Poultry (20)
  ['Chicken Breast',      'Meat & Poultry', 'kg',  5, 8.50],
  ['Chicken Thigh',       'Meat & Poultry', 'kg',  8, 5.20],
  ['Chicken Wing',        'Meat & Poultry', 'kg', 10, 3.80],
  ['Chicken Drumstick',   'Meat & Poultry', 'kg', 12, 3.40],
  ['Whole Chicken',       'Meat & Poultry', 'kg', 15, 4.20],
  ['Turkey Breast',       'Meat & Poultry', 'kg',  5, 9.80],
  ['Duck Breast',         'Meat & Poultry', 'kg',  8, 14.50],
  ['Beef Mince',          'Meat & Poultry', 'kg',  0, 10.20],
  ['Beef Sirloin',        'Meat & Poultry', 'kg',  5, 28.00],
  ['Beef Brisket',        'Meat & Poultry', 'kg',  5, 14.00],
  ['Beef Ribeye',         'Meat & Poultry', 'kg',  5, 32.00],
  ['Beef Fillet',         'Meat & Poultry', 'kg',  3, 45.00],
  ['Pork Loin',           'Meat & Poultry', 'kg',  5, 9.50],
  ['Pork Belly',          'Meat & Poultry', 'kg',  5, 7.80],
  ['Pork Shoulder',       'Meat & Poultry', 'kg',  5, 6.40],
  ['Pork Mince',          'Meat & Poultry', 'kg',  0, 7.20],
  ['Lamb Chops',          'Meat & Poultry', 'kg', 10, 22.00],
  ['Lamb Shoulder',       'Meat & Poultry', 'kg', 15, 18.00],
  ['Lamb Mince',          'Meat & Poultry', 'kg',  0, 16.00],
  ['Lamb Rack',           'Meat & Poultry', 'kg',  8, 38.00],
  // Seafood (15)
  ['Salmon Fillet',       'Seafood', 'kg',  5, 18.00],
  ['Cod Fillet',          'Seafood', 'kg',  5, 14.00],
  ['Tuna Steak',          'Seafood', 'kg',  3, 22.00],
  ['Sea Bass Fillet',     'Seafood', 'kg',  5, 24.00],
  ['Haddock Fillet',      'Seafood', 'kg',  5, 12.00],
  ['Mackerel Fillet',     'Seafood', 'kg',  8, 8.00],
  ['Trout Fillet',        'Seafood', 'kg',  5, 16.00],
  ['Tiger Prawns',        'Seafood', 'kg',  0, 20.00],
  ['King Prawns',         'Seafood', 'kg',  0, 24.00],
  ['Squid',               'Seafood', 'kg', 15, 8.00],
  ['Mussels',             'Seafood', 'kg', 20, 4.50],
  ['Crab Claws',          'Seafood', 'kg',  0, 28.00],
  ['Scallops',            'Seafood', 'ea',  0, 3.50],
  ['Sardines',            'Seafood', 'kg', 10, 6.00],
  ['Lobster Tail',        'Seafood', 'ea',  0, 18.00],
  // Dairy & Eggs (15)
  ['Whole Milk',          'Dairy & Eggs', 'l',  0, 1.20],
  ['Double Cream',        'Dairy & Eggs', 'l',  0, 4.50],
  ['Single Cream',        'Dairy & Eggs', 'l',  0, 3.20],
  ['Unsalted Butter',     'Dairy & Eggs', 'kg', 0, 9.00],
  ['Salted Butter',       'Dairy & Eggs', 'kg', 0, 8.50],
  ['Cheddar Cheese',      'Dairy & Eggs', 'kg', 0, 12.00],
  ['Mozzarella',          'Dairy & Eggs', 'kg', 0, 10.00],
  ['Parmesan',            'Dairy & Eggs', 'kg', 0, 28.00],
  ['Feta Cheese',         'Dairy & Eggs', 'kg', 0, 14.00],
  ['Ricotta',             'Dairy & Eggs', 'kg', 0, 8.00],
  ['Mascarpone',          'Dairy & Eggs', 'kg', 0, 10.00],
  ['Greek Yoghurt',       'Dairy & Eggs', 'kg', 0, 4.50],
  ['Sour Cream',          'Dairy & Eggs', 'kg', 0, 4.00],
  ['Cream Cheese',        'Dairy & Eggs', 'kg', 0, 7.00],
  ['Eggs',                'Dairy & Eggs', 'ea', 0, 0.45],
  // Produce - Vegetables (28)
  ['Plum Tomatoes',       'Produce - Vegetables', 'kg',  5, 2.20],
  ['Cherry Tomatoes',     'Produce - Vegetables', 'kg',  5, 4.50],
  ['Beefsteak Tomatoes',  'Produce - Vegetables', 'kg',  5, 3.00],
  ['Onions',              'Produce - Vegetables', 'kg',  8, 0.80],
  ['Red Onions',          'Produce - Vegetables', 'kg',  8, 1.20],
  ['Shallots',            'Produce - Vegetables', 'kg', 10, 3.00],
  ['Garlic',              'Produce - Vegetables', 'kg', 15, 4.00],
  ['Ginger',              'Produce - Vegetables', 'kg', 20, 5.00],
  ['Potatoes',            'Produce - Vegetables', 'kg', 10, 0.70],
  ['Sweet Potatoes',      'Produce - Vegetables', 'kg',  8, 1.80],
  ['Carrots',             'Produce - Vegetables', 'kg',  8, 0.80],
  ['Celery',              'Produce - Vegetables', 'kg', 15, 1.50],
  ['Leek',                'Produce - Vegetables', 'kg', 20, 2.20],
  ['Broccoli',            'Produce - Vegetables', 'kg', 15, 2.80],
  ['Cauliflower',         'Produce - Vegetables', 'kg', 15, 2.40],
  ['Spinach',             'Produce - Vegetables', 'kg',  5, 3.50],
  ['Kale',                'Produce - Vegetables', 'kg',  8, 4.00],
  ['Rocket',              'Produce - Vegetables', 'kg',  3, 8.00],
  ['Iceberg Lettuce',     'Produce - Vegetables', 'ea',  5, 1.20],
  ['Cucumber',            'Produce - Vegetables', 'ea',  3, 0.80],
  ['Courgette',           'Produce - Vegetables', 'kg',  3, 2.00],
  ['Aubergine',           'Produce - Vegetables', 'ea',  3, 1.20],
  ['Red Bell Pepper',     'Produce - Vegetables', 'ea',  5, 0.90],
  ['Mushrooms',           'Produce - Vegetables', 'kg',  5, 3.50],
  ['Asparagus',           'Produce - Vegetables', 'kg', 10, 8.00],
  ['Green Beans',         'Produce - Vegetables', 'kg',  5, 3.00],
  ['White Cabbage',       'Produce - Vegetables', 'kg',  8, 1.20],
  ['Portobello Mushrooms','Produce - Vegetables', 'kg',  5, 6.00],
  // Produce - Fruit (10)
  ['Avocado',             'Produce - Fruit', 'ea', 20, 1.20],
  ['Lemon',               'Produce - Fruit', 'ea',  0, 0.30],
  ['Lime',                'Produce - Fruit', 'ea',  0, 0.25],
  ['Orange',              'Produce - Fruit', 'ea',  0, 0.40],
  ['Apple',               'Produce - Fruit', 'ea',  5, 0.35],
  ['Strawberries',        'Produce - Fruit', 'kg',  5, 6.50],
  ['Raspberries',         'Produce - Fruit', 'kg',  3, 12.00],
  ['Blueberries',         'Produce - Fruit', 'kg',  2, 10.00],
  ['Mango',               'Produce - Fruit', 'ea', 25, 1.50],
  ['Pineapple',           'Produce - Fruit', 'ea', 30, 2.50],
  // Dry Goods & Grains (20)
  ['Plain Flour',         'Dry Goods & Grains', 'kg', 0, 0.80],
  ['Bread Flour',         'Dry Goods & Grains', 'kg', 0, 1.20],
  ['Self-Raising Flour',  'Dry Goods & Grains', 'kg', 0, 1.00],
  ['Cornflour',           'Dry Goods & Grains', 'kg', 0, 1.50],
  ['Basmati Rice',        'Dry Goods & Grains', 'kg', 0, 2.50],
  ['Arborio Rice',        'Dry Goods & Grains', 'kg', 0, 3.80],
  ['Long Grain Rice',     'Dry Goods & Grains', 'kg', 0, 2.00],
  ['Spaghetti',           'Dry Goods & Grains', 'kg', 0, 1.80],
  ['Penne',               'Dry Goods & Grains', 'kg', 0, 1.80],
  ['Fusilli',             'Dry Goods & Grains', 'kg', 0, 1.80],
  ['White Sugar',         'Dry Goods & Grains', 'kg', 0, 1.00],
  ['Brown Sugar',         'Dry Goods & Grains', 'kg', 0, 1.40],
  ['Icing Sugar',         'Dry Goods & Grains', 'kg', 0, 1.80],
  ['Baking Powder',       'Dry Goods & Grains', 'kg', 0, 3.50],
  ['Breadcrumbs',         'Dry Goods & Grains', 'kg', 0, 2.00],
  ['Panko Breadcrumbs',   'Dry Goods & Grains', 'kg', 0, 4.50],
  ['Rolled Oats',         'Dry Goods & Grains', 'kg', 0, 1.50],
  ['Dark Chocolate',      'Dry Goods & Grains', 'kg', 0, 12.00],
  ['Dried Yeast',         'Dry Goods & Grains', 'kg', 0, 8.00],
  ['Vanilla Extract',     'Dry Goods & Grains', 'l',  0, 40.00],
  // Canned & Preserved (10)
  ['Tinned Tomatoes',     'Canned & Preserved', 'ea', 0, 1.20],
  ['Tinned Chickpeas',    'Canned & Preserved', 'ea', 0, 1.00],
  ['Tinned Kidney Beans', 'Canned & Preserved', 'ea', 0, 1.00],
  ['Coconut Milk',        'Canned & Preserved', 'ea', 0, 1.80],
  ['Tomato Purée',        'Canned & Preserved', 'kg', 0, 3.50],
  ['Passata',             'Canned & Preserved', 'l',  0, 2.80],
  ['Sun-Dried Tomatoes',  'Canned & Preserved', 'kg', 0, 14.00],
  ['Tinned Sweetcorn',    'Canned & Preserved', 'ea', 0, 0.90],
  ['Olives',              'Canned & Preserved', 'kg', 0, 8.00],
  ['Capers',              'Canned & Preserved', 'kg', 0, 12.00],
  // Oils & Fats (8)
  ['Olive Oil',           'Oils & Fats', 'l', 0, 6.50],
  ['Extra Virgin Olive Oil','Oils & Fats','l', 0, 12.00],
  ['Sunflower Oil',       'Oils & Fats', 'l', 0, 2.50],
  ['Vegetable Oil',       'Oils & Fats', 'l', 0, 2.00],
  ['Sesame Oil',          'Oils & Fats', 'l', 0, 8.00],
  ['Rapeseed Oil',        'Oils & Fats', 'l', 0, 3.00],
  ['Coconut Oil',         'Oils & Fats', 'l', 0, 10.00],
  ['Ghee',                'Oils & Fats', 'kg',0, 12.00],
  // Spices & Herbs (21)
  ['Sea Salt',            'Spices & Herbs', 'kg', 0, 2.00],
  ['Black Pepper',        'Spices & Herbs', 'kg', 0, 8.00],
  ['Paprika',             'Spices & Herbs', 'kg', 0, 6.00],
  ['Smoked Paprika',      'Spices & Herbs', 'kg', 0, 8.00],
  ['Cumin',               'Spices & Herbs', 'kg', 0, 10.00],
  ['Turmeric',            'Spices & Herbs', 'kg', 0, 8.00],
  ['Cinnamon',            'Spices & Herbs', 'kg', 0, 12.00],
  ['Dried Thyme',         'Spices & Herbs', 'kg', 0, 14.00],
  ['Dried Oregano',       'Spices & Herbs', 'kg', 0, 12.00],
  ['Dried Basil',         'Spices & Herbs', 'kg', 0, 12.00],
  ['Chilli Flakes',       'Spices & Herbs', 'kg', 0, 10.00],
  ['Cayenne Pepper',      'Spices & Herbs', 'kg', 0, 10.00],
  ['Garam Masala',        'Spices & Herbs', 'kg', 0, 12.00],
  ['Curry Powder',        'Spices & Herbs', 'kg', 0, 10.00],
  ['Chinese Five Spice',  'Spices & Herbs', 'kg', 0, 14.00],
  ['Lemongrass',          'Spices & Herbs', 'kg', 0, 10.00],
  ['Fresh Thyme',         'Spices & Herbs', 'kg',20, 40.00],
  ['Fresh Rosemary',      'Spices & Herbs', 'kg',20, 30.00],
  ['Fresh Basil',         'Spices & Herbs', 'kg',10, 50.00],
  ['Fresh Coriander',     'Spices & Herbs', 'kg',10, 40.00],
  ['Fresh Parsley',       'Spices & Herbs', 'kg',10, 30.00],
  // Sauces & Condiments (12)
  ['Soy Sauce',           'Sauces & Condiments', 'l',  0, 4.00],
  ['Worcestershire Sauce','Sauces & Condiments', 'l',  0, 5.00],
  ['Hot Sauce',           'Sauces & Condiments', 'l',  0, 6.00],
  ['Ketchup',             'Sauces & Condiments', 'kg', 0, 2.50],
  ['Mayonnaise',          'Sauces & Condiments', 'kg', 0, 3.50],
  ['Dijon Mustard',       'Sauces & Condiments', 'kg', 0, 6.00],
  ['Wholegrain Mustard',  'Sauces & Condiments', 'kg', 0, 5.00],
  ['White Wine Vinegar',  'Sauces & Condiments', 'l',  0, 3.00],
  ['Balsamic Vinegar',    'Sauces & Condiments', 'l',  0, 8.00],
  ['Fish Sauce',          'Sauces & Condiments', 'l',  0, 5.00],
  ['Oyster Sauce',        'Sauces & Condiments', 'l',  0, 4.50],
  ['Tahini',              'Sauces & Condiments', 'kg', 0, 10.00],
  // Bakery (8)
  ['White Bread',         'Bakery', 'ea', 0, 1.80],
  ['Wholemeal Bread',     'Bakery', 'ea', 0, 2.20],
  ['Sourdough Bread',     'Bakery', 'ea', 0, 4.50],
  ['Baguette',            'Bakery', 'ea', 0, 1.50],
  ['Croissant',           'Bakery', 'ea', 0, 1.20],
  ['Ciabatta Roll',       'Bakery', 'ea', 0, 2.00],
  ['Pitta Bread',         'Bakery', 'ea', 0, 0.40],
  ['Tortilla Wrap',       'Bakery', 'ea', 0, 0.30],
  // Beverages (10)
  ['Orange Juice',        'Beverages', 'l',  0, 2.50],
  ['Apple Juice',         'Beverages', 'l',  0, 2.00],
  ['Sparkling Water',     'Beverages', 'l',  0, 0.80],
  ['Cola',                'Beverages', 'l',  0, 1.20],
  ['Lemonade',            'Beverages', 'l',  0, 1.50],
  ['Coffee Beans',        'Beverages', 'kg', 0, 18.00],
  ['Green Tea',           'Beverages', 'kg', 0, 25.00],
  ['White Wine',          'Beverages', 'l',  0, 8.00],
  ['Red Wine',            'Beverages', 'l',  0, 7.00],
  ['Beer',                'Beverages', 'l',  0, 2.50],
];
// Total base templates: 20+15+15+28+10+20+10+8+21+12+8+10 = 177
// With 6 variants × 177 = 1062 → capped at 1000

const VARIANTS = [null, '(Fresh)', '(Frozen)', '(Organic)', '(Premium)', '(Economy)'];

function generateIngredientList() {
  const result = [];
  for (const variant of VARIANTS) {
    for (const [name, category, unit, wastePct, basePrice] of ING_TEMPLATES) {
      const fullName       = variant ? `${name} ${variant}` : name;
      const priceMultiplier = (variant === '(Organic)' || variant === '(Premium)') ? 1.25
                            : variant === '(Economy)' ? 0.75 : 1.0;
      result.push({ name: fullName, category, unit, wastePct, basePrice: +(basePrice * priceMultiplier).toFixed(4) });
      if (result.length === 1000) return result;
    }
  }
  return result;
}

// Recipe templates: { name, category, yield:[qty, unitAbbr], items:[[ingName, qty]] }
const RECIPE_TEMPLATES = [
  // Starters (12)
  { name: 'Garlic Bread',          category: 'Starters',  yield: [4,  'ea' ], items: [['Baguette',0.25],['Unsalted Butter',0.05],['Garlic',0.02],['Fresh Parsley',0.01]] },
  { name: 'Tomato Soup',           category: 'Starters',  yield: [4,  'ptn'], items: [['Tinned Tomatoes',2],['Onions',0.2],['Garlic',0.02],['Olive Oil',0.05],['Sea Salt',0.01],['Balsamic Vinegar',0.02]] },
  { name: 'Caesar Salad',          category: 'Starters',  yield: [2,  'ptn'], items: [['Iceberg Lettuce',1],['Parmesan',0.05],['Mayonnaise',0.08],['Lemon',1]] },
  { name: 'Bruschetta',            category: 'Starters',  yield: [4,  'ea' ], items: [['Sourdough Bread',0.3],['Cherry Tomatoes',0.2],['Extra Virgin Olive Oil',0.04],['Garlic',0.02],['Fresh Basil',0.01]] },
  { name: 'Prawn Cocktail',        category: 'Starters',  yield: [2,  'ptn'], items: [['King Prawns',0.2],['Mayonnaise',0.06],['Ketchup',0.02],['Lemon',1],['Iceberg Lettuce',0.5]] },
  { name: 'Calamari',              category: 'Starters',  yield: [2,  'ptn'], items: [['Squid',0.3],['Plain Flour',0.1],['Sea Salt',0.01],['Lemon',1],['Vegetable Oil',0.2]] },
  { name: 'Mushroom Pâté',         category: 'Starters',  yield: [4,  'ptn'], items: [['Mushrooms',0.4],['Unsalted Butter',0.04],['Garlic',0.02],['Fresh Thyme',0.005],['Cream Cheese',0.1]] },
  { name: 'Chicken Wings',         category: 'Starters',  yield: [2,  'ptn'], items: [['Chicken Wing',0.5],['Soy Sauce',0.05],['Hot Sauce',0.03],['Garlic',0.02],['Vegetable Oil',0.05]] },
  { name: 'Avocado Toast',         category: 'Starters',  yield: [2,  'ptn'], items: [['Avocado',2],['Sourdough Bread',0.5],['Lemon',1],['Sea Salt',0.005],['Chilli Flakes',0.003]] },
  { name: 'Smoked Salmon Blinis',  category: 'Starters',  yield: [4,  'ptn'], items: [['Salmon Fillet',0.15],['Cream Cheese',0.08],['Lemon',1],['Fresh Parsley',0.01]] },
  { name: 'Burrata Salad',         category: 'Starters',  yield: [2,  'ptn'], items: [['Mozzarella',0.25],['Cherry Tomatoes',0.2],['Extra Virgin Olive Oil',0.05],['Fresh Basil',0.01],['Balsamic Vinegar',0.03]] },
  { name: 'Crispy Calamari',       category: 'Starters',  yield: [2,  'ptn'], items: [['Squid',0.25],['Panko Breadcrumbs',0.08],['Plain Flour',0.05],['Eggs',1],['Sea Salt',0.01]] },
  // Mains (20)
  { name: 'Grilled Chicken Breast',category: 'Mains',     yield: [2,  'ptn'], items: [['Chicken Breast',0.4],['Olive Oil',0.03],['Garlic',0.02],['Dried Thyme',0.005],['Sea Salt',0.01]] },
  { name: 'Fish & Chips',          category: 'Mains',     yield: [2,  'ptn'], items: [['Cod Fillet',0.4],['Potatoes',0.6],['Plain Flour',0.15],['Vegetable Oil',0.5],['Sea Salt',0.01]] },
  { name: 'Spaghetti Bolognese',   category: 'Mains',     yield: [4,  'ptn'], items: [['Spaghetti',0.4],['Beef Mince',0.5],['Tinned Tomatoes',2],['Onions',0.2],['Garlic',0.03],['Olive Oil',0.04]] },
  { name: 'Chicken Curry',         category: 'Mains',     yield: [4,  'ptn'], items: [['Chicken Breast',0.8],['Tinned Tomatoes',1],['Coconut Milk',1],['Onions',0.3],['Garlic',0.03],['Curry Powder',0.02],['Vegetable Oil',0.05]] },
  { name: 'Beef Burger',           category: 'Mains',     yield: [2,  'ptn'], items: [['Beef Mince',0.4],['White Bread',2],['Cheddar Cheese',0.05],['Iceberg Lettuce',0.5],['Beefsteak Tomatoes',0.3],['Mayonnaise',0.04],['Ketchup',0.04]] },
  { name: 'Margherita Pizza',      category: 'Mains',     yield: [2,  'ptn'], items: [['Bread Flour',0.3],['Mozzarella',0.2],['Passata',0.15],['Fresh Basil',0.01],['Olive Oil',0.03],['Dried Yeast',0.01]] },
  { name: 'Salmon with Greens',    category: 'Mains',     yield: [2,  'ptn'], items: [['Salmon Fillet',0.4],['Asparagus',0.2],['Unsalted Butter',0.04],['Lemon',1],['Capers',0.02],['Sea Salt',0.01]] },
  { name: 'Lamb Chops',            category: 'Mains',     yield: [2,  'ptn'], items: [['Lamb Chops',0.5],['Garlic',0.03],['Fresh Rosemary',0.01],['Olive Oil',0.04],['Sea Salt',0.01]] },
  { name: 'Prawn Linguine',        category: 'Mains',     yield: [2,  'ptn'], items: [['Spaghetti',0.2],['King Prawns',0.2],['Garlic',0.03],['Chilli Flakes',0.005],['Olive Oil',0.05],['Fresh Parsley',0.01],['Lemon',1]] },
  { name: 'Mushroom Risotto',      category: 'Mains',     yield: [4,  'ptn'], items: [['Arborio Rice',0.4],['Mushrooms',0.4],['Parmesan',0.08],['Onions',0.2],['Unsalted Butter',0.06],['White Wine',0.2]] },
  { name: 'Sirloin Steak',         category: 'Mains',     yield: [2,  'ptn'], items: [['Beef Sirloin',0.5],['Unsalted Butter',0.04],['Garlic',0.02],['Fresh Thyme',0.01],['Sea Salt',0.01],['Black Pepper',0.005]] },
  { name: 'Pork Belly Roast',      category: 'Mains',     yield: [4,  'ptn'], items: [['Pork Belly',1.0],['Sea Salt',0.02],['Black Pepper',0.01],['Garlic',0.04],['Fresh Rosemary',0.01],['Olive Oil',0.05]] },
  { name: 'Duck Breast à l\'Orange',category:'Mains',     yield: [2,  'ptn'], items: [['Duck Breast',0.4],['Orange',2],['White Sugar',0.05],['Balsamic Vinegar',0.04],['Sea Salt',0.01]] },
  { name: 'Buddha Bowl',           category: 'Mains',     yield: [2,  'ptn'], items: [['Basmati Rice',0.2],['Avocado',2],['Tinned Chickpeas',1],['Spinach',0.1],['Cherry Tomatoes',0.1],['Tahini',0.04],['Lemon',1]] },
  { name: 'Club Sandwich',         category: 'Mains',     yield: [2,  'ptn'], items: [['White Bread',6],['Chicken Breast',0.2],['Mayonnaise',0.05],['Iceberg Lettuce',0.5],['Beefsteak Tomatoes',0.3]] },
  { name: 'Spinach & Cheese Quiche',category:'Mains',     yield: [6,  'ptn'], items: [['Plain Flour',0.2],['Unsalted Butter',0.1],['Eggs',4],['Double Cream',0.2],['Cheddar Cheese',0.15],['Spinach',0.1]] },
  { name: 'Thai Green Curry',      category: 'Mains',     yield: [4,  'ptn'], items: [['Chicken Breast',0.6],['Coconut Milk',2],['Basmati Rice',0.4],['Ginger',0.02],['Garlic',0.03],['Fish Sauce',0.03],['Lemongrass',0.02]] },
  { name: 'BBQ Pork Ribs',         category: 'Mains',     yield: [2,  'ptn'], items: [['Pork Belly',0.8],['Ketchup',0.1],['Brown Sugar',0.05],['Smoked Paprika',0.01],['Worcestershire Sauce',0.04],['Garlic',0.02]] },
  { name: 'Chicken Caesar Wrap',   category: 'Mains',     yield: [2,  'ptn'], items: [['Tortilla Wrap',2],['Chicken Breast',0.3],['Parmesan',0.04],['Iceberg Lettuce',0.5],['Mayonnaise',0.05],['Lemon',1]] },
  { name: 'Tuna Niçoise Salad',    category: 'Mains',     yield: [2,  'ptn'], items: [['Tuna Steak',0.3],['Eggs',2],['Potatoes',0.2],['Green Beans',0.1],['Olives',0.05],['Lemon',1],['Olive Oil',0.04]] },
  // Sides (8)
  { name: 'Chips',                 category: 'Sides',     yield: [4,  'ptn'], items: [['Potatoes',1.0],['Vegetable Oil',0.5],['Sea Salt',0.01]] },
  { name: 'Side Salad',            category: 'Sides',     yield: [2,  'ptn'], items: [['Iceberg Lettuce',1],['Cherry Tomatoes',0.1],['Cucumber',0.5],['Olive Oil',0.03],['White Wine Vinegar',0.02]] },
  { name: 'Seasonal Vegetables',   category: 'Sides',     yield: [4,  'ptn'], items: [['Broccoli',0.3],['Carrots',0.2],['Asparagus',0.2],['Unsalted Butter',0.03],['Sea Salt',0.005]] },
  { name: 'Garlic Mashed Potato',  category: 'Sides',     yield: [4,  'ptn'], items: [['Potatoes',1.0],['Unsalted Butter',0.08],['Whole Milk',0.15],['Garlic',0.02],['Sea Salt',0.01]] },
  { name: 'Coleslaw',              category: 'Sides',     yield: [6,  'ptn'], items: [['White Cabbage',0.5],['Carrots',0.2],['Mayonnaise',0.1],['White Wine Vinegar',0.02],['White Sugar',0.02]] },
  { name: 'Steamed Basmati Rice',  category: 'Sides',     yield: [4,  'ptn'], items: [['Basmati Rice',0.4],['Sea Salt',0.005]] },
  { name: 'Onion Rings',           category: 'Sides',     yield: [2,  'ptn'], items: [['Onions',0.3],['Plain Flour',0.1],['Eggs',1],['Breadcrumbs',0.1],['Vegetable Oil',0.4],['Sea Salt',0.01]] },
  { name: 'Roast Potatoes',        category: 'Sides',     yield: [4,  'ptn'], items: [['Potatoes',1.2],['Sunflower Oil',0.1],['Dried Thyme',0.005],['Garlic',0.02],['Sea Salt',0.01]] },
  // Desserts (8)
  { name: 'Chocolate Brownie',     category: 'Desserts',  yield: [9,  'ea' ], items: [['Dark Chocolate',0.2],['Unsalted Butter',0.15],['White Sugar',0.2],['Eggs',3],['Plain Flour',0.08]] },
  { name: 'Vanilla Panna Cotta',   category: 'Desserts',  yield: [4,  'ptn'], items: [['Double Cream',0.5],['White Sugar',0.06],['Vanilla Extract',0.005],['Strawberries',0.1]] },
  { name: 'Cheesecake',            category: 'Desserts',  yield: [8,  'ptn'], items: [['Cream Cheese',0.6],['White Sugar',0.12],['Eggs',3],['Double Cream',0.2],['Vanilla Extract',0.005]] },
  { name: 'Crème Brûlée',          category: 'Desserts',  yield: [4,  'ptn'], items: [['Double Cream',0.5],['Eggs',5],['White Sugar',0.12],['Vanilla Extract',0.005]] },
  { name: 'Tiramisu',              category: 'Desserts',  yield: [6,  'ptn'], items: [['Mascarpone',0.5],['Eggs',4],['White Sugar',0.1],['Coffee Beans',0.05],['Icing Sugar',0.03]] },
  { name: 'Fruit Pavlova',         category: 'Desserts',  yield: [6,  'ptn'], items: [['Eggs',4],['White Sugar',0.2],['Double Cream',0.3],['Strawberries',0.2],['Raspberries',0.1],['Blueberries',0.1]] },
  { name: 'Apple Crumble',         category: 'Desserts',  yield: [6,  'ptn'], items: [['Apple',6],['Plain Flour',0.15],['Rolled Oats',0.1],['Brown Sugar',0.1],['Unsalted Butter',0.1],['Cinnamon',0.005]] },
  { name: 'Chocolate Mousse',      category: 'Desserts',  yield: [4,  'ptn'], items: [['Dark Chocolate',0.15],['Double Cream',0.3],['Eggs',3],['White Sugar',0.04]] },
];
// Total recipes: 12 + 20 + 8 + 8 = 48

// Eat-In base sell prices per recipe per menu, in the menu's local currency.
// Takeaway = ×0.90, Delivery = ×1.15 (see LEVEL_MULTIPLIERS below).
const MENU_PRICES = {
  'UK Lunch Menu': {
    'Garlic Bread': 5.50, 'Tomato Soup': 7.50, 'Bruschetta': 7.00, 'Avocado Toast': 9.00,
    'Fish & Chips': 16.00, 'Beef Burger': 14.00, 'Club Sandwich': 13.00,
    'Grilled Chicken Breast': 16.00, 'Chicken Caesar Wrap': 12.00,
    'Mushroom Risotto': 16.00, 'Spinach & Cheese Quiche': 13.00,
    'Chips': 4.50, 'Side Salad': 5.50, 'Garlic Mashed Potato': 5.00,
    'Coleslaw': 3.50, 'Onion Rings': 5.00,
    'Chocolate Brownie': 7.00, 'Apple Crumble': 7.50,
  },
  'UK Dinner Menu': {
    'Caesar Salad': 10.00, 'Prawn Cocktail': 11.00, 'Smoked Salmon Blinis': 12.00,
    'Burrata Salad': 11.00, 'Mushroom Pâté': 9.00, 'Calamari': 10.00,
    'Sirloin Steak': 32.00, 'Lamb Chops': 28.00, 'Salmon with Greens': 24.00,
    'Fish & Chips': 18.00, 'Pork Belly Roast': 22.00, 'Spaghetti Bolognese': 15.00,
    'BBQ Pork Ribs': 22.00, "Duck Breast à l'Orange": 26.00,
    'Chips': 5.00, 'Seasonal Vegetables': 6.00, 'Roast Potatoes': 5.50,
    'Garlic Mashed Potato': 5.50, 'Side Salad': 5.50,
    'Chocolate Mousse': 8.50, 'Crème Brûlée': 8.00, 'Cheesecake': 7.50, 'Fruit Pavlova': 9.00,
  },
  'US Lunch Menu': {
    'Chicken Wings': 14.00, 'Avocado Toast': 13.00, 'Caesar Salad': 13.00,
    'Beef Burger': 17.00, 'Club Sandwich': 16.00, 'Chicken Curry': 18.00,
    'BBQ Pork Ribs': 24.00, 'Grilled Chicken Breast': 19.00,
    'Tuna Niçoise Salad': 22.00, 'Chicken Caesar Wrap': 15.00,
    'Chips': 6.00, 'Coleslaw': 5.00, 'Onion Rings': 7.00, 'Side Salad': 7.00,
    'Chocolate Brownie': 9.00, 'Cheesecake': 9.00,
  },
  'France Dinner Menu': {
    'Bruschetta': 9.00, 'Burrata Salad': 14.00, 'Tomato Soup': 9.00, 'Crispy Calamari': 13.00,
    "Duck Breast à l'Orange": 28.00, 'Salmon with Greens': 26.00,
    'Lamb Chops': 30.00, 'Mushroom Risotto': 19.00, 'Prawn Linguine': 22.00,
    'Thai Green Curry': 19.00, 'Sirloin Steak': 34.00,
    'Seasonal Vegetables': 7.00, 'Side Salad': 6.00, 'Steamed Basmati Rice': 5.00,
    'Crème Brûlée': 10.00, 'Tiramisu': 10.00, 'Vanilla Panna Cotta': 9.00, 'Fruit Pavlova': 11.00,
  },
};

// Multipliers applied to Eat-In base price per price level
const LEVEL_MULTIPLIERS = { 'Eat-In': 1.00, 'Takeaway': 0.90, 'Delivery': 1.15 };

// 4 menus — each is { name, country, items: [recipeName, ...] }
const MENUS = [
  {
    name: 'UK Lunch Menu',
    country: 'United Kingdom',
    items: [
      'Garlic Bread','Tomato Soup','Bruschetta','Avocado Toast',
      'Fish & Chips','Beef Burger','Club Sandwich','Grilled Chicken Breast','Chicken Caesar Wrap','Mushroom Risotto','Spinach & Cheese Quiche',
      'Chips','Side Salad','Garlic Mashed Potato','Coleslaw','Onion Rings',
      'Chocolate Brownie','Apple Crumble',
    ],
  },
  {
    name: 'UK Dinner Menu',
    country: 'United Kingdom',
    items: [
      'Caesar Salad','Prawn Cocktail','Smoked Salmon Blinis','Burrata Salad','Mushroom Pâté','Calamari',
      'Sirloin Steak','Lamb Chops','Salmon with Greens','Fish & Chips','Pork Belly Roast','Spaghetti Bolognese','BBQ Pork Ribs','Duck Breast à l\'Orange',
      'Chips','Seasonal Vegetables','Roast Potatoes','Garlic Mashed Potato','Side Salad',
      'Chocolate Mousse','Crème Brûlée','Cheesecake','Fruit Pavlova',
    ],
  },
  {
    name: 'US Lunch Menu',
    country: 'United States',
    items: [
      'Chicken Wings','Avocado Toast','Caesar Salad',
      'Beef Burger','Club Sandwich','Chicken Curry','BBQ Pork Ribs','Grilled Chicken Breast','Tuna Niçoise Salad','Chicken Caesar Wrap',
      'Chips','Coleslaw','Onion Rings','Side Salad',
      'Chocolate Brownie','Cheesecake',
    ],
  },
  {
    name: 'France Dinner Menu',
    country: 'France',
    items: [
      'Bruschetta','Burrata Salad','Tomato Soup','Crispy Calamari',
      'Duck Breast à l\'Orange','Salmon with Greens','Lamb Chops','Mushroom Risotto','Prawn Linguine','Thai Green Curry','Sirloin Steak',
      'Seasonal Vegetables','Side Salad','Steamed Basmati Rice',
      'Crème Brûlée','Tiramisu','Vanilla Panna Cotta','Fruit Pavlova',
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Bulk insert rows in chunks. columns = array of column names, rows = array of arrays. Returns inserted row ids if RETURNING id, else nothing. */
async function bulkInsert(client, table, columns, rows, returning = false) {
  if (!rows.length) return [];
  const CHUNK = 200;
  const ids = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk.map((_, ri) =>
      `(${columns.map((__, ci) => `$${ri * columns.length + ci + 1}`).join(', ')})`
    ).join(', ');
    const params = chunk.flat();
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}${returning ? ' RETURNING id' : ''}`;
    const { rows: r } = await client.query(sql, params);
    if (returning) ids.push(...r.map(x => x.id));
  }
  return ids;
}

// ── Clear ──────────────────────────────────────────────────────────────────────

async function clearData(client) {
  await client.query(`
    TRUNCATE TABLE
      mcogs_menu_item_prices,
      mcogs_menu_items,
      mcogs_menus,
      mcogs_recipe_items,
      mcogs_recipes,
      mcogs_ingredient_preferred_vendor,
      mcogs_price_quotes,
      mcogs_ingredients,
      mcogs_vendors,
      mcogs_categories,
      mcogs_country_level_tax,
      mcogs_country_tax_rates,
      mcogs_countries,
      mcogs_price_levels,
      mcogs_units,
      mcogs_locations
    RESTART IDENTITY CASCADE
  `);
}

// ── Seed ───────────────────────────────────────────────────────────────────────

async function seedData(client, log = console.log) {

  // 1. Units
  const unitIds = await bulkInsert(client, 'mcogs_units', ['name', 'abbreviation', 'type'],
    UNITS.map(u => [u.name, u.abbreviation, u.type]), true);
  const unitMap = {}; // abbr → id
  UNITS.forEach((u, i) => { unitMap[u.abbreviation] = unitIds[i]; });
  log(`✓ ${unitIds.length} units created`);

  // 2. Price Levels
  const plIds = await bulkInsert(client, 'mcogs_price_levels', ['name', 'description', 'is_default'],
    PRICE_LEVELS.map(pl => [pl.name, pl.description, pl.is_default]), true);
  log(`✓ ${plIds.length} price levels created`);

  // 3. Countries + tax rates + country-level-tax
  const countryIds    = [];
  const countryTaxMaps = []; // [{ taxName → taxRateId }, ...] — same order as COUNTRIES
  let taxRateCount = 0;
  for (const c of COUNTRIES) {
    const { rows: [country] } = await client.query(
      `INSERT INTO mcogs_countries (name, currency_code, currency_symbol, exchange_rate, default_price_level_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [c.name, c.currency_code, c.currency_symbol, c.exchange_rate, plIds[0]]
    );
    countryIds.push(country.id);

    // Insert all tax rates for this country
    const taxRateMap = {}; // name → id
    for (const tax of c.taxes) {
      const { rows: [tr] } = await client.query(
        `INSERT INTO mcogs_country_tax_rates (country_id, name, rate, is_default)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [country.id, tax.name, tax.rate, tax.is_default]
      );
      taxRateMap[tax.name] = tr.id;
      taxRateCount++;
    }
    countryTaxMaps.push(taxRateMap);

    // Link the correct tax rate to each price level using levelTax mapping
    for (let pi = 0; pi < PRICE_LEVELS.length; pi++) {
      const levelName = PRICE_LEVELS[pi].name;
      const taxName   = c.levelTax[levelName];
      const taxRateId = taxRateMap[taxName];
      if (!taxRateId) continue;
      await client.query(
        `INSERT INTO mcogs_country_level_tax (country_id, price_level_id, tax_rate_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [country.id, plIds[pi], taxRateId]
      );
    }
  }
  log(`✓ ${COUNTRIES.length} countries, ${taxRateCount} tax rates created`);

  // 4. Categories
  const ingCatIds = await bulkInsert(client, 'mcogs_categories',
    ['name', 'group_name', 'type'],
    ING_CATEGORIES.map(n => [n, n, 'ingredient']), true);
  const recCatIds = await bulkInsert(client, 'mcogs_categories',
    ['name', 'group_name', 'type'],
    REC_CATEGORIES.map(n => [n, n, 'recipe']), true);
  log(`✓ ${ingCatIds.length} ingredient + ${recCatIds.length} recipe categories created`);

  // 5. Vendors
  const countryNameMap = {};
  COUNTRIES.forEach((c, i) => { countryNameMap[c.name] = countryIds[i]; });
  const vendorIds = await bulkInsert(client, 'mcogs_vendors', ['name', 'country_id'],
    VENDORS.map(v => [v.name, countryNameMap[v.country]]), true);
  log(`✓ ${vendorIds.length} vendors created`);

  // 6. Ingredients (1000)
  const ingList = generateIngredientList();
  const ingRows = ingList.map(ing => {
    const unitId = unitMap[ing.unit] || unitIds[0]; // fallback to first unit
    return [ing.name, ing.category, unitId, ing.wastePct];
  });
  const ingIds = await bulkInsert(client, 'mcogs_ingredients',
    ['name', 'category', 'base_unit_id', 'waste_pct'], ingRows, true);
  log(`✓ ${ingIds.length} ingredients created`);

  // Build ingredient name → id map for recipe item linking
  const ingNameMap = {};
  ingList.forEach((ing, i) => {
    // Store without variant suffix too, for recipe lookups
    if (!ingNameMap[ing.name]) ingNameMap[ing.name] = ingIds[i];
    // Also index base name (without variant)
    const baseName = ING_TEMPLATES.find(t => ing.name.startsWith(t[0]))?.[0];
    if (baseName && !ingNameMap[baseName]) ingNameMap[baseName] = ingIds[i];
  });

  // 7. Price Quotes (500 — round-robin: ingredient[i] × vendor[i % 10])
  const quoteRows = [];
  const quotedPairs = []; // track for preferred vendors
  for (let i = 0; i < 500; i++) {
    const ingIdx    = i;
    const vendIdx   = i % vendorIds.length;
    const ingId     = ingIds[ingIdx];
    const vendId    = vendorIds[vendIdx];
    const price     = +(ingList[ingIdx].basePrice * (0.9 + (i % 5) * 0.05)).toFixed(4); // slight variance
    const unitAbbr  = ingList[ingIdx].unit;
    quoteRows.push([ingId, vendId, price, 1.0, unitAbbr, true]);
    quotedPairs.push({ ingId, vendorId: vendId, idx: i });
  }
  const quoteIds = await bulkInsert(client, 'mcogs_price_quotes',
    ['ingredient_id', 'vendor_id', 'purchase_price', 'qty_in_base_units', 'purchase_unit', 'is_active'],
    quoteRows, true);
  log(`✓ ${quoteIds.length} price quotes created`);

  // 8. Preferred vendors (one per ingredient per country — use whichever vendor has a quote)
  // Use SAVEPOINT so a schema mismatch here can't abort the whole transaction.
  let pvCount = 0;
  await client.query('SAVEPOINT before_pv');
  try {
    for (let i = 0; i < quotedPairs.length; i++) {
      const { ingId, vendorId } = quotedPairs[i];
      const quoteId = quoteIds[i];
      for (const countryId of countryIds) {
        await client.query(
          `INSERT INTO mcogs_ingredient_preferred_vendor
             (ingredient_id, country_id, vendor_id, quote_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (ingredient_id, country_id) DO NOTHING`,
          [ingId, countryId, vendorId, quoteId]
        );
        pvCount++;
      }
    }
    await client.query('RELEASE SAVEPOINT before_pv');
    log(`✓ ${pvCount} preferred vendor entries created`);
  } catch (pvErr) {
    await client.query('ROLLBACK TO SAVEPOINT before_pv');
    await client.query('RELEASE SAVEPOINT before_pv');
    log(`⚠ Preferred vendors skipped (${pvErr.message})`);
  }

  // 9. Recipes (48)
  const recCatMap = {};
  REC_CATEGORIES.forEach((n, i) => { recCatMap[n] = recCatIds[i]; });

  // Build ingId → unit abbreviation map for recipe item prep_unit
  const ingIdToUnit = {};
  ingIds.forEach((id, i) => { ingIdToUnit[id] = ingList[i].unit; });

  let recipeItemCount = 0;
  const recipeNameMap = {};

  for (const tmpl of RECIPE_TEMPLATES) {
    const yieldUnitId = unitMap[tmpl.yield[1]] || unitIds[4]; // default 'ea'
    const { rows: [rec] } = await client.query(
      `INSERT INTO mcogs_recipes (name, category, yield_qty, yield_unit_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tmpl.name, tmpl.category, tmpl.yield[0], yieldUnitId]
    );
    recipeNameMap[tmpl.name] = rec.id;

    // Recipe items — prep_unit is a text abbreviation (not an FK)
    for (const [ingName, qty] of tmpl.items) {
      const ingId = ingNameMap[ingName];
      if (!ingId) continue; // skip if ingredient not found in seeded list
      const prepUnit = ingIdToUnit[ingId] || 'kg';
      await client.query(
        `INSERT INTO mcogs_recipe_items
           (recipe_id, item_type, ingredient_id, prep_qty, prep_unit, prep_to_base_conversion)
         VALUES ($1, 'ingredient', $2, $3, $4, 1.0)`,
        [rec.id, ingId, qty, prepUnit]
      );
      recipeItemCount++;
    }
  }
  log(`✓ ${RECIPE_TEMPLATES.length} recipes created with ${recipeItemCount} recipe items`);

  // 10. Menus (4) with menu items + a price row per price level
  let menuItemCount = 0;
  let mipCount      = 0;
  for (const menu of MENUS) {
    const countryId  = countryNameMap[menu.country];
    const countryIdx = COUNTRIES.findIndex(c => c.name === menu.country);
    const taxMap     = countryTaxMaps[countryIdx] || {};
    const menuPrices = MENU_PRICES[menu.name]     || {};

    const { rows: [m] } = await client.query(
      `INSERT INTO mcogs_menus (name, country_id) VALUES ($1, $2) RETURNING id`,
      [menu.name, countryId]
    );

    for (const recipeName of menu.items) {
      const recipeId = recipeNameMap[recipeName];
      if (!recipeId) continue;

      // Insert menu item — get back the id so we can attach prices
      const { rows: [mi] } = await client.query(
        `INSERT INTO mcogs_menu_items
           (menu_id, item_type, recipe_id, display_name)
         VALUES ($1, 'recipe', $2, $3) RETURNING id`,
        [m.id, recipeId, recipeName]
      );
      menuItemCount++;

      // Insert one price row per price level
      const eatInPrice = menuPrices[recipeName] || 0;
      for (let pi = 0; pi < PRICE_LEVELS.length; pi++) {
        const levelName  = PRICE_LEVELS[pi].name;
        const multiplier = LEVEL_MULTIPLIERS[levelName] ?? 1.0;
        const sellPrice  = Math.round(eatInPrice * multiplier * 100) / 100;
        if (sellPrice <= 0) continue; // skip if no price defined for this recipe

        const taxName   = COUNTRIES[countryIdx]?.levelTax?.[levelName];
        const taxRateId = taxMap[taxName] || null;

        await client.query(
          `INSERT INTO mcogs_menu_item_prices
             (menu_item_id, price_level_id, sell_price, tax_rate_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (menu_item_id, price_level_id)
           DO UPDATE SET sell_price=$3, tax_rate_id=$4`,
          [mi.id, plIds[pi], sellPrice, taxRateId]
        );
        mipCount++;
      }
    }
  }
  log(`✓ ${MENUS.length} menus, ${menuItemCount} menu items, ${mipCount} item prices seeded`);

  return {
    units: unitIds.length,
    priceLevels: plIds.length,
    countries: countryIds.length,
    categories: ingCatIds.length + recCatIds.length,
    vendors: vendorIds.length,
    ingredients: ingIds.length,
    priceQuotes: quoteIds.length,
    preferredVendors: pvCount,
    recipes: RECIPE_TEMPLATES.length,
    recipeItems: recipeItemCount,
    menus: MENUS.length,
    menuItems: menuItemCount,
    menuItemPrices: mipCount,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { seedData, clearData };

// ── Standalone run ─────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    const client = await pool.connect();
    try {
      console.log('Clearing existing data…');
      await client.query('BEGIN');
      await clearData(client);
      console.log('Seeding test data…');
      await seedData(client, msg => console.log(' ', msg));
      await client.query('COMMIT');
      console.log('\nDone! ✓');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Seed failed:', err.message);
      process.exit(1);
    } finally {
      client.release();
      await pool.end();
    }
  })();
}
