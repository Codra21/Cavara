// Original catalogue, ported from the static site. Source for migrations/0002_seed_catalog.sql only
// (bun run seed:generate). D1 is the live source of truth; editing this file changes nothing at runtime.
import type { Category, Product } from "../../src/lib/types";

export const CATEGORIES: Category[] = [
  {
    id: "drinkware",
    name: "Drinkware",
    description: "Cups, glasses and tea service",
    image: "/product-images/Embossed-Ceramic-Cup-11/Embossed-Ceramic-Cup.webp",
  },
  {
    id: "serveware",
    name: "Serveware",
    description: "Dishes, bowls and dipping plates",
    image: "/product-images/Tulip-Flower-Shaped-Dipping-Plate-17/Tulip-Flower-Shaped-Dipping-Plate1.webp",
  },
  {
    id: "kitchen-storage",
    name: "Kitchen Storage",
    description: "Jars, bottles and oil pots",
    image: "/product-images/storage-jar/storage-jar.webp",
  },
  {
    id: "home-accessories",
    name: "Home Accessories",
    description: "Towels and thoughtful accents",
    image: "/product-images/Ceramic-foaming-bottle-20/Ceramic-foaming-bottle3.webp",
  },
];

const MULTI = "conic-gradient(from 20deg, #e86f68, #f2c45f, #79b87b, #77a8d8, #b685c7, #e86f68)";

