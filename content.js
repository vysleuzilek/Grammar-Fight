// All texts for the rounds. Edit freely.

export const ROUNDS = {
  deal: { n: 1, title: "Deal or No Deal?", sub: "Is the sentence correct? Swipe right = DEAL, left = NO DEAL." },
  builder: { n: 2, title: "Sentence Builder", sub: "Join two sentences into one. Tap the words in the right order." },
  words: { n: 3, title: "Shop Words", sub: "Match each word with its meaning. Every pair = money!" },
  dialog: { n: 4, title: "Max & Zoe", sub: "Help Max sell the headphones. Choose the missing word." },
  pitch: { n: 5, title: "Pitch Battle", sub: "Sell your product in ONE sentence with the first conditional." },
};
export const DEFAULT_PLAN = ["deal", "builder", "words", "dialog", "pitch"];

// ---------- Round 1: Deal or No Deal (ok = correct sentence?) ----------
export const DEALS = [
  { s: "If you order today, you'll get free shipping.", ok: true },
  { s: "If you will buy two, you'll get one free.", ok: false, fix: "If you buy two, you'll get one free." },
  { s: "When the shop opens, I'll buy a new phone.", ok: true },
  { s: "Unless you don't hurry, you'll miss the sale.", ok: false, fix: "Unless you hurry, you'll miss the sale." },
  { s: "As soon as the package arrives, I'll call you.", ok: true },
  { s: "I'll wait until the price will go down.", ok: false, fix: "I'll wait until the price goes down." },
  { s: "If it rains tomorrow, we'll sell more umbrellas.", ok: true },
  { s: "When you will see the price, you'll love it.", ok: false, fix: "When you see the price, you'll love it." },
  { s: "If you sign up, you get a discount tomorrow.", ok: false, fix: "If you sign up, you'll get a discount tomorrow." },
  { s: "I'll send you the receipt as soon as you pay.", ok: true },
];
export const DEAL_MS = 9000, REVEAL_MS = 3800;

// ---------- Round 2: Sentence Builder ----------
// a / b = the two short sentences, use = word to join them, t = correct tiles in order, d = trap tile
export const BUILDS = [
  { a: "It rains.", b: "You need an umbrella.", use: "If", t: ["If", "it", "rains,", "you'll", "need", "an", "umbrella."], d: "will" },
  { a: "You order now.", b: "You get 20% off.", use: "If", t: ["If", "you", "order", "now,", "you'll", "get", "20%", "off."], d: "will" },
  { a: "The shop opens.", b: "I buy the new phone.", use: "When", t: ["When", "the", "shop", "opens,", "I'll", "buy", "the", "new", "phone."], d: "will" },
  { a: "You try it.", b: "You love it.", use: "As soon as", t: ["As soon as", "you", "try", "it,", "you'll", "love", "it."], d: "will" },
  { a: "You don't hurry.", b: "The offer ends.", use: "Unless", t: ["Unless", "you", "hurry,", "the", "offer", "will", "end."], d: "don't" },
  { a: "I get my salary.", b: "I buy new shoes.", use: "When", t: ["When", "I", "get", "my", "salary,", "I'll", "buy", "new", "shoes."], d: "will" },
  { a: "The price goes down.", b: "We buy two.", use: "If", t: ["If", "the", "price", "goes", "down,", "we'll", "buy", "two."], d: "will" },
  { a: "You pay.", b: "I send the receipt.", use: "as soon as", t: ["I'll", "send", "the", "receipt", "as soon as", "you", "pay."], d: "will" },
  { a: "You sign up.", b: "You get a free gift.", use: "If", t: ["If", "you", "sign", "up,", "you'll", "get", "a", "free", "gift."], d: "will" },
  { a: "It's sunny.", b: "We sell ice cream.", use: "When", t: ["When", "it's", "sunny,", "we'll", "sell", "ice", "cream."], d: "will" },
  { a: "You don't read the reviews.", b: "You make a mistake.", use: "Unless", t: ["Unless", "you", "read", "the", "reviews,", "you'll", "make", "a", "mistake."], d: "don't" },
  { a: "The package arrives.", b: "I call you.", use: "As soon as", t: ["As soon as", "the", "package", "arrives,", "I'll", "call", "you."], d: "will" },
];
export const BUILD_POINTS = 2;

