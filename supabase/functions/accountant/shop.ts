// Shopping (POST /shop): the products a question is about, with their prices and photos, from Brave's web search and the shops'
// own pages. Claude says what to look for (find_products on the phone); this finds it. Pure apart from the fetch it's handed, so
// `deno test` can make any part of it fail.
// Every product says how sure its price is: verified (read on the shop's own page just now), search_listed (in the shop's own search
// listing, its page not read), estimated (from a page that isn't a shop's, or a listing over 30 days old). A product with no price is
// still a product, and one part failing (a search, a page, a photo) never loses the rest. Nothing is invented: every product, price
// and photo comes from Brave or a page. Nothing about the person is in it, only what Claude searched for.
import {photoOf, photoUrl} from "./lib.ts";

export type Confidence = "verified" | "search_listed" | "estimated";
export type Condition = "new" | "refurbished" | "used" | "unknown";
/** One product at one shop. `price` null: no price found (confidence null). `priceSource`: the page the price is from. `checked`:
 *  when that price was seen (ISO). `group`: the same model at other shops shares it. */
export interface ShopProduct {
  name: string; brand: string; model: string; group: string;
  retailer: string; host: string; url: string;
  price: number | null; from?: true; currency: "GBP"; confidence: Confidence | null; priceSource: string | null;
  image: string | null; condition: Condition; delivery: number | "free" | null; inStock?: false; checked: string;
  /** Where the price was read, in a few words: the listing's text round it, or "structured data" / "the shop's page" (for checking
   *  it; the phone doesn't pass it on to Claude). */
  evidence?: string;
}
/** What Claude asked for: searches, words every product's name must have, words none may, and a budget (0: none). */
export interface ShopAsk { queries: string[]; match: string[]; exclude: string[]; maxPrice: number }
/** How it went, for the log and the phone's dev line: counts and times only, never a query or a name. */
export interface ShopStats {
  ms: {search: number; verify: number; photos: number; total: number}; cpuMs: number;
  brave: number; braveFailed: number; fallback: number; results: number; candidates: number; relevant: number; returned: number;
  verified: number; listed: number; estimated: number; noPrice: number; photos: number;
  pages: {ok: number; noPrice: number; blocked: number; robots: number; timeout: number; error: number; skipped: number};
}
export type ShopResult = {products: ShopProduct[]; partial?: string; stats: ShopStats} | {error: "unavailable" | "not_configured"; stats: ShopStats};

export const MAX_QUERIES = 6, MAX_RETURNED = 12, MAX_BRAVE = 8, MAX_VERIFY = 8, MAX_PHOTO_SEARCHES = 3, MAX_Q = 120;
const STALE_DAYS = 30, DAY_MS = 86_400_000;

/** What the phone sends: 1 to 6 searches (≤120 characters), up to 6 words to match, 10 to exclude, and a budget (0: none). */
export function readShop(raw: string): ShopAsk | {error: string} {
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return {error: "bad_request"}; }
  const {queries, match = [], exclude = [], max_price = 0} = (body ?? {}) as Record<string, unknown>;
  const words = (v: unknown, max: number, len: number) => Array.isArray(v) && v.length <= max && v.every(s => typeof s === "string" && s.trim().length > 0 && s.trim().length <= len);
  if (!words(queries, MAX_QUERIES, MAX_Q) || !(queries as string[]).length) return {error: "bad_request"};
  if (!words(match, 6, 40) || !words(exclude, 10, 40)) return {error: "bad_request"};
  if (typeof max_price !== "number" || !Number.isFinite(max_price) || max_price < 0 || max_price > 1_000_000) return {error: "bad_request"};
  const trim = (xs: unknown) => [...new Set((xs as string[]).map(s => s.trim().replace(/\s+/g, " ")))];
  return {queries: trim(queries), match: trim(match), exclude: trim(exclude), maxPrice: max_price};
}