export const PRODUCTS: Product[] = [
  {
    id: 2,
    slug: "red-polka-bow-cup-bread-plate",
    name: "Red Polka Bow Cup & Bread Plate",
    category: "drinkware",
    price: 1550,
    summary: "Hand-painted red polka bow cup & bread plate set.",
    details: ["Cup size – 220 ml", "Plate size – 16 cm"],
    note: "Perfect for serving tea, coffee, and light bites in any setting.",
    variants: [
      {
        name: "Off-white",
        swatch: "#EDE2C7",
        images: [
          "/product-images/BCC-P/cup-plate-food.webp",
          "/product-images/BCC-P/cup-plate-stand.webp",
          "/product-images/BCC-P/cup-plate-hand.webp",
          "/product-images/BCC-P/cup-plate.webp",
        ],
      },
    ],
  },
  {
    id: 3,
    slug: "ceramic-storage-jar-bamboo-lid-set",
    name: "Ceramic Storage Jar With Bamboo Lid (Set)",
    category: "kitchen-storage",
    price: 4800,
    summary: "Ceramic storage jar with bamboo lid (3 pieces).",
    details: ["Capacity – 800 ml", "Material – Ceramic", "Lid – Bamboo"],
    note: "Vacuum-sealed design, perfect for storing coffee, sugar, tea, and spices, while adding a premium touch to your home décor.",
    variants: [
      {
        name: "White",
        swatch: "#F5F5F5",
        images: [
          "/product-images/storage-jar/storage-jar.webp",
          "/product-images/storage-jar/storage-demo.webp",
          "/product-images/storage-jar/storage-lid.webp",
          "/product-images/storage-jar/storage-jar-size.webp",
          "/product-images/storage-jar/storage-jar1.webp",
        ],
      },
    ],
  },
  {
    id: 4,
    slug: "jelly-bean-amphora-rectangular-dish",
    name: "Jelly Bean Amphora Rectangular Dish",
    category: "serveware",
    price: 1050,
    summary: "Jelly Bean Amphora dish – 9\" (rectangular).",
    details: ["Material – Ceramic", "Available in Custard Yellow, Pink, Green, Purple"],
    note: "Perfect for luxury home serving with a vibrant, elegant touch.",
    variants: [
      {
        name: "Green",
        swatch: "#C2E5D3",
        images: ["/product-images/jba-rect/jbar-green2.webp", "/product-images/jba-rect/jbar-green1.webp"],
      },
      {
        name: "Custard Yellow",
        swatch: "#F4E77C",
        images: ["/product-images/jba-rect/jbar-yellow1.webp", "/product-images/jba-rect/jbar-mix1.webp"],
      },
      {
        name: "Pink",
        swatch: "#FFB6C1",
        images: ["/product-images/jba-rect/jbar-pink1.webp", "/product-images/jba-rect/jbar-mix2.webp"],
      },
      {
        name: "Purple",
        swatch: "#DA8EE7",
        images: ["/product-images/jba-rect/jbar-purple1.webp", "/product-images/jba-rect/jbar-mix3.webp"],
      },
    ],
  },
  {
    id: 1,
    slug: "ceramic-storage-jar-bamboo-lid-single",
    name: "Ceramic Storage Jar With Bamboo Lid (Single)",
    category: "kitchen-storage",
    price: 1650,
    summary: "Ceramic storage jar with bamboo lid (1 piece).",
    details: ["Capacity – 800 ml", "Material – Ceramic", "Lid – Bamboo"],
    note: "Vacuum-sealed design, perfect for storing coffee, sugar, tea, and spices, while adding a premium touch to your home décor.",
    variants: [
      {
        name: "White",
        swatch: "#F5F5F5",
        images: [
          "/product-images/storage-jar/storage-single.webp",
          "/product-images/storage-jar/storage-demo.webp",
          "/product-images/storage-jar/storage-lid.webp",
          "/product-images/storage-jar/storage-jar-size.webp",
          "/product-images/storage-jar/storage-jar-single.webp",
        ],
      },
    ],
  },
  {
    id: 5,
    slug: "jelly-bean-amphora-octagonal-dish",
    name: "Jelly Bean Amphora Octagonal Dish",
    category: "serveware",
    price: 1250,
    summary: "Jelly Bean Amphora dish – 9.5\" (octagonal).",
    details: ["Material – Ceramic", "Available in Custard Yellow, Pink, Green, Purple"],
    note: "Perfect for luxury home serving with a vibrant, elegant touch.",
    variants: [
      {
        name: "Custard Yellow",
        swatch: "#F4E77C",
        images: [
          "/product-images/jba-oct/jba-yellow1.webp",
          "/product-images/jba-oct/jba-yellow2.webp",
          "/product-images/jba-oct/jba-yellow3.webp",
        ],
      },
      {
        name: "Pink",
        swatch: "#FFB6C1",
        images: ["/product-images/jba-oct/jba-pink1.webp", "/product-images/jba-oct/jba-pink2.webp"],
      },
      {
        name: "Purple",
        swatch: "#DA8EE7",
        images: [
          "/product-images/jba-oct/jba-purple1.webp",
          "/product-images/jba-oct/jba-purple2.webp",
          "/product-images/jba-oct/jba-mix.webp",
        ],
      },
      {
        name: "Green",
        swatch: "#C2E5D3",
        images: ["/product-images/jba-oct/jba-green1.webp", "/product-images/jba-oct/jba-green2.webp"],
      },
    ],
  },
  {
    id: 6,
    slug: "leaf-hand-towel",
    name: "Leaf Hand Towel",
    category: "home-accessories",
    price: 200,
    summary: "Leaf-shaped hand towel in soft coral fleece.",
    details: ["Pink leaves – 25 × 17 cm", "Green leaves – 30 × 17 cm", "Material – Coral fleece", "Yarn specification – 150D"],
    variants: [
      {
        name: "Pink leaves",
        swatch: "#F4B8C7",
        images: [
          "/product-images/leaf-hand-towel-6/leaf-hand-towel-pink1.webp",
          "/product-images/leaf-hand-towel-6/leaf-hand-towel-pink2.webp",
        ],
      },
      {
        name: "Green leaves",
        swatch: "#9CCB91",
        images: [
          "/product-images/leaf-hand-towel-6/leaf-hand-towel-green1.webp",
          "/product-images/leaf-hand-towel-6/leaf-hand-towel-green2.webp",
        ],
      },
    ],
  },
  {
    id: 7,
    slug: "coffee-themed-hand-towel",
    name: "Coffee Themed Hand Towel",
    category: "home-accessories",
    price: 200,
    summary: "Coffee-themed hand towel in soft coral fleece.",
    details: ["Charity coffee beans – 21 × 20 cm", "Baguette – 23 × 18 cm", "Material – Coral fleece", "Yarn specification – 150D"],
    variants: [
      {
        name: "Charity coffee beans",
        swatch: "#6F4E37",
        images: [
          "/product-images/coffee-hand-towel-7/coffee-hand-towel-bean.webp",
          "/product-images/coffee-hand-towel-7/coffee-hand-towel-all.webp",
        ],
      },
      {
        name: "Baguette",
        swatch: "#DEB887",
        images: [
          "/product-images/coffee-hand-towel-7/coffee-hand-towel-baguette.webp",
          "/product-images/coffee-hand-towel-7/coffee-hand-towel-all2.webp",
        ],
      },
    ],
  },
  {
    id: 8,
    slug: "cocktail-tower-glass",
    name: "Cocktail Tower Glass",
    category: "drinkware",
    price: 700,
    summary: "Frosted cocktail tower glass.",
    details: ["Material – Glass", "Frosted coating", "Capacity – 200–300 ml"],
    variants: [
      {
        name: "Vibrant Pink",
        swatch: "#E0799C",
        images: [
          "/product-images/cocktail-tower-glass-8/cocktail-tower-glass.webp",
          "/product-images/cocktail-tower-glass-8/cocktail-tower-glass2.webp",
        ],
      },
    ],
  },
  {
    id: 9,
    slug: "persimmon-harvest-tissue-purse",
    name: "Persimmon Harvest Tissue Purse",
    category: "home-accessories",
    price: 2950,
    summary: "Handcrafted ceramic tissue holder with persimmon detailing.",
    details: ["Material – Ceramic", "Handcrafted", "Size – 20 × 15 × 13 cm"],
    variants: [
      {
        name: "Cream",
        swatch: "#EDE6DF",
        images: [
          "/product-images/persimmon-tissue-purse-9/persimmon-tissue-purse.webp",
          "/product-images/persimmon-tissue-purse-9/persimmon-tissue-purse-1.webp",
        ],
      },
    ],
  },
  {
    id: 11,
    slug: "embossed-ceramic-cup",
    name: "Embossed Ceramic Cup",
    category: "drinkware",
    price: 1350,
    summary: "Embossed ceramic cup with hand-finished floral relief.",
    details: ["Material – Ceramic", "Capacity – 400 ml"],
    variants: [
      {
        name: "Multi-color",
        swatch: MULTI,
        images: ["/product-images/Embossed-Ceramic-Cup-11/Embossed-Ceramic-Cup.webp"],
      },
      {
        name: "Embossed peony flower-pink",
        swatch: "#D14786",
        images: ["/product-images/Embossed-Ceramic-Cup-11/Embossed-peony-flower-pink.webp"],
      },
      {
        name: "Embossed begonia flower-yellow",
        swatch: "#E7D84A",
        images: ["/product-images/Embossed-Ceramic-Cup-11/Embossed-begonia-flower-yellow.webp"],
      },
      {
        name: "Embossed rose flower-blue",
        swatch: "#9CCFE6",
        images: ["/product-images/Embossed-Ceramic-Cup-11/Embossed-rose-flower-blue.webp"],
      },
    ],
  },
  {
    id: 10,
    slug: "hand-painted-ceramic-breakfast-cup",
    name: "Hand Painted Ceramic Breakfast Cup",
    category: "drinkware",
    price: 1350,
    summary: "Hand-painted ceramic breakfast cup with a twisted handle.",
    details: ["Material – Ceramic", "Capacity – 400 ml"],
    variants: [
      {
        name: "Multi-color",
        swatch: MULTI,
        images: [
          "/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/hand-painted-cup1.webp",
          "/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/hand-painted-cup2.webp",
        ],
      },
      {
        name: "Princess bear red handle",
        swatch: "#C70606",
        images: [
          "/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/princess-bear-red-handle.webp",
          "/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/princess-bear-red-handle1.webp",
        ],
      },
      {
        name: "Green Tulip",
        swatch: "#0A621D",
        images: ["/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/green-tulip.webp"],
      },
      {
        name: "Strawberry checkerboard",
        swatch: "#D7263D",
        images: ["/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/strawberry-checkerboard.webp"],
      },
      {
        name: "Two-color flower",
        swatch: "#AC60B3",
        images: ["/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/two-color-flower.webp"],
      },
      {
        name: "Four color tulips",
        swatch: "#CCBF52",
        images: ["/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/four-color-tulips.webp"],
      },
      {
        name: "Rice grain flower",
        swatch: "#E36DAC",
        images: ["/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/rice-grain-flower.webp"],
      },
      {
        name: "Starry sky",
        swatch: "#C77856",
        images: ["/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/starry-sky.webp"],
      },
      {
        name: "Sugar grain cream",
        swatch: "#56D651",
        images: ["/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/sugar-grain-cream.webp"],
      },
      {
        name: "Brown orange plaid-orange handle",
        swatch: "#E36217",
        images: ["/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/brown-orange-plaid-orange-handle.webp"],
      },
      {
        name: "Orange pink plaid-pink handle",
        swatch: "#F09A56",
        images: [
          "/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/orange-pink-plain-pink-handle.webp",
          "/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/orange-pink-plain-pink-handle2.webp",
        ],
      },
      {
        name: "Red and green plaid-red handle",
        swatch: "#DE1818",
        images: ["/product-images/Hand-Painted-Ceramic-Breakfast-Cup-10/red-green-plaid-red-handle.webp"],
      },
    ],
  },
  {
    id: 12,
    slug: "ceramic-long-handled-twist-spoon",
    name: "Ceramic Long-Handled Twist Spoon",
    category: "serveware",
    price: 250,
    summary: "Ceramic spoon with a long twisted handle.",
    details: ["Size – 15 × 4 cm", "Material – Ceramic"],
    variants: [
      {
        name: "Cream",
        swatch: "#EDE6DF",
        images: [
          "/product-images/Ceramic-Long-Handled-Twist-Spoon-12/Ceramic-Long-Handled-Twist-Spoon1.webp",
          "/product-images/Ceramic-Long-Handled-Twist-Spoon-12/Ceramic-Long-Handled-Twist-Spoon2.webp",
          "/product-images/Ceramic-Long-Handled-Twist-Spoon-12/Ceramic-Long-Handled-Twist-Spoon3.webp",
          "/product-images/Ceramic-Long-Handled-Twist-Spoon-12/Ceramic-Long-Handled-Twist-Spoon4.webp",
          "/product-images/Ceramic-Long-Handled-Twist-Spoon-12/Ceramic-Long-Handled-Twist-Spoon5.webp",
          "/product-images/Ceramic-Long-Handled-Twist-Spoon-12/Ceramic-Long-Handled-Twist-Spoon6.webp",
        ],
      },
    ],
  },
  {
    id: 13,
    slug: "unicorn-threaded-cup",
    name: "Unicorn Threaded Cup",
    category: "drinkware",
    price: 1650,
    summary: "Threaded ceramic cup with a dustproof lid and steel spoon.",
    details: ["Cup mouth – 9 cm", "Height – 15 cm", "Material – Ceramic", "Includes cup lid + complimentary steel spoon"],
    note: "The steel spoon is a random gift and may not be shown in the detailed pictures. The cup lid is a dustproof lid only; it is not sealed or airtight.",
    variants: [
      {
        name: "Cream",
        swatch: "#EDE6DF",
        images: [
          "/product-images/Unicorn-Threaded-Cup-13/Unicorn-Threaded-Cup1.webp",
          "/product-images/Unicorn-Threaded-Cup-13/Unicorn-Threaded-Cup2.webp",
          "/product-images/Unicorn-Threaded-Cup-13/Unicorn-Threaded-Cup3.webp",
          "/product-images/Unicorn-Threaded-Cup-13/Unicorn-Threaded-Cup4.webp",
          "/product-images/Unicorn-Threaded-Cup-13/Unicorn-Threaded-Cup5.webp",
          "/product-images/Unicorn-Threaded-Cup-13/Unicorn-Threaded-Cup6.webp",
        ],
      },
    ],
  },
  {
    id: 14,
    slug: "rainbow-unicorn-spiral-cup",
    name: "Rainbow Unicorn Spiral Cup",
    category: "drinkware",
    price: 1400,
    summary: "Spiral ceramic cup with a unicorn lid and steel spoon.",
    details: ["Mouth – 8 cm", "Height – about 9.6 cm without lid", "Material – Ceramic", "Packaging – Paper box", "Includes unicorn cup lid + steel spoon"],
    note: "The steel spoon is a random gift and may not be shown in the detailed pictures.",
    variants: [
      {
        name: "Cream",
        swatch: "#EDE6DF",
        images: [
          "/product-images/Rainbow-Unicorn-Spiral-Cup-14/Rainbow-Unicorn-Spiral-Cup1.webp",
          "/product-images/Rainbow-Unicorn-Spiral-Cup-14/Rainbow-Unicorn-Spiral-Cup2.webp",
          "/product-images/Rainbow-Unicorn-Spiral-Cup-14/Rainbow-Unicorn-Spiral-Cup3.webp",
        ],
      },
    ],
  },
  {
    id: 15,
    slug: "red-flower-straw-cup",
    name: "Red Flower Straw Cup",
    category: "drinkware",
    price: 1750,
    summary: "Ceramic straw cup with a silicone lid and glass straw.",
    details: ["Includes silicone lid + glass straw", "Material – Ceramic", "Capacity – 400 ml", "Size – 12 × 17 × 5.5 cm"],
    variants: [
      {
        name: "Orange",
        swatch: "#D67918",
        images: [
          "/product-images/Red-Flower-Straw-Cup-15/Red-Flower-Straw-Cup3.webp",
          "/product-images/Red-Flower-Straw-Cup-15/Red-Flower-Straw-Cup2.webp",
          "/product-images/Red-Flower-Straw-Cup-15/Red-Flower-Straw-Cup1.webp",
          "/product-images/Red-Flower-Straw-Cup-15/Red-Flower-Straw-Cup4.webp",
        ],
      },
    ],
  },
  {
    id: 16,
    slug: "souvenir-tea-set",
    name: "Souvenir Tea Set",
    category: "drinkware",
    price: 3450,
    summary: "Ceramic tea set finished in gold and silver tones.",
    details: ["Color – Gold and silver", "Material – Ceramic"],
    variants: [
      {
        name: "Gold-Silver",
        swatch: "linear-gradient(135deg, #C9A45C 0 50%, #D8DADB 50% 100%)",
        images: ["/product-images/Souvenir-Tea-Set-16/Souvenir-Tea-Set.webp"],
      },
    ],
  },
  {
    id: 17,
    slug: "tulip-flower-shaped-dipping-plate",
    name: "Tulip Flower Shaped Dipping Plate",
    category: "serveware",
    price: 390,
    summary: "Tulip-shaped ceramic dipping plate.",
    details: ["Material – Ceramic", "Size – 7.5 × 11.5 × 2.4 cm"],
    variants: [
      {
        name: "Cream",
        swatch: "#F1CF6B",
        images: [
          "/product-images/Tulip-Flower-Shaped-Dipping-Plate-17/Tulip-Flower-Shaped-Dipping-Plate1.webp",
          "/product-images/Tulip-Flower-Shaped-Dipping-Plate-17/Tulip-Flower-Shaped-Dipping-Plate2.webp",
          "/product-images/Tulip-Flower-Shaped-Dipping-Plate-17/Tulip-Flower-Shaped-Dipping-Plate3.webp",
        ],
      },
    ],
  },
  {
    id: 18,
    slug: "ceramic-cheese-shaped-dipping-plate",
    name: "Ceramic Cheese-Shaped Dipping Plate",
    category: "serveware",
    price: 390,
    summary: "Cheese-shaped ceramic dipping plate.",
    details: ["Material – Ceramic", "Size – 8 × 7.5 × 1.7 cm"],
    variants: [
      {
        name: "Yellow",
        swatch: "#E6DF27",
        images: [
          "/product-images/Ceramic-Cheese-Shaped-Dipping-Plate-18/Ceramic-Cheese-Shaped-Dipping-Plate-1.webp",
          "/product-images/Ceramic-Cheese-Shaped-Dipping-Plate-18/Ceramic-Cheese-Shaped-Dipping-Plate-2.webp",
          "/product-images/Ceramic-Cheese-Shaped-Dipping-Plate-18/Ceramic-Cheese-Shaped-Dipping-Plate-3.webp",
        ],
      },
    ],
  },
  {
    id: 19,
    slug: "ceramic-duck-dipping-sauce-dish",
    name: "Ceramic Duck Dipping Sauce Dish",
    category: "serveware",
    price: 400,
    summary: "Duck-shaped ceramic dipping sauce dish.",
    details: ["Size – 11 × 5.5 × 5.7 cm", "Material – Ceramic"],
    variants: [
      {
        name: "White",
        swatch: "#E6E6DA",
        images: [
          "/product-images/Ceramic-Duck-Dipping-Sauce-Dish-19/Ceramic-Duck-Dipping-Sauce-Dish1.webp",
          "/product-images/Ceramic-Duck-Dipping-Sauce-Dish-19/Ceramic-Duck-Dipping-Sauce-Dish2.webp",
        ],
      },
    ],
  },
  {
    id: 20,
    slug: "ceramic-foaming-bottle",
    name: "Ceramic Foaming Bottle",
    category: "home-accessories",
    price: 1680,
    summary: "Decorative ceramic foaming bottle.",
    details: ["Size – 12.8 × 8.5 cm", "Material – Ceramic"],
    variants: [
      {
        name: "White",
        swatch: "#E6E6DA",
        images: [
          "/product-images/Ceramic-foaming-bottle-20/Ceramic-foaming-bottle1.webp",
          "/product-images/Ceramic-foaming-bottle-20/Ceramic-foaming-bottle2.webp",
          "/product-images/Ceramic-foaming-bottle-20/Ceramic-foaming-bottle3.webp",
        ],
      },
    ],
  },
  {
    id: 21,
    slug: "ceramic-seasoning-bottle",
    name: "Ceramic Seasoning Bottle",
    category: "kitchen-storage",
    price: 1850,
    summary: "Hand-decorated ceramic seasoning bottle.",
    details: ["Material – Ceramic", "Capacity – 600 ml", "Measurement – 25 × 12.5 cm"],
    variants: [
      {
        name: "White",
        swatch: "#E6E6DA",
        images: [
          "/product-images/Ceramic-Seasoning-Bottle-21/Ceramic-Seasoning-Bottle1.webp",
          "/product-images/Ceramic-Seasoning-Bottle-21/Ceramic-Seasoning-Bottle2.webp",
          "/product-images/Ceramic-Seasoning-Bottle-21/Ceramic-Seasoning-Bottle3.webp",
        ],
      },
    ],
  },
  {
    id: 22,
    slug: "vintage-ceramic-oil-pot",
    name: "Vintage Ceramic Oil Pot",
    category: "kitchen-storage",
    price: 1100,
    summary: "Vintage-inspired ceramic oil pot.",
    details: ["Capacity – 350 ml", "Dimension – 12.8 × 7.5 cm"],
    variants: [
      {
        name: "White",
        swatch: "#E6E6DA",
        images: [
          "/product-images/vintage-Ceramic-Oil-Pot-22/vintage-Ceramic-Oil-Pot1.webp",
          "/product-images/vintage-Ceramic-Oil-Pot-22/vintage-Ceramic-Oil-Pot2.webp",
          "/product-images/vintage-Ceramic-Oil-Pot-22/vintage-Ceramic-Oil-Pot3.webp",
          "/product-images/vintage-Ceramic-Oil-Pot-22/vintage-Ceramic-Oil-Pot4.webp",
        ],
      },
    ],
  },
  {
    id: 23,
    slug: "retro-ceramic-portable-fruit-basket",
    name: "Retro Ceramic Portable Fruit Basket",
    category: "serveware",
    price: 1900,
    summary: "Retro ceramic fruit basket with a carry handle.",
    details: ["Material – Ceramic", "Dimension – 16.5 × 7 cm"],
    variants: [
      {
        name: "White",
        swatch: "#E6E6DA",
        images: [
          "/product-images/Retro-Ceramic-Portable-Fruit-Basket-23/Retro-Ceramic-Portable-Fruit-Basket1.webp",
          "/product-images/Retro-Ceramic-Portable-Fruit-Basket-23/Retro-Ceramic-Portable-Fruit-Basket2.webp",
          "/product-images/Retro-Ceramic-Portable-Fruit-Basket-23/Retro-Ceramic-Portable-Fruit-Basket3.webp",
          "/product-images/Retro-Ceramic-Portable-Fruit-Basket-23/Retro-Ceramic-Portable-Fruit-Basket4.webp",
          "/product-images/Retro-Ceramic-Portable-Fruit-Basket-23/Retro-Ceramic-Portable-Fruit-Basket5.webp",
          "/product-images/Retro-Ceramic-Portable-Fruit-Basket-23/Retro-Ceramic-Portable-Fruit-Basket6.webp",
        ],
      },
    ],
  },
  {
    id: 24,
    slug: "orange-fruit-fork-bowl",
    name: "Orange Fruit Fork Bowl",
    category: "serveware",
    price: 1850,
    summary: "Orange-shaped ceramic fruit bowl with six forks.",
    details: ["Includes 6 forks", "Material – Ceramic", "Bowl – 17.5 × 9 cm", "Fork – 8 cm"],
    variants: [
      {
        name: "Orange",
        swatch: "#E58A18",
        images: [
          "/product-images/orange-fruit-fork-bowl-24/orange-fruit-fork-bowl1.webp",
          "/product-images/orange-fruit-fork-bowl-24/orange-fruit-fork-bowl2.webp",
          "/product-images/orange-fruit-fork-bowl-24/orange-fruit-fork-bowl3.webp",
          "/product-images/orange-fruit-fork-bowl-24/orange-fruit-fork-bowl4.webp",
          "/product-images/orange-fruit-fork-bowl-24/orange-fruit-fork-bowl5.webp",
        ],
      },
    ],
  },
];
