// Shared by tools/layout.mjs (solver sweep) and tools/layout-dom.mjs (real-browser check): the phone viewports both run over.
// CSS viewport sizes (portrait W x H), as the page sees them with browser chrome hidden or shown
export const PHONES = {
  'iPhone SE 1': [320, 568], 'iPhone SE 2/3': [375, 667], 'iPhone 8 Plus': [414, 736], 'iPhone X/11 Pro': [375, 812], 'iPhone 14': [390, 844],
  'iPhone 15 Pro Max': [430, 932], 'Galaxy S8': [360, 740], 'Galaxy S20/S21': [360, 800], 'Galaxy S23 Ultra': [384, 824], 'Pixel 5': [393, 851],
  'Pixel 7': [412, 915], 'Redmi Note 13 Pro': [393, 873], 'Realme C3': [360, 720], 'Galaxy A series': [360, 780], 'Android Go 16:9': [360, 640],
  'Fold outer': [344, 882], 'Fold inner': [673, 841], 'small tablet': [600, 960], 'iPad mini': [744, 1133],
  // same phones with the URL bar / gesture bar eating height
  'iPhone 14 (Safari bars)': [390, 664], 'Pixel 7 (Chrome bar)': [412, 780], 'Redmi (Chrome bar)': [393, 760], 'SE 2/3 (Safari bars)': [375, 553]
};
// phones with no notch / cutout (home-button iPhones, the 16:9 Android Go): the notch inset variant is skipped for them, it can't happen there
export const NO_NOTCH = new Set(['iPhone SE 1', 'iPhone SE 2/3', 'iPhone 8 Plus', 'SE 2/3 (Safari bars)', 'Android Go 16:9']);
// safe-area insets in CSS px for a portrait / landscape viewport (notch + home bar)
export const insFor = (W, H, notch) => !notch ? { l: 0, r: 0, t: 0, b: 0 } : W <= H ? { l: 0, r: 0, t: 47, b: 34 } : { l: 47, r: 47, t: 0, b: 21 };