// ---------------------------------------------------------------------------------------------------------------------------
// Words: sizes written one way, so "55-inch", '55"' and "55 inch" are all 55inch, and "256 GB" is 256gb (from the phone's research.ts)
export const sizesOneWay = (s: string) => s.toLowerCase().replace(/(\d)\s*-?\s*(?:"|”|″|inches|inch)/g, "$1inch").replace(/(\d)in\b/g, "$1inch").replace(/(\d)\s+(gb|tb)\b/g, "$1$2");
export const squash = (s: string) => sizesOneWay(s).replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
// the few HTML entities shops' titles and snippets come with
const ENTITIES: Record<string, string> = {amp: "&", quot: "\"", apos: "'", "#39": "'", "#x27": "'", nbsp: " ", ndash: "–", mdash: "—", pound: "£", rsquo: "'", lsquo: "'", hellip: "…", "#8211": "–", "#8217": "'"};
export const decoded = (s: string) => s.replace(/&(#?[a-z0-9]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m);
const noPounds = (s: string) => decoded(s).replace(/£\s?[\d,.]+/g, "").replace(/£/g, "").replace(/[\p{Cc}<>]/gu, " ").replace(/\s+/g, " ").trim();
// a different model when the name has one of these and what was asked for doesn't (a 4K "Ultra HD" or a "Mini LED" TV isn't one)
const VARIANT = /\b(pro|max|ultra(?!\s*-?hd)|ti|plus|mini(?!\s*-?led)|air|lite|fe|se)\b/gi;
/** The Pro, Max and so on in a name that what was asked for doesn't have. */
export const variantsIn = (s: string, asked: string) =>
  [...new Set([...s.matchAll(VARIANT)].map(m => m[1].toLowerCase()))].filter(v => !new RegExp(`\\b${v}\\b`, "i").test(asked));
// something to go with the thing, not the thing
const ACCESSORY = /\b(case|cases|cover|covers|protector|tempered glass|cable|charger|adapter|strap|straps|band|stand|mount|bracket|replacement|ear ?pads|cushions?|skin|sleeve|bag|holder|dock|controller|remote|stylus|keyboard cover|refill|filter|spare)\b/i;

// a £ amount where it is
const POUND = /£\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g;
const num = (s: string) => Number(s.replace(/[£,\s]/g, ""));
// not the price of the thing: by the month, a part of it, what you save, only with something else, or delivery
const AFTER = /^\s*(?:\/\s?(?:mo|mth|month|m)\b|a month|per month|p\/?m\b|pcm\b|monthly|a mth|x\s?\d+|for \d+ months|off\b|deposit\b|upfront\b|up front\b|ex\.?\s?vat\b|excl?\.?\s?vat\b|or more\b|and over\b|\+|(?:with|after)\s+(?:a\s+|your\s+)?trade|(?:(?:standard|next|day|next-day|express|home|uk|tracked|nominated|named|premium|weekend|saturday|large item)\s+){0,3}(?:delivery|postage|shipping|p&p)\b)/i;
const BEFORE = /(?:\bwas|\brrp|\bsave|\bsaving|\bdeposit(?: of)?|\bpayments? of|\binstal?ments? of|\bmonthly|\bdown|\bover|\babove|\bspend|\bdelivery|\bpostage|\bshipping|\bcredit|\btrade[- ]?in)[:\s]*$/i;
// "£799 with trade-in £699": the trade-in is the next price's, not this one's
const TRADE_NEXT = /^\s*(?:with|after)\s+(?:a\s+|your\s+)?trade[- ]?in\s*:?\s*£/i;
// a starting price: the page says so just before it
const FROM = /(?:\bfrom|\bstarting (?:at|from)|\bprices? from)[:\s]*$/i;
const GLUED = /£\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*$/;
const GONE = /\b(?:out of stock|sold out|currently unavailable|no longer available)\b/i;
const FREE = /\bfree (?:standard |uk |next[- ]day |home )?(?:delivery|shipping|postage)\b|\bdelivery:?\s*free\b/i;
const REFURB = /\brefurb|\brenewed\b|\bpre-?loved\b|\bopen box\b|\bex[- ]display\b|\bgrade [abc]\d?\b|\bgraded\b/i;
const USED = /\bpre-?owned\b|\bsecond[- ]?hand\b|\bused\b/i;
const YEAR = /^(?:19|20)\d\d$/;

// a sentence about delivery or a spending threshold: its figures are never the thing's price ("Free on orders over £40, £2.95 if
// you spend less")
const POLICY = /\b(?:deliver(?:y|ed)|postage|shipping|p&p|orders? (?:over|under|of)|spend (?:less|over|more|under)|minimum (?:order|spend)|click (?:and|&) collect)\b/i;
// the words that go with a price: its own sentence (a decimal point isn't the end of one), and within it, from the price before
// it to the next one, so "£899.00 £3.95 next day delivery" keeps £899 apart from the delivery charge
const SENTENCE_END = /(?<!\d)[.!?](?!\d)|\n/g;
function clauseOf(text: string, at: number, end: number): string {
  let start = 0, stop = text.length;
  for (const m of text.matchAll(SENTENCE_END)) {
    if (m.index! < at) start = m.index! + 1;
    else if (m.index! >= end) { stop = m.index!; break; }
  }
  for (const m of text.matchAll(POUND)) {
    if (m.index! + m[0].length <= at && m.index! + m[0].length > start) start = m.index! + m[0].length;
    if (m.index! >= end && m.index! < stop) { stop = m.index!; break; }
  }
  return text.slice(start, stop);
}

/** The prices a piece of a shop's listing gives the thing itself, each said as a starting price or not. */
export function pricesIn(text: string): {price: number; from: boolean}[] {
  return [...text.matchAll(POUND)].flatMap(m => {
    const at = m.index!, end = at + m[0].length, price = num(m[1] + (m[2] ?? ""));
    const after = text.slice(end, end + 30);
    if (!(price > 0) || (AFTER.test(after) && !TRADE_NEXT.test(after)) || BEFORE.test(text.slice(Math.max(0, at - 24), at))) return [];
    if (POLICY.test(clauseOf(text, at, end).replace(/\bfree (?:standard |uk |next[- ]day |home )?delivery\b/gi, ""))) return [];
    // a was price straight after what it costs now ("£299.00 £329.00")
    const glued = GLUED.exec(text.slice(Math.max(0, at - 30), at));
    if (glued && num(glued[0]) < price) return [];
    return [{price, from: FROM.test(text.slice(Math.max(0, at - 24), at))}];
  });
}
/** The one price a product page's snippets give it: one figure (a starting price if every mention says so), else none. */
export function snippetPrice(text: string): {price: number; from: boolean} | null {
  const found = pricesIn(text), distinct = [...new Set(found.map(p => p.price))];
  if (distinct.length !== 1) return null;
  return {price: distinct[0], from: found.every(p => p.from)};
}
/** A price as structured data has it, in pounds, or null if it isn't one (another currency, or none said). */
export function gbp(price: unknown, currency?: unknown): number | null {
  if (typeof currency === "string" && currency.trim() && currency.trim().toUpperCase() !== "GBP") return null;
  const said = typeof price === "number" ? String(price) : typeof price === "string" ? price.trim() : "";
  if (!said) return null;
  if (typeof currency !== "string" || !currency.trim()) { if (!said.includes("£")) return null; }
  if (/[$€]|usd|eur/i.test(said)) return null;
  const m = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/.exec(said);
  const n = m ? num(m[1] + (m[2] ?? "")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Shops. [site, name, how established (2 a big UK name, 1 known, 0 other), what else: "new" sells new things only, "skip" refuses
// automated page reads (3 Nov live runs; robots or a bot wall), "uk" a global site whose UK pages are under a UK path]
const SHOP_LIST: [string, string, number, string?][] = [
  ["argos.co.uk", "Argos", 2, "new"], ["currys.co.uk", "Currys", 2, "new skip"], ["johnlewis.com", "John Lewis", 2, "new"], ["ao.com", "AO", 2, "new"],
  ["very.co.uk", "Very", 2, "new"], ["richersounds.com", "Richer Sounds", 2, "new"], ["box.co.uk", "Box", 1, "new"], ["scan.co.uk", "Scan", 2, "new"],
  ["overclockers.co.uk", "Overclockers UK", 2, "new"], ["cclonline.com", "CCL", 1, "new skip"], ["chillblast.com", "Chillblast", 1, "new skip"],
  ["pcspecialist.co.uk", "PCSpecialist", 1, "new"], ["laptopsdirect.co.uk", "Laptops Direct", 1, "new"], ["appliancesdirect.co.uk", "Appliances Direct", 1, "new"],
  ["ebuyer.com", "Ebuyer", 1, "new"], ["amazon.co.uk", "Amazon", 1, "skip"], ["apple.com", "Apple", 2, "new uk"], ["samsung.com", "Samsung", 2, "new uk"],
  ["sony.co.uk", "Sony", 2, "new"], ["dell.com", "Dell", 2, "new uk"], ["lenovo.com", "Lenovo", 2, "new uk"], ["hp.com", "HP", 2, "new uk"],
  ["microsoft.com", "Microsoft", 2, "new uk"], ["lg.com", "LG", 2, "new uk"], ["bose.co.uk", "Bose", 2, "new"], ["dyson.co.uk", "Dyson", 2, "new skip"],
  ["sennheiser-hearing.com", "Sennheiser", 1, "new uk"], ["game.co.uk", "GAME", 1], ["smythstoys.com", "Smyths", 1, "new uk"], ["boots.com", "Boots", 2, "new"],
  ["halfords.com", "Halfords", 2, "new"], ["costco.co.uk", "Costco", 1, "new"], ["selfridges.com", "Selfridges", 1, "new"], ["harrods.com", "Harrods", 1, "new"],
  ["sevenoakssoundandvision.co.uk", "Sevenoaks", 1, "new"], ["petertyson.co.uk", "Peter Tyson", 1, "new"], ["hughes.co.uk", "Hughes", 1, "new"],
  ["sonicdirect.co.uk", "Sonic Direct", 1, "new"], ["mobilephonesdirect.co.uk", "Mobile Phones Direct", 1, "new"], ["backmarket.co.uk", "Back Market", 1],
  ["musicmagpie.co.uk", "musicMagpie", 1], ["uk.webuy.com", "CeX", 1], ["giffgaff.com", "giffgaff", 1], ["o2.co.uk", "O2", 1], ["ee.co.uk", "EE", 1],
  ["vodafone.co.uk", "Vodafone", 1], ["three.co.uk", "Three", 1], ["tesco.com", "Tesco", 2, "new"], ["sainsburys.co.uk", "Sainsbury's", 1, "new"],
  ["jdsports.co.uk", "JD Sports", 1, "new"], ["nike.com", "Nike", 2, "new uk"], ["adidas.co.uk", "adidas", 2, "new"], ["next.co.uk", "Next", 2, "new"],
  ["marksandspencer.com", "M&S", 2, "new"], ["asos.com", "ASOS", 1, "new"], ["ikea.com", "IKEA", 2, "new uk"], ["dunelm.com", "Dunelm", 2, "new"],
  ["diy.com", "B&Q", 2, "new"], ["screwfix.com", "Screwfix", 1, "new"], ["wickes.co.uk", "Wickes", 1, "new"], ["decathlon.co.uk", "Decathlon", 1, "new"],
  ["sportsdirect.com", "Sports Direct", 1, "new"], ["waterstones.com", "Waterstones", 1, "new"], ["hmv.com", "HMV", 1, "new"], ["zavvi.com", "Zavvi", 1, "new"],
  ["jessops.com", "Jessops", 1, "new"], ["wexphotovideo.com", "Wex", 1, "new"], ["parkcameras.com", "Park Cameras", 1, "new"], ["gear4music.com", "Gear4music", 1, "new"],
  ["andertons.co.uk", "Andertons", 1, "new"], ["sharkclean.co.uk", "Shark", 1, "new"], ["philips.co.uk", "Philips", 1, "new"], ["garmin.com", "Garmin", 1, "new uk"],
  ["store.google.com", "Google Store", 2, "new uk"], ["nintendo.com", "Nintendo", 2, "new uk"], ["direct.playstation.com", "PlayStation Direct", 2, "new uk"],
  ["xbox.com", "Xbox", 2, "new uk"], ["hisense.co.uk", "Hisense", 1, "new"], ["panasonic.com", "Panasonic", 1, "new uk"], ["sonos.com", "Sonos", 1, "new uk"],
  ["uk.jbl.com", "JBL", 1, "new"], ["beatsbydre.com", "Beats", 1, "new uk"], ["robertdyas.co.uk", "Robert Dyas", 1, "new"], ["lakeland.co.uk", "Lakeland", 1, "new"],
  ["onbuy.com", "OnBuy", 0], ["pcworld.co.uk", "Currys", 2, "new skip"], ["hmvstore.com", "HMV", 1, "new"], ["smartphonestore.co.uk", "Smartphone Store", 0],
];
export interface Shop { site: string; name: string; rank: number; newOnly: boolean; skip: boolean }
const SHOPS = new Map(SHOP_LIST.map(([site, name, rank, flags = ""]) => [site, {site, name, rank, newOnly: flags.includes("new"), skip: flags.includes("skip"), uk: flags.includes("uk")}]));
// never a shop's own page: reviews, news, comparison and deal sites, marketplaces, social sites and forums
const NOT_SHOPS = ["techradar.com", "trustedreviews.com", "tomsguide.com", "expertreviews.co.uk", "whathifi.com", "which.co.uk", "pricespy.co.uk", "pricerunner.com",
  "idealo.co.uk", "hotukdeals.com", "latestdeals.co.uk", "moneysavingexpert.com", "reddit.com", "youtube.com", "facebook.com", "instagram.com", "tiktok.com",
  "x.com", "twitter.com", "wikipedia.org", "ebay.co.uk", "ebay.com", "gumtree.com", "vinted.co.uk", "etsy.com", "depop.com", "preloved.co.uk", "alibaba.com",
  "aliexpress.com", "temu.com", "theverge.com", "engadget.com", "cnet.com", "pcmag.com", "rtings.com", "stuff.tv", "t3.com", "independent.co.uk",
  "theguardian.com", "telegraph.co.uk", "bbc.co.uk", "bbc.com", "dailymail.co.uk", "mirror.co.uk", "express.co.uk", "standard.co.uk", "macrumors.com",
  "9to5mac.com", "appleinsider.com", "gsmarena.com", "notebookcheck.net", "pcgamer.com", "rockpapershotgun.com", "eurogamer.net", "ign.com", "gamesradar.com",
  "digitalspy.com", "avforums.com", "quora.com", "mumsnet.com", "macworld.com", "pocket-lint.com", "techadvisor.com", "wired.com", "forbes.com", "cnbc.com",
  // comparison, contract and price-history sites: their figures are someone else's price, often by the month
  "smartphonechecker.co.uk", "uswitch.com", "kelkoo.co.uk", "camelcamelcamel.com", "keepa.com", "versus.com", "nanoreview.net", "kimovil.com", "phonearena.com",
  "dxomark.com", "google.com", "google.co.uk", "bing.com", "pricehistory.co.uk", "compareandbuy.co.uk", "shopmania.co.uk", "ciao.co.uk", "fruugo.co.uk"];
const UK_PATH = /^\/(?:uk|gb|en-gb|en-uk|gb-en|en_gb|en-GB)(?:\/|$)|[?&](?:hl|lang|locale)=en[-_]gb\b/i;
// a page on a shop's site that writes about things or lists many, rather than sells one
const WRITING = /\/(?:blogs?|news|articles?|reviews?|guides?|advice|buying-guides?|buyingguides|techtalk|discover|inspiration|help|best-[^/]*|[^/]*-vs-[^/]*)(?:\/|$)/i;
const LISTING_PATH = /\/(?:browse|c|category|categories|bct|l|search|s|sd|shop-by|collections?|range|deals|offers|sale|brands?)(?:\/|$|\?)|[?&](?:q|query|search|searchterm|fh_|sort)=/i;
const LISTING_TITLE = /^(?:shop (?:all|our|the)|all|best|cheap|cheapest|top \d+)\b|\b(?:deals|offers|range|collection|for sale|results for)\b/i;

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch { return null; }
};
const siteMatch = (host: string, site: string) => host === site || host.endsWith(`.${site}`);
/** The shop a page belongs to, when it's one we know (and, for a global site, its UK pages). */
export function shopOf(url: string): Shop | null {
  const host = hostOf(url);
  if (!host) return null;
  for (const [site, s] of SHOPS) {
    if (!siteMatch(host, site)) continue;
    if (s.uk) { const u = new URL(url); if (!UK_PATH.test(u.pathname) && !UK_PATH.test(u.search) && !host.startsWith("uk.")) return null; }
    return s;
  }
  return null;
}
// a site whose name says it compares or tracks prices, or hands out deals, rather than sells
const COMPARES = /compar|pricespy|pricerunner|price-?check|pricehistory|e-?catalog|vouchers?|discount-?codes?|deals?(?:\.|-)|hotukdeals/i;
export const notShop = (url: string) => { const h = hostOf(url); return !h || (!shopOf(url) && COMPARES.test(h)) || NOT_SHOPS.some(s => siteMatch(h, s)); };
const isWriting = (url: string) => { try { return WRITING.test(new URL(url).pathname); } catch { return true; } };
const isListing = (url: string, title: string) => { try { const u = new URL(url); return LISTING_PATH.test(u.pathname + u.search) || LISTING_TITLE.test(title.trim()); } catch { return true; } };

// The thing's name from a page's title: without the shop's name and what shops add round it ("Buy …", "| Free delivery", "- Currys")
export function nameOf(title: string, shop: string | null): string {
  let t = noPounds(title).replace(/^(?:buy|shop)\s+/i, "");
  const parts = t.split(/\s+[|–—]\s+|\s+-\s+(?=[^-]*$)|\s+at\s+(?=[A-Z][\w&' ]+$)/);
  if (parts.length > 1) {
    const drop = (p: string) => (shop && squash(p).includes(squash(shop))) || /^(?:official|uk|online|free (?:uk )?delivery|buy online|shop online|great prices?)\b/i.test(p.trim());
    while (parts.length > 1 && drop(parts[parts.length - 1])) parts.pop();
    t = parts.join(" - ");
  }
  return t.replace(/\s*\|\s*$/, "").replace(/\s+/g, " ").trim().slice(0, 100);
}
const BRANDS = ["Apple", "Samsung", "Sony", "LG", "Bose", "Sennheiser", "JBL", "Beats", "Anker", "Soundcore", "Jabra", "Bang & Olufsen", "Marshall", "Skullcandy",
  "Audio-Technica", "Technics", "Panasonic", "Philips", "Hisense", "TCL", "Toshiba", "Sharp", "Google", "Microsoft", "Dell", "HP", "Lenovo", "Acer", "Asus", "MSI",
  "Razer", "Alienware", "Huawei", "Xiaomi", "OnePlus", "Motorola", "Nokia", "Nothing", "Garmin", "Fitbit", "Dyson", "Shark", "Nintendo", "PlayStation", "Xbox",
  "PCSpecialist", "Chillblast", "Scan", "Gigabyte", "Corsair", "Logitech", "Amazon", "Ninja", "Tefal", "Breville", "DeLonghi", "Nespresso", "Bosch", "Hotpoint", "Beko"];
const brandOf = (name: string, said?: unknown): string => {
  const b = typeof said === "string" ? said : said && typeof said === "object" && typeof (said as {name?: unknown}).name === "string" ? (said as {name: string}).name : "";
  if (b.trim()) return b.trim().slice(0, 40);
  const lower = name.toLowerCase();
  return BRANDS.find(x => lower.startsWith(x.toLowerCase() + " ") || lower === x.toLowerCase()) ?? "";
};
// a model's code: a word with both letters and digits ("WH-1000XM6", "QE65Q60D", "M4"), or a number after a name ("iPhone 17")
export function modelOf(name: string): string {
  const words = sizesOneWay(name).split(/[\s,()/]+/).map(w => w.replace(/[^a-z0-9-]/g, "")).filter(Boolean);
  const codes = words.filter(w => /\d/.test(w) && /[a-z]/.test(w) && !/^\d+(?:gb|tb|inch|hz|w|mm|cm|kg|g|ml|mah|p|k)$/.test(w));
  if (codes.length) return codes.slice(0, 2).join(" ").toUpperCase();
  const i = words.findIndex(w => /^\d{1,3}$/.test(w) && !YEAR.test(w));
  return i > 0 ? `${words[i - 1]} ${words[i]}` : "";
}
/** A size or storage, as `codesOf` writes it: 256gb, 2tb, 65inch. */
export const isSize = (w: string) => /^\d+(?:gb|tb|inch)$/.test(w);
/** A name's codes and numbers, sizes one way, years left out: "Samsung QE65Q7F 65" 4K" → 4k, 65inch, qe65q7f. */
export const codesOf = (name: string) =>
  [...new Set(sizesOneWay(name).split(/[\s,()/|]+/).map(w => w.replace(/[^a-z0-9]/g, "")).filter(w => /\d/.test(w) && !YEAR.test(w)))].sort();
/** What makes two shops' listings the same thing: the brand, its code or numbers (sizes and storage too) and any Pro, Max and so on. */
export function groupOf(name: string, brand: string): string {
  const s = sizesOneWay(name);
  const marks = codesOf(name);
  const variants = [...new Set([...s.matchAll(VARIANT)].map(m => m[1].toLowerCase()))].sort();
  const lead = squash(brand) || squash(s.split(/\s+/)[0] ?? "");
  return [lead, ...marks, ...variants].join("|") || squash(s).slice(0, 40);
}
const conditionOf = (said: string, shop: Shop | null, structured?: unknown): Condition => {
  const c = typeof structured === "string" ? structured : "";
  if (/Refurbished/i.test(c)) return "refurbished";
  if (/Used|Damaged/i.test(c)) return "used";
  if (REFURB.test(said)) return "refurbished";
  if (USED.test(said)) return "used";
  if (/NewCondition/i.test(c)) return "new";
  return shop?.newOnly ? "new" : "unknown";
};

// ---------------------------------------------------------------------------------------------------------------------------
// Structured data (JSON-LD, and Brave's `schemas`, which are the same): every Product in it, with its offers
export interface Structured { name: string; brand: unknown; model: string; image: string | null; offers: Offer[] }
export interface Offer { price: number; from: boolean; url: string | null; inStock: boolean | null; condition: string; delivery: number | "free" | null; name: string }
const typeIs = (o: Record<string, unknown>, t: string) => { const x = o["@type"]; return x === t || (Array.isArray(x) && x.includes(t)); };
const str = (v: unknown) => typeof v === "string" ? v : "";
const imageIn = (v: unknown): string | null => {
  const first = Array.isArray(v) ? v[0] : v;
  const url = typeof first === "string" ? first : first && typeof first === "object" ? str((first as {url?: unknown}).url) || str((first as {contentUrl?: unknown}).contentUrl) : "";
  return url.startsWith("https://") ? url : url.startsWith("//") ? `https:${url}` : null;
};
function offersIn(v: unknown, name: string): Offer[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list.flatMap((o): Offer[] => {
    if (!o || typeof o !== "object") return [];
    const x = o as Record<string, unknown>;
    if (typeIs(x, "AggregateOffer")) {
      const inner = offersIn(x.offers, name);
      if (inner.length) return inner;
      const low = gbp(x.lowPrice ?? x.price, x.priceCurrency);
      return low ? [{price: low, from: gbp(x.highPrice, x.priceCurrency) !== low, url: str(x.url) || null, inStock: null, condition: "", delivery: null, name}] : [];
    }
    const spec = x.priceSpecification as Record<string, unknown> | undefined;
    const price = gbp(x.price ?? spec?.price, x.priceCurrency ?? spec?.priceCurrency);
    if (!price) return [];
    const avail = str(x.availability);
    const ship = (Array.isArray(x.shippingDetails) ? x.shippingDetails[0] : x.shippingDetails) as Record<string, unknown> | undefined;
    const rate = ship?.shippingRate as Record<string, unknown> | undefined, cost = rate ? Number(rate.value) : NaN;
    return [{price, from: false, url: str(x.url) || null, inStock: avail ? !/OutOfStock|SoldOut|Discontinued/i.test(avail) : null, condition: str(x.itemCondition),
      delivery: rate && (!rate.currency || rate.currency === "GBP") && Number.isFinite(cost) ? (cost === 0 ? "free" : cost) : null, name: str(x.name) || name}];
  });
}
/** Every product in a piece of structured data: @graph, lists, a ProductGroup's variants, an ItemPage's mainEntity. */
export function productsIn(v: unknown, out: Structured[] = [], depth = 0): Structured[] {
  if (depth > 6 || !v || typeof v !== "object") return out;
  if (Array.isArray(v)) { for (const x of v) productsIn(x, out, depth + 1); return out; }
  const o = v as Record<string, unknown>;
  if (typeIs(o, "Product") || typeIs(o, "ProductGroup") || typeIs(o, "IndividualProduct")) {
    const name = noPounds(str(o.name)).slice(0, 100);
    const offers = offersIn(o.offers, name);
    if (typeIs(o, "ProductGroup")) for (const variant of Array.isArray(o.hasVariant) ? o.hasVariant : []) offers.push(...productsIn(variant, [], depth + 1).flatMap(p => p.offers));
    out.push({name, brand: o.brand, model: str(o.model) || str(o.mpn) || str(o.sku), image: imageIn(o.image), offers});
    return out;
  }
  for (const k of ["@graph", "mainEntity", "itemListElement", "item"]) if (o[k]) productsIn(o[k], out, depth + 1);
  return out;
}

// Brave's web search, as much of it as is used
export interface BraveResult {
  title?: string; url?: string; description?: string; extra_snippets?: string[]; thumbnail?: {src?: string; original?: string};
  profile?: {name?: string}; page_age?: string; page_fetched?: string; age?: string;
  product?: BraveProduct; product_cluster?: BraveProduct[]; schemas?: unknown[];
}
export interface BraveProduct { name?: string; price?: string; thumbnail?: {src?: string}; offers?: {url?: string; priceCurrency?: string; price?: string | number}[]; description?: string }
export const braveUrl = (q: string) =>
  `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&country=GB&search_lang=en&ui_lang=en-GB&count=20&extra_snippets=true&text_decorations=false&result_filter=web&safesearch=moderate`;
export const resultsOf = (got: unknown): BraveResult[] => {
  const r = (got as {web?: {results?: unknown}} | null)?.web?.results;
  return Array.isArray(r) ? r.filter((x): x is BraveResult => !!x && typeof x === "object" && typeof (x as BraveResult).url === "string") : [];
};

const NOT_PHOTO = /logo|icon|badge|sprite|flag|payment|klarna|trustpilot|banner|placeholder|favicon|social|share|og-default|default-og|\.svg\b|\.gif\b/i;
const photoFrom = (t: {src?: string; original?: string} | undefined) =>
  t?.src?.startsWith("https://") && !NOT_PHOTO.test(t.original ?? "") ? t.src : null;
const dateOf = (s: unknown, now: Date) => { const d = typeof s === "string" ? new Date(s) : null; return d && !isNaN(d.getTime()) && d <= now ? d.toISOString() : null; };

/** A product found in a search, before its page is read. */
export type Candidate = ShopProduct & {rank: number; skip: boolean; listing: boolean};

/** What one search result says is for sale, and at what price: Brave's structured data first (each product it saw on the page, with
 *  its offers), else, on one product's own page, the one price its snippets give, else the product with no price. */
export function candidatesOf(r: BraveResult, now: Date): Candidate[] {
  const url = r.url!, title = decoded(r.title ?? ""), shop = shopOf(url), host = hostOf(url);
  if (!host || isWriting(url) || notShop(url)) return [];
  const snippets = decoded([r.description ?? "", ...(r.extra_snippets ?? [])].join("\n"));
  const seen = dateOf(r.page_fetched, now) ?? dateOf(r.page_age, now) ?? now.toISOString();
  const stale = now.getTime() - new Date(seen).getTime() > STALE_DAYS * DAY_MS;
  const listing = isListing(url, title);
  const out: Candidate[] = [];
  const add = (name: string, price: number | null, from: boolean, link: string, image: string | null, brand: unknown, model: string, evidence: string, structured = "", byShop = shop) => {
    const clean = noPounds(name).slice(0, 100);
    if (!clean || clean.length < 3) return;
    const at = shopOf(link) ?? byShop, b = brandOf(clean, brand);
    // a shop's own listing of its own price is as listed (unless it's over a month old); a price anywhere else (another site's
    // snapshot of a shop) is an estimate
    const own = !!byShop && (hostOf(link) === host || shopOf(link)?.name === byShop.name);
    const confidence: Confidence | null = price === null ? null : own && !stale ? "search_listed" : "estimated";
    out.push({
      name: clean, brand: b, model: model.slice(0, 40) || modelOf(clean), group: groupOf(clean, b), retailer: at?.name ?? decoded(r.profile?.name ?? host).slice(0, 40),
      host: hostOf(link) ?? host, url: link, price, ...from && price !== null ? {from: true as const} : {}, currency: "GBP", confidence,
      priceSource: price === null ? null : url, image, condition: conditionOf(`${clean} ${link}`, at, structured), delivery: FREE.test(snippets) ? "free" : null,
      ...GONE.test(snippets) ? {inStock: false as const} : {}, checked: seen, ...price !== null ? {evidence: evidence.slice(0, 160)} : {},
      rank: at?.rank ?? 0, skip: !!at?.skip, listing,
    });
  };
  const structured = [r.product, ...(r.product_cluster ?? [])].filter((p): p is BraveProduct => !!p && typeof p === "object" && typeof p.name === "string")
    .map((p): Structured => ({name: p.name!, brand: undefined, model: "", image: photoFrom(p.thumbnail), offers: [
      ...(p.offers ?? []).flatMap(o => { const price = gbp(o.price, o.priceCurrency); return price ? [{price, from: false, url: o.url ?? null, inStock: null, condition: "", delivery: null, name: p.name!}] : []; }),
      ...(!p.offers?.length && gbp(p.price) ? [{price: gbp(p.price)!, from: false, url: null, inStock: null, condition: "", delivery: null, name: p.name!}] : [])]}));
  for (const s of r.schemas ?? []) structured.push(...productsIn(s));
  if (structured.length) {
    for (const p of structured) {
      const best = p.offers.filter(o => !o.url || hostOf(o.url)).sort((a, b) => a.price - b.price)[0];
      const link = best?.url && hostOf(best.url) ? best.url : url;
      add(p.name || nameOf(title, shop?.name ?? null), best?.price ?? null, !!best && (best.from || p.offers.length > 1 && new Set(p.offers.map(o => o.price)).size > 1),
        link, p.image ?? (structured.length === 1 ? photoFrom(r.thumbnail) : null), p.brand, p.model, best ? `structured data: ${decoded(p.name)} ${best.price}` : "", best?.condition);
    }
    return out;
  }
  // no structured data: only a shop's page for one product, with one clear price in its snippets
  if (!shop || listing) return [];
  const one = snippetPrice(snippets);
  add(nameOf(title, shop.name), one?.price ?? null, !!one?.from, url, photoFrom(r.thumbnail), undefined, "", one ? around(snippets, one.price) : "");
  return out;
}

// the listing's words round a price, for checking where it came from
function around(text: string, price: number): string {
  const m = [...text.matchAll(POUND)].find(x => num(x[1] + (x[2] ?? "")) === price);
  return m ? text.slice(Math.max(0, m.index! - 80), m.index! + 80).replace(/\s+/g, " ").trim() : "";
}

/** Whether a match word is in a name as a whole word or words, spaces and hyphens either way, sizes one way: "iPhone 17" is in
 *  "iPhone 17 256GB" but not "iPhone 17e"; "65" is in 65″ and 65-inch; "RTX 5060" is in "RTX5060". */
export function termIn(term: string, text: string): boolean {
  const words = sizesOneWay(term).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return true;
  const rx = new RegExp(`(?<![a-z0-9])${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\-_/.]*")}(?:inch|gb|tb|hz)?(?![a-z0-9])`);
  return rx.test(sizesOneWay(text));
}
/** Whether a product is what was asked for: every match word in its name or address (sizes one way), no excluded word, not an
 *  accessory unless asked, not a Pro, Max and so on the match words don't name, within the budget. */
export function fits(p: Pick<ShopProduct, "name" | "url" | "price">, ask: ShopAsk): boolean {
  let path = "";
  try { path = decodeURIComponent(new URL(p.url).pathname).replace(/[-_/.]+/g, " "); } catch { /* the name alone */ }
  const said = sizesOneWay(`${p.name} ${path}`), named = squash(p.name), asked = `${ask.match.join(" ")} ${ask.queries.join(" ")}`;
  if (!ask.match.every(m => termIn(m, said))) return false;
  if (ask.exclude.some(x => squash(x) && named.includes(squash(x)))) return false;
  const accessory = ACCESSORY.exec(p.name);
  if (accessory && !new RegExp(`\\b${accessory[1]}\\b`, "i").test(asked)) return false;
  // a model the match words name ("iPhone 17"): another one of it isn't it ("iPhone 17 Pro")
  if (ask.match.some(m => /\d/.test(m)) && variantsIn(p.name, ask.match.join(" ")).length) return false;
  if (ask.maxPrice > 0 && p.price !== null && p.price > ask.maxPrice) return false;
  return true;
}

const urlKey = (url: string) => url.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/^https?:\/\/(?:www\.)?/i, "").toLowerCase();
const CONFIDENT: Record<Confidence, number> = {verified: 3, search_listed: 2, estimated: 1};
const sureOf = (p: ShopProduct) => p.confidence ? CONFIDENT[p.confidence] : 0;
/** Which of two listings of the same thing to keep: the surer price, a price at all, a photo, then the cheaper. */
const better = (a: ShopProduct, b: ShopProduct) =>
  sureOf(a) - sureOf(b) || Number(a.price !== null) - Number(b.price !== null) || Number(!!a.image) - Number(!!b.image) || (b.price ?? Infinity) - (a.price ?? Infinity);
/** One of each page, and one of each thing at each shop (colours are one thing). */
export function dedupe<T extends ShopProduct>(ps: T[]): T[] {
  const byUrl = new Map<string, T>();
  for (const p of ps) { const k = urlKey(p.url) + (p.price ?? ""); const was = byUrl.get(k); if (!was || better(p, was) > 0) byUrl.set(k, p); }
  const byShop = new Map<string, T>();
  for (const p of byUrl.values()) { const k = `${p.host}|${p.group}`; const was = byShop.get(k); if (!was || better(p, was) > 0) byShop.set(k, p); }
  return [...byShop.values()];
}
/** The order they're offered in: surest price first, then an established shop, a price at all, in stock, a photo, then cheapest. */
export const score = (p: ShopProduct & {rank?: number}) =>
  sureOf(p) * 10 + (p.rank ?? 0) * 3 + (p.price !== null ? 4 : 0) + (p.inStock === false ? -15 : 0) + (p.image ? 2 : 0) + (p.brand ? 1 : 0);
export const ranked = <T extends ShopProduct & {rank?: number}>(ps: T[]) =>
  [...ps].sort((a, b) => score(b) - score(a) || (a.price ?? Infinity) - (b.price ?? Infinity));
/** The ones to return, best first, at most `perShop` from any one shop unless there's room left over. */
export function spread<T extends ShopProduct>(ps: T[], max = MAX_RETURNED, perShop = 4): T[] {
  const out: T[] = [], later: T[] = [], count = new Map<string, number>();
  for (const p of ps) {
    const n = count.get(p.retailer) ?? 0;
    if (n < perShop) { out.push(p); count.set(p.retailer, n + 1); } else later.push(p);
  }
  return [...out, ...later].slice(0, max).sort((a, b) => ps.indexOf(a) - ps.indexOf(b));
}
/** A listed or estimated price far below what the same thing costs elsewhere is something else on the listing (a delivery charge,
 *  a payment, an add-on), so it's dropped rather than shown: under 35% of the median of the others. A shop's own page is never
 *  second-guessed. */
export function sanePrices<T extends ShopProduct>(ps: T[]): T[] {
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  // and under 5% of what everything found costs: a charge or a part, whatever it's next to
  const all = ps.filter(p => p.price !== null).map(p => p.price!), floor = all.length >= 4 ? median([...all]) * 0.05 : 0;
  return ps.map(p => {
    if (p.price === null || p.confidence === "verified") return p;
    const others = ps.filter(o => o !== p && o.group === p.group && o.price !== null).map(o => o.price!);
    const odd = p.price < floor || (others.length > 0 && p.price < median(others) * 0.35);
    return odd ? {...p, price: null, confidence: null, priceSource: null, from: undefined, evidence: undefined} : p;
  });
}
/** More searches when fewer than five things came back: the shops' own listings for the match words (or the first search). */
export function fallbackQueries(ask: ShopAsk, room: number): string[] {
  const base = ask.match.length ? ask.match.join(" ") : ask.queries[0];
  return [`${base} buy UK`, `${base} site:argos.co.uk`, `${base} site:johnlewis.com`, `${base} site:currys.co.uk`]
    .filter(q => !ask.queries.some(x => x.toLowerCase() === q.toLowerCase())).slice(0, Math.max(0, room));
}

// ---------------------------------------------------------------------------------------------------------------------------
// Reading a shop's page: only https on a public name, a few redirects each checked again, a size limit, and robots.txt asked first
export const USER_AGENT = "Mozilla/5.0 (compatible; PinchPriceCheck/1.0; one page for a person's question)";
const PRIVATE = /^(?:localhost|.*\.local|.*\.internal|.*\.localhost|0\.0\.0\.0)$/i;
/** Whether an address is one to fetch: https, a public host name (no IP address, no port but 443). */
export function safeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
    const h = u.hostname;
    return h.includes(".") && !PRIVATE.test(h) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) && !h.includes(":") && !h.startsWith("[");
  } catch { return false; }
}
/** Disallowed paths for us in a robots.txt (its "*" group, or one naming us): the longest Allow or Disallow that matches wins. */
export function robotsAllow(txt: string, path: string): boolean {
  const rules: {allow: boolean; path: string}[] = [];
  let inGroup = false, sawRule = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim(), m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "user-agent") {
      // the user-agent lines before a group's rules are one group; one after rules starts the next
      if (sawRule) { inGroup = false; sawRule = false; }
      const agent = value.toLowerCase();
      if (agent === "*" || agent.includes("pinch")) inGroup = true;
      continue;
    }
    if (key !== "allow" && key !== "disallow") continue;
    sawRule = true;
    if (inGroup && value) rules.push({allow: key === "allow", path: value});
  }
  const hits = rules.filter(r => {
    const rx = new RegExp(`^${r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
    return rx.test(path);
  });
  if (!hits.length) return true;
  const best = hits.reduce((a, b) => b.path.length > a.path.length || (b.path.length === a.path.length && b.allow) ? b : a);
  return best.allow;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Outcome = "ok" | "noPrice" | "blocked" | "robots" | "timeout" | "error" | "skipped";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (ms: number) => ms + Math.floor(Math.random() * ms * 0.3);

/** A fetch with a time limit, tried again after a wait when it's worth it (a timeout, the network, 429, 5xx); never after 4xx. */
export async function tryFetch(f: Fetch, url: string, init: RequestInit, o: {timeout: number; retries: number; backoff: number; until: number}): Promise<Response | "timeout" | "error"> {
  for (let attempt = 0; ; attempt++) {
    const left = o.until - Date.now();
    if (left < 300) return "timeout";
    let r: Response | "timeout" | "error";
    try {
      r = await f(url, {...init, signal: AbortSignal.timeout(Math.min(o.timeout, left))});
    } catch (e) {
      r = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "error";
    }
    const again = r === "timeout" || r === "error" || r.status === 429 || r.status >= 500;
    if (!again || attempt >= o.retries) return r;
    if (typeof r !== "string") await r.body?.cancel().catch(() => {});
    const after = typeof r !== "string" ? Number(r.headers.get("retry-after")) : NaN;
    const wait = Number.isFinite(after) && after > 0 && after <= 2 ? after * 1000 : jitter(o.backoff * 2 ** attempt);
    if (Date.now() + wait > o.until - 300) return r;
    await sleep(wait);
  }
}

/** The page's text, at most `cap` bytes of it. */
async function textOf(r: Response, cap: number): Promise<string> {
  const reader = r.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < cap) {
    const {done, value} = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(size, cap));
  let at = 0;
  for (const c of chunks) { const part = c.subarray(0, Math.min(c.length, all.length - at)); all.set(part, at); at += part.length; if (at >= all.length) break; }
  return new TextDecoder().decode(all);
}

/** Everything a shop's page says about what it sells: the products in its JSON-LD, else its product meta tags; and its name and photo. */
export function pageFacts(html: string): {products: Structured[]; title: string; image: string | null} {
  const products: Structured[] = [];
  for (let i = html.indexOf("application/ld+json"); i >= 0; i = html.indexOf("application/ld+json", i + 1)) {
    const start = html.indexOf(">", i) + 1, end = html.indexOf("</script>", start);
    if (start <= 0 || end < 0) break;
    try { productsIn(JSON.parse(html.slice(start, end).replace(/^\s*(?:<!--|\/\*<!\[CDATA\[\*\/)|(?:-->|\/\*\]\]>\*\/)\s*$/g, "").trim()), products); } catch { /* a broken block: the rest still count */ }
  }
  const head = html.slice(0, 262_144);
  const meta = (name: string) => {
    const m = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*>`, "i").exec(head);
    return m ? (/content=["']([^"']*)["']/i.exec(m[0])?.[1] ?? "") : "";
  };
  const title = noPounds(meta("og:title") || (/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] ?? "")).slice(0, 150);
  if (!products.some(p => p.offers.length)) {
    const price = gbp(meta("product:price:amount") || meta("og:price:amount"), meta("product:price:currency") || meta("og:price:currency") || "GBP");
    if (price) products.push({name: title, brand: undefined, model: "", image: null, offers: [{price, from: false, url: null, inStock: null, condition: "", delivery: null, name: title}]});
  }
  const og = meta("og:image");
  return {products, title, image: og.startsWith("https://") && !NOT_PHOTO.test(og) ? og : null};
}

/** Whether a product on a page is the one found in search: its codes and numbers all there, and no Pro, Max and so on it doesn't have. */
export function samePageProduct(found: string, page: string): boolean {
  const said = squash(page), marks = codesOf(found), sizes = marks.filter(isSize), codes = marks.filter(m => !isSize(m));
  if (variantsIn(page, found).length) return false;
  // a different size or storage named on the page is a different thing; none named, and it's down to the offer
  const pageSizes = codesOf(page).filter(isSize);
  if (sizes.length && pageSizes.length && !sizes.some(s => pageSizes.includes(s))) return false;
  if (codes.length) return codes.every(m => said.includes(m));
  const words = found.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  return words.length > 0 && words.filter(w => said.includes(w)).length / words.length >= 0.6;
}

/** What a shop's page says about a product found in search: its price there now (verified), whether it's in stock, delivery,
 *  condition and photo, or why it couldn't be read. Several prices and none for this exact one: the lowest, as a starting price. */
export function verifyOn(c: ShopProduct, html: string, now: Date, pageUrl = c.url): {product: ShopProduct; outcome: Outcome; image: string | null} {
  const facts = pageFacts(html);
  let path = "";
  try { path = decodeURIComponent(new URL(pageUrl).pathname); } catch { /* the page's own words alone */ }
  const mine = facts.products.filter(p => p.offers.length && samePageProduct(c.name, `${p.name} ${facts.title} ${p.offers.map(o => o.name).join(" ")} ${path}`));
  const offers = mine.flatMap(p => p.offers);
  const image = mine.find(p => p.image)?.image ?? facts.image;
  if (!offers.length) return {product: c, outcome: "noPrice", image};
  // the one for this exact thing (its size or storage named on the offer), else the only price, else the lowest as a starting price
  const sizes = codesOf(c.name).filter(isSize);
  const exact = sizes.length ? offers.filter(o => sizes.every(s => squash(o.name).includes(s))) : [];
  const pool = exact.length ? exact : offers, prices = new Set(pool.map(o => o.price));
  const best = pool.reduce((a, o) => o.price < a.price ? o : a);
  const from = best.from || (!exact.length && prices.size > 1);
  const condition = conditionOf(`${c.name} ${pageUrl}`, shopOf(c.url), best.condition);
  const {from: _f, inStock: _s, ...rest} = c;
  return {
    product: {...rest, price: best.price, ...from ? {from: true as const} : {}, confidence: "verified", priceSource: pageUrl, checked: now.toISOString(),
      evidence: `the shop's page: ${best.name || mine[0].name} ${best.price}`.slice(0, 160),
      condition: condition === "unknown" ? c.condition : condition, delivery: best.delivery ?? c.delivery, ...best.inStock === false ? {inStock: false as const} : {}},
    outcome: "ok", image,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
/** Everything it needs from outside: the fetch, Brave's key, the time, and how long it may take. */
export interface ShopEnv { fetch: Fetch; key: string; now?: () => Date; budgetMs?: number; robots?: Map<string, {txt: string | null; at: number}> }

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(n, items.length)}, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}
const blank = (): ShopStats => ({ms: {search: 0, verify: 0, photos: 0, total: 0}, cpuMs: 0, brave: 0, braveFailed: 0, fallback: 0, results: 0, candidates: 0, relevant: 0,
  returned: 0, verified: 0, listed: 0, estimated: 0, noPrice: 0, photos: 0, pages: {ok: 0, noPrice: 0, blocked: 0, robots: 0, timeout: 0, error: 0, skipped: 0}});
// robots.txt for a host, asked for once while this instance is warm (an hour at most); null when it couldn't be read for now
const ROBOTS_MS = 3_600_000;
const robotsCache = new Map<string, {txt: string | null; at: number}>();

/** Finds the products: searches (and more if fewer than five things came back), reads the best shops' pages, finds photos, and
 *  ranks what's left. Every step has a time limit; what's done by the end is what's returned. */
export async function runShop(ask: ShopAsk, env: ShopEnv): Promise<ShopResult> {
  const stats = blank(), start = Date.now(), now = env.now ?? (() => new Date()), until = start + (env.budgetMs ?? 16_000);
  if (!env.key) return {error: "not_configured", stats};
  const robots = env.robots ?? robotsCache;
  let cpu = 0;
  const timed = <R>(fn: () => R): R => { const t = performance.now(); try { return fn(); } finally { cpu += performance.now() - t; } };
  const headers = {"X-Subscription-Token": env.key, accept: "application/json"};
  const search = async (q: string): Promise<BraveResult[] | null> => {
    stats.brave++;
    const r = await tryFetch(env.fetch, braveUrl(q), {headers}, {timeout: 3_500, retries: 1, backoff: 500, until: Math.min(until, start + 9_000)});
    if (typeof r === "string" || !r.ok) { stats.braveFailed++; if (typeof r !== "string") await r.body?.cancel().catch(() => {}); return null; }
    const body = await r.json().catch(() => null);
    return body ? timed(() => resultsOf(body)) : (stats.braveFailed++, null);
  };

  // 1. search, and search again if fewer than five things fit
  const t0 = Date.now(), found: Candidate[] = [];
  const take = (results: (BraveResult[] | null)[]) => timed(() => {
    for (const rs of results) for (const r of rs ?? []) { stats.results++; found.push(...candidatesOf(r, now())); }
  });
  const first = await pool(ask.queries.slice(0, MAX_BRAVE), 4, search);
  take(first);
  if (first.every(r => r === null)) { stats.ms.search = Date.now() - t0; stats.ms.total = Date.now() - start; stats.cpuMs = Math.round(cpu); return {error: "unavailable", stats}; }
  let relevant = timed(() => dedupe(found.filter(p => fits(p, ask))));
  if (relevant.filter(p => p.price !== null).length < 5 && Date.now() < until - 6_000) {
    const more = fallbackQueries(ask, MAX_BRAVE - stats.brave);
    stats.fallback = more.length;
    take(await pool(more, 4, search));
    relevant = timed(() => dedupe(found.filter(p => fits(p, ask))));
  }
  stats.candidates = found.length;
  stats.ms.search = Date.now() - t0;

  // 2. read the best shops' own pages for their prices now
  const t1 = Date.now(), order = ranked(relevant), photos = new Map<string, string | null>();
  const toRead = order.filter(p => !p.listing && shopOf(p.url) && safeUrl(p.url)).slice(0, MAX_VERIFY);
  const verified = new Map<Candidate, ShopProduct>();
  await pool(toRead, 4, async c => {
    const outcome = await (async (): Promise<Outcome> => {
      if (c.skip) return "skipped";
      const host = new URL(c.url).hostname;
      // robots.txt first, once a host
      let rules = robots.get(host);
      if (!rules || Date.now() - rules.at > ROBOTS_MS) {
        const r = await tryFetch(env.fetch, `https://${host}/robots.txt`, {headers: {"user-agent": USER_AGENT}}, {timeout: 2_000, retries: 0, backoff: 0, until});
        const txt = typeof r === "string" ? null : r.status >= 400 && r.status < 500 ? "" : r.ok ? await textOf(r, 200_000) : (await r.body?.cancel().catch(() => {}), null);
        rules = {txt, at: Date.now()};
        robots.set(host, rules);
      }
      if (rules.txt === null) return "robots";
      if (!robotsAllow(rules.txt, new URL(c.url).pathname + new URL(c.url).search)) return "robots";
      // the page, following at most 3 redirects, each address checked again
      let url = c.url, r: Response | "timeout" | "error" = "error";
      for (let hop = 0; hop < 4; hop++) {
        r = await tryFetch(env.fetch, url, {headers: {"user-agent": USER_AGENT, accept: "text/html"}, redirect: "manual"}, {timeout: 4_000, retries: 1, backoff: 400, until});
        if (typeof r === "string" || r.status < 300 || r.status >= 400) break;
        const next = r.headers.get("location");
        await r.body?.cancel().catch(() => {});
        if (!next) return "error";
        const to = new URL(next, url).toString();
        if (!safeUrl(to) || !shopOf(to) || shopOf(to)?.name !== shopOf(c.url)?.name) return "blocked";
        url = to;
      }
      if (r === "timeout") return "timeout";
      if (r === "error") return "error";
      if (!r.ok) { await r.body?.cancel().catch(() => {}); return r.status === 403 || r.status === 401 || r.status === 429 ? "blocked" : "error"; }
      if (!/html/i.test(r.headers.get("content-type") ?? "text/html")) { await r.body?.cancel().catch(() => {}); return "error"; }
      const html = await textOf(r, 1_048_576);
      const got = timed(() => verifyOn(c, html, now(), url));
      photos.set(c.url, got.image);
      if (got.outcome === "ok") verified.set(c, got.product);
      return got.outcome;
    })().catch((): Outcome => "error");
    stats.pages[outcome]++;
  });
  stats.ms.verify = Date.now() - t1;
  // a page's price wins over search's; a page that couldn't be read leaves search's price as it was
  let products: ShopProduct[] = order.map(c => verified.get(c) ?? c);
  // within the budget, after the page's price
  products = products.filter(p => !(ask.maxPrice > 0 && p.price !== null && p.price > ask.maxPrice));
  products = spread(ranked(timed(() => sanePrices(dedupe(products)))));

  // 3. photos: Brave's own thumbnails as they are; else the page's, checked; else Brave's image search by name (a few)
  const t2 = Date.now();
  const check = async (url: string): Promise<boolean> => {
    if (url.startsWith("https://imgs.search.brave.com/")) return true;
    if (!safeUrl(url)) return false;
    for (const method of ["HEAD", "GET"] as const) {
      const r = await tryFetch(env.fetch, url, {method, headers: {"user-agent": USER_AGENT, ...method === "GET" ? {range: "bytes=0-1023"} : {}}}, {timeout: 2_500, retries: 0, backoff: 0, until: until + 2_000});
      if (typeof r === "string") return false;
      await r.body?.cancel().catch(() => {});
      if (r.ok && /^image\//i.test(r.headers.get("content-type") ?? "")) return true;
      if (r.status !== 405 && r.status !== 403 && r.status !== 501) return false;
    }
    return false;
  };
  let searches = 0;
  products = await Promise.all(products.map(async p => {
    const options = [p.image, photos.get(p.url) ?? null].filter((x): x is string => !!x);
    for (const url of options) if (await check(url)) return {...p, image: url};
    if (searches < MAX_PHOTO_SEARCHES && Date.now() < until) {
      searches++;
      stats.brave++;
      const r = await tryFetch(env.fetch, photoUrl(p.name.slice(0, 100)), {headers}, {timeout: 2_500, retries: 0, backoff: 0, until: until + 2_000});
      const got = typeof r !== "string" && r.ok ? photoOf(await r.json().catch(() => null), p.name) : null;
      if (typeof r !== "string" && !r.ok) await r.body?.cancel().catch(() => {});
      if (got) return {...p, image: got};
    }
    return {...p, image: null};
  }));
  stats.ms.photos = Date.now() - t2;

  const clean = products.map(p => { const {rank: _r, skip: _s, listing: _l, ...rest} = p as Candidate; return rest as ShopProduct; });
  stats.relevant = relevant.length;
  stats.returned = clean.length;
  for (const p of clean) {
    if (p.confidence === "verified") stats.verified++; else if (p.confidence === "search_listed") stats.listed++; else if (p.confidence === "estimated") stats.estimated++; else stats.noPrice++;
    if (p.image) stats.photos++;
  }
  stats.ms.total = Date.now() - start;
  stats.cpuMs = Math.round(cpu);
  const n = clean.length;
  return {products: clean, ...n < 5 ? {partial: n ? `Only ${n} ${n === 1 ? "product" : "products"} came back that fit.` : "Nothing came back that fits."} : {}, stats};
}

/** What a call cost in Brave requests (half a cent each, as the cap counts it). */
export const BRAVE_CENTS = 0.5;
/** One log line per call: counts and times, never a search or a product. */
export const shopLog = (s: ShopStats, auth: number | "cached", extra: Record<string, unknown> = {}) =>
  JSON.stringify({door: "shop", ms: s.ms, cpu: s.cpuMs, auth, brave: s.brave, brave_failed: s.braveFailed, fallback: s.fallback, results: s.results, candidates: s.candidates,
    relevant: s.relevant, returned: s.returned, verified: s.verified, listed: s.listed, estimated: s.estimated, no_price: s.noPrice, photos: s.photos, pages: s.pages,
    cents: s.brave * BRAVE_CENTS, ...extra});