// ---------- Round 3: Shop Words ----------
export const WORDS = [
  ["discount", "a lower price than usual"],
  ["refund", "money you get back when you return something"],
  ["bestseller", "a product that sells very well"],
  ["free shipping", "delivery that costs nothing"],
  ["out of stock", "not available to buy right now"],
  ["bargain", "something you buy for a very good price"],
  ["receipt", "a paper that shows what you paid"],
  ["review", "a customer's opinion about a product"],
  ["warranty", "a promise to repair a broken product"],
  ["customer", "a person who buys something"],
  ["limited offer", "a deal only for a short time"],
  ["upsell", "to sell a more expensive or extra product"],
  ["sale", "a time when prices are lower"],
  ["price tag", "a small label that shows how much it costs"],
  ["cashier", "a person who takes your money in a shop"],
  ["brand", "the name of a company and its products"],
  ["advertisement", "a video or picture that tries to sell something"],
  ["delivery", "bringing a product to your home"],
  ["shopping cart", "where you put products before you pay"],
  ["promo code", "a secret word that gives you a discount"],
  ["wholesale", "selling big amounts to shops, not to customers"],
  ["loyalty card", "a card that gives you rewards for shopping"],
];
export const WORD_KC = 20, WORD_WRONG_KC = -20;

// ---------- Round 4: Max & Zoe dialogue ----------
// lines without "o" are just shown; lines with "o" have a gap (___) and options, k = correct index
export const DIALOG = [
  { who: "max", s: "Good morning! Can I help you?" },
  { who: "zoe", s: "I'm looking for headphones. My budget is 1,000 Kč." },
  { who: "max", s: "These are our ___. Everybody loves them!", o: ["bestseller", "refund", "receipt"], k: 0 },
  { who: "zoe", s: "They're 1,200 Kč. That's over my budget." },
  { who: "max", s: "If you ___ them today, I'll give you a 10% discount.", o: ["buy", "will buy", "bought"], k: 0 },
  { who: "zoe", s: "Hmm... and what if they break?" },
  { who: "max", s: "No problem. You'll get a two-year ___.", o: ["warranty", "bargain", "customer"], k: 0 },
  { who: "zoe", s: "And when will they arrive?" },
  { who: "max", s: "As soon as you ___, we'll send them. And shipping is free!", o: ["pay", "will pay", "paid"], k: 0 },
  { who: "zoe", s: "1,080 Kč with free shipping? That's a real ___!", o: ["bargain", "refund", "warranty"], k: 0 },
  { who: "max", s: "Great! Unless you ___, this offer will end at midnight.", o: ["hurry", "don't hurry", "will hurry"], k: 0 },
  { who: "zoe", s: "Okay, it's a ___! I'll take them.", o: ["deal", "discount", "review"], k: 0 },
];
export const GAP_MS = 13000;

// ---------- Round 5: Pitch Battle ----------
export const PRODUCTS = ["an energy drink", "an umbrella", "funny socks", "a fidget spinner", "a school backpack", "a phone case",
  "a chocolate bar", "an alarm clock", "a plant", "sunglasses", "headphones", "a pizza", "a pen", "a water bottle", "a hoodie",
  "a power bank", "a skateboard", "a coffee mug", "a lamp", "a notebook"];
export const PITCH_WRITE_MS = 100000, PITCH_VOTE_MS = 50000;
export const PITCH_SUBMIT_POINTS = 1, PITCH_VOTE_POINTS = 2;

// Timed self-paced rounds
export const BUILD_MS = 180000, WORDS_MS = 120000;

// ---------- Scoring extras ----------
export const SPEED_POINTS = [3, 2, 2];   // 1st, 2nd, 3rd correct answer (rounds Deal + Max & Zoe); others +1
export const WRONG_POINTS = -1;          // wrong answer in those two rounds
export const STREAK_EVERY = 5, STREAK_BONUS = 1; // +1 for every 5 correct in a row

// ---------- Shop before the final ----------
export const START_MONEY = 100, SHOP_MS = 45000;
export const ITEMS = {
  helmet: { name: "Helmet", icon: "🪖", price: 300, desc: "+30 % HP in the fight" },
  energy: { name: "Energy Drink", icon: "⚡", price: 500, desc: "Only 0.5 s pause after a wrong answer" },
  gloves: { name: "Golden Gloves", icon: "🥊", price: 800, desc: "+50 % punch damage" },
};
