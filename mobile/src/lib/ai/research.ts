// Something to buy that Tim or Frank looked up, as a card leading his answer. find_products asks the accountant function's /shop
// (Brave's web search and the shops' own pages, supabase/functions/accountant/shop.ts) and the phone numbers what comes back p1, p2…
// in the chat; the card is built from those products by id, never from his words. Each price says how sure it is: on the shop's
// own page now (verified), as a shop's search listing has it (search_listed: its page couldn't be read), or an estimate. A product
// with no price is still shown, and never tried against your money. A price reaches your money only through show_products' pick,
// which runs the engine (whatIf) on it with its label. Pure.
import type Anthropic from "@anthropic-ai/sdk";
import {addDays, isoD, niceDate, nowHM} from "../dates";
import {money, moneyExact, r2} from "../money";
import {whatIf} from "../today";
import type {Ctx} from "../types";

type Message = Anthropic.Beta.Messages.BetaMessageParam;

export type Confidence = "verified" | "search_listed" | "estimated";
export type Condition = "new" | "refurbished" | "used" | "unknown";
/** One product at one shop, as /shop found it, with the id he knows it by. `price` null: none found (`confidence` null). `group`: the
 *  same thing at other shops shares it. `checked`: when the price was seen (ISO). `priceSource`: the page it's from. */
export interface Product {
  id: string; name: string; brand: string; model: string; group: string; retailer: string; host: string; url: string;
  price: number | null; from?: true; confidence: Confidence | null; priceSource: string | null;
  image: string | null; condition: Condition; delivery: number | "free" | null; inStock?: false; checked: string;
}
/** What /shop sends back: products in order, best first; `partial` when fewer than five fit; how it went (counts, never names). */
export interface Shopped { products: Omit<Product, "id">[]; partial?: string; stats?: Record<string, unknown> }
/** What find_products asks /shop for. */
export interface ShopArgs { queries: string[]; match: string[]; exclude: string[]; max_price: number }
/** The card: what it shows, what he assumed, the products in his order, and the one tried against your money (`pick`, an id). */
export interface Research {
  v: 2; title: string; note?: string; products: Product[]; pick?: string; partial?: string;
  /** why the pick is worth more than the cheapest on the card (only when it costs more: best value) */
  why?: string;
}

export const MAX_SHOWN = 8;
/** What the line where his answer will go says first, for a question that looks like one for the shops. */
export const PRICES_DOING = "Looking up prices…";
/** While /shop looks round. */
export const SHOPPING = "Looking round the shops…";
/** What the line says once he's found prices and is trying one against your money. */
export const CHECKING_IT = "Checking it against your money…";

/** How sure a price is, in his words (the tool results) and the card's. */
export const PRICE_IS: Record<Confidence, string> = {
  verified: "on the shop's own page now",
  search_listed: "listed in search; the shop's page couldn't be checked",
  estimated: "an estimate, not a shop's current listing",
};
const SURE_LABEL: Record<Confidence, string> = {verified: "On the shop's page", search_listed: "Listed in search", estimated: "Estimate"};
const confidenceOf = (said: unknown): Confidence | null =>
  (Object.keys(PRICE_IS) as Confidence[]).find(c => PRICE_IS[c] === said) ?? null;

/** What it costs to have: the price, and delivery when it's a charge. */
export const totalOf = (p: Pick<Product, "price" | "delivery">) => r2((p.price ?? 0) + (typeof p.delivery === "number" ? p.delivery : 0));

// ---------------------------------------------------------------------------------------------------------------------------
// The products as find_products gives them to him, and back. Only price and delivery are numbers: every number in a tool's
// result counts as a figure he may state (lib/ai/check.ts), and these only ever count to the penny, as prices (converse.ts).
/** Words from the web, safe for him: no £ amount (a tool's £ counts as known), short. */
export const clip = (s: string, n: number) => s.replace(/£\s?[\d,.]+/g, "").replace(/£/g, "").replace(/\s+/g, " ").trim().slice(0, n);
/** One product in find_products' result. */
export function forTool(p: Product): Record<string, unknown> {
  return {
    id: p.id, name: clip(p.name, 100), shop: clip(p.retailer, 40), ...p.brand ? {brand: clip(p.brand, 40)} : {},
    price: p.price, ...p.price !== null && p.from ? {from: true} : {}, price_is: p.confidence ? PRICE_IS[p.confidence] : "no price found",
    condition: p.condition, ...p.delivery === "free" ? {delivery: "free"} : typeof p.delivery === "number" ? {delivery: p.delivery} : {},
    ...p.inStock === false ? {out_of_stock: true} : {}, seen: p.checked, group: p.group,
    // for the card: never to write in an answer
    model: clip(p.model, 40), host: p.host, url: p.url, ...p.priceSource && p.priceSource !== p.url ? {price_page: p.priceSource} : {}, ...p.image ? {photo: p.image} : {},
  };
}
function fromTool(x: Record<string, unknown>): Product | null {
  const str = (k: string) => typeof x[k] === "string" ? x[k] as string : "";
  if (!/^p\d+$/.test(str("id")) || !str("name") || !str("url").startsWith("https://")) return null;
  const price = typeof x.price === "number" ? x.price : null, confidence = price === null ? null : confidenceOf(x.price_is);
  return {
    id: str("id"), name: str("name"), brand: str("brand"), model: str("model"), group: str("group"), retailer: str("shop"), host: str("host"), url: str("url"),
    price, ...price !== null && x.from === true ? {from: true as const} : {}, confidence, priceSource: price === null ? null : str("price_page") || str("url"),
    image: str("photo").startsWith("https://") ? str("photo") : null, condition: (["new", "refurbished", "used"].includes(str("condition")) ? str("condition") : "unknown") as Condition,
    delivery: x.delivery === "free" ? "free" : typeof x.delivery === "number" ? x.delivery : null, ...x.out_of_stock === true ? {inStock: false as const} : {}, checked: str("seen"),
  };
}

/** The ids of every call to a tool in a conversation. */
export function callsOf(msgs: readonly Message[], name: string): Set<string> {
  const ids = new Set<string>();
  for (const m of msgs) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content) if (b.type === "tool_use" && b.name === name) ids.add(b.id);
  }
  return ids;
}

/** Every product find_products found in a conversation, by id, from its results as he saw them (so a chat opened again has them). */
export function catalogueIn(msgs: readonly Message[]): Map<string, Product> {
  const finds = callsOf(msgs, "find_products"), out = new Map<string, Product>();
  for (const m of msgs) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== "tool_result" || !finds.has(b.tool_use_id) || b.is_error || typeof b.content !== "string") continue;
      try {
        const products = (JSON.parse(b.content) as {products?: unknown}).products;
        if (Array.isArray(products)) for (const x of products) { const p = x && typeof x === "object" ? fromTool(x as Record<string, unknown>) : null; if (p) out.set(p.id, p); }
      } catch { /* not one of ours */ }
    }
  }
  return out;
}
/** The next product id in a conversation: one after the highest so far. */
export const nextIdIn = (catalogue: ReadonlyMap<string, Product>) => Math.max(0, ...[...catalogue.keys()].map(id => Number(id.slice(1)))) + 1;

/** The card find_products makes by itself: its products in its order, up to 8, at most 2 of each thing when it found several
 *  things (when it's one thing at several shops, the shops). */
export function defaultCard(products: Product[], title: string, partial?: string): Research {
  const groups = new Set(products.map(p => p.group)).size, seen = new Map<string, number>(), shown: Product[] = [];
  for (const p of products) {
    const n = seen.get(p.group) ?? 0;
    if (shown.length >= MAX_SHOWN || (groups >= 3 && n >= 2)) continue;
    seen.set(p.group, n + 1);
    shown.push(p);
  }
  // the cheapest that fits is always on it (in place of the last one when it's full)
  const low = lowestOf(products);
  if (low && !shown.includes(low)) { if (shown.length >= MAX_SHOWN) shown.pop(); shown.push(low); }
  return {v: 2, title: clip(title, 60) || "What I found", products: shown, ...partial ? {partial} : {}};
}
/** A title for a card he didn't name: the words every product had to have, else his first search. */
export const titleOf = (args: Pick<ShopArgs, "queries" | "match">) => {
  const t = args.match.length ? args.match.join(" ") : args.queries[0] ?? "";
  return t ? `${t[0].toUpperCase()}${t.slice(1)}` : "What I found";
};

/** The product he tried on a card, if any. */
export const pickOf = (r: Research | null | undefined) => r?.pick ? r.products.find(p => p.id === r.pick) ?? null : null;

// ---------------------------------------------------------------------------------------------------------------------------
// Subscriptions and plans are what the web rules are for, not this: there's no product to find for what Netflix charges
const SUBSCRIPTIONS = /\b(?:subscriptions?|netflix|spotify|disney|plans?|a month|per month|monthly|a year|broadband|insurance|contract|tariff)\b/i;
/** Whether a question carries on a purchase already being looked at: "And an Xbox?". */
export const notSubscription = (question: string) => !SUBSCRIPTIONS.test(question);

// "can I afford a new iPhone", "is it worth getting a TV", "how much would a gaming PC cost", "find me some headphones": a question
// for the shops. One with its own figure in it, or about money you have, spend or owe, or a subscription, isn't
const SHOPS = /\b(?:afford|buy|buying|purchase|get(?:ting)? (?:a|an|the|some|one|new)|worth (?:it|getting|buying)|how much (?:is|are|does|do|would|will) (?:a|an|the|one|it)|cost|price of|find me|cheapest place|compare)\b/i;
const NOT_SHOPS = /£|\d\s?(?:quid|pounds?)\b|\b(?:left|spend|spent|spending|due|owe|bills?|rent|payday|budgets?|takeaways?|lunch|dinner|coffee|groceries|drinks?)\b/i;
/** Whether a question looks like it's about buying something: what the line where his answer will go says first, and whether a
 *  price has to come through find_products. */
export const pricesLikely = (question: string) => SHOPS.test(question) && !NOT_SHOPS.test(question) && notSubscription(question);

// ---------------------------------------------------------------------------------------------------------------------------
// A shop's name for a product is its whole listing ("Apple Watch Ultra 4 GPS + Cell 49mm Titanium Burgundy Alpine Loop"): the card
// names it by its model and size ("Apple Watch Ultra 4 49mm") and puts the rest under it ("GPS + Cell Titanium Burgundy Alpine Loop")
// a size: "49mm", "49 mm", '65"', "65″", "65in", "65 inch", "65-inch" (storage stays where it is: it's part of the model)
const SIZE = /(^|\s)(\d+(?:\.\d+)?)(\s?mm\b|["″]|in\b|[\s-]?inch(?:es)?\b)/i;
// where the listing goes on to other things: a comma, a spaced dash or bar, or brackets (not "(3rd generation)", which is the model)
const SEP = /,|\s[-–|]\s|\((?![^)]*\bgen(?:eration)?\b)/i;
// words that go on naming the model after its number ("iPhone 17 Pro Max", "Bravia 8 II"); a resolution isn't one ("4K")
const VARIANT = /^(?:pro|max|ultra|plus|\+|mini|air|se|fe|ti|xl|lite|gen|ii|iii|iv)$/i;
const hasDigit = (w: string) => /\d/.test(w) && !/^\d+k$/i.test(w);
const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s+\-–,·]+|[\s\-–,·]+$/g, "").trim();
/** A product's name as the card shows it: its model and size (`title`), and the rest of the listing (`specs`, "" when none). */
export function nameParts(name: string): {title: string; specs: string} {
  const whole = tidy(name);
  const size = SIZE.exec(whole);
  const sized = size ? `${size[2]}${/mm/i.test(size[3]) ? "mm" : "″"}` : "";
  const rest = size ? tidy(whole.slice(0, size.index) + size[1] + whole.slice(size.index + size[0].length)) : whole;
  const sep = SEP.exec(rest), head = tidy(sep ? rest.slice(0, sep.index) : rest), tail = sep ? rest.slice(sep.index) : "";
  const words = head.split(" ").filter(Boolean), first = words.findIndex(hasDigit);
  let end = words.length;
  if (first >= 0 && first < 6) {
    end = first + 1;
    // on while the words still name the model, and through a bracket it opened ("(3rd generation)")
    const open = () => words.slice(0, end).join(" ").split("(").length > words.slice(0, end).join(" ").split(")").length;
    while (end < words.length && (hasDigit(words[end]) || VARIANT.test(words[end]) || open())) end++;
  }
  const title = tidy([...words.slice(0, end), sized].join(" "));
  const specs = [words.slice(end).join(" "), ...tail.split(/[,|()]|\s[-–]\s/)].map(tidy).filter(Boolean).join(" · ");
  return title ? {title, specs} : {title: whole, specs: ""};
}

/** What to look a card's photo up by (an old card, from before /shop found photos): its name without his asides. */
export const photoQuery = (product: string) => product.replace(/\([^)]*\)/g, "").split(",")[0].replace(/\s+/g, " ").trim() || product.trim();

// ---------------------------------------------------------------------------------------------------------------------------
// The card as shown
export interface Tile {
  id: string; name: string; retailer: string; price: string; sure: string; sureIcon: "check" | "search" | "estimate" | null;
  meta: string; url: string; host: string; image?: string; pick: boolean; selectable: boolean; label: string;
  /** tied for the lowest price on the card, with delivery (a shop's price, never an estimate; only with two or more to compare,
   *  and not when every price is the same) */
  lowest: boolean;
  /** the one he went by for best value, over a cheaper one on the card */
  value?: true;
}
/** The card as shown, worked out once when it arrives (so what it says about today is what his answer said at the time).
 *  `best`: the one he tried against your money; `ifToday`: what buying it today would do, as Today's "What if I spend…" says it. */
export interface ResearchView {
  v: 2; title: string; note?: string; tiles: Tile[]; partial?: string; checked: string;
  /** `value`: he went by it over the cheapest, `why` says what the extra buys, `more` how much more ("£30.00 more than the cheapest, at Argos") */
  best: {label: string; name: string; price: string; by: string; spec?: string; value?: true; why?: string; more?: string} | null; ifLabel: string; ifToday: string | null;
}

const CONDITION: Partial<Record<Condition, string>> = {new: "New", refurbished: "Refurbished", used: "Used"};
const deliveryOf = (p: Product) => p.delivery === "free" ? "Free delivery" : typeof p.delivery === "number" ? `${moneyExact(p.delivery)} delivery` : null;
/** A product's price as the card says it: a starting price "From", an estimate "About", none "No price found". */
export const priceOf = (p: Product) => p.price === null ? "No price found" : p.confidence === "estimated" ? `About ${money(Math.round(p.price))}` : `${p.from ? "From " : ""}${moneyExact(p.price)}`;

// when the prices were read: "09:12" today, "yesterday 18:40", else the day
function whenOf(iso: string, now: Date): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return nowHM(now);
  const day = isoD(d), today = isoD(now);
  return day === today ? nowHM(d) : day === addDays(today, -1) ? `yesterday ${nowHM(d)}` : `${niceDate(day)}, ${nowHM(d)}`;
}

/** What can be the cheapest: a shop's price for it new (or not said), in stock, and a real price, not an estimate or a starting
 *  price (the one they'd want may cost more). */
const comparable = (p: Product) => p.price !== null && (p.confidence === "verified" || p.confidence === "search_listed") &&
  (p.condition === "new" || p.condition === "unknown") && p.inStock !== false && !p.from;
/** The cheapest that fits, with delivery (`comparable`; on a tie, one on the shop's own page), and only when there are two or more
 *  to compare. Frank is told which (find_products' `cheapest`), the card marks it, and it's what he tries unless they asked otherwise. */
export function lowestOf(products: readonly Product[]): Product | null {
  const priced = products.filter(comparable);
  const better = (p: Product, a: Product) => totalOf(p) < totalOf(a) - 0.004 ||
    (Math.abs(totalOf(p) - totalOf(a)) < 0.005 && p.confidence === "verified" && a.confidence !== "verified");
  return priced.length < 2 ? null : priced.reduce((a, p) => better(p, a) ? p : a);
}

/** The card's cheapest that fits, when it costs less than the pick (with delivery): the pick is then his best value, not the cheapest. */
export function cheaperOf(products: readonly Product[], pick: Product): Product | null {
  const low = lowestOf(products);
  return low && low !== pick && totalOf(low) < totalOf(pick) - 0.004 ? low : null;
}

/** Every product tied for the lowest price on a card (`lowestOf`'s rule); none when every shop's price is the same. */
export function lowestIds(products: readonly Product[]): Set<string> {
  const low = lowestOf(products);
  if (!low) return new Set();
  const priced = products.filter(comparable);
  const tied = priced.filter(p => Math.abs(totalOf(p) - totalOf(low)) < 0.005);
  return tied.length === priced.length ? new Set() : new Set(tied.map(p => p.id));
}

export function researchView(ctx: Ctx, r: Research, now: Date): ResearchView {
  const pick = pickOf(r), lowest = lowestIds(r.products), cheaper = pick && pick.price !== null ? cheaperOf(r.products, pick) : null;
  const tiles = r.products.map((p): Tile => {
    const sure = p.confidence ? SURE_LABEL[p.confidence] : "No price found", price = priceOf(p);
    const meta = [CONDITION[p.condition], deliveryOf(p), p.inStock === false ? "Out of stock" : null, p.from ? "Starting price" : null].filter(Boolean).join(" · ");
    return {
      id: p.id, name: p.name, retailer: p.retailer, price, sure: p.price === null ? "" : sure,
      sureIcon: p.confidence === "verified" ? "check" : p.confidence === "search_listed" ? "search" : p.confidence === "estimated" ? "estimate" : null,
      meta, url: p.url, host: p.host, ...p.image ? {image: p.image} : {}, pick: p.id === r.pick, selectable: p.price !== null, lowest: lowest.has(p.id),
      ...cheaper && p.id === r.pick ? {value: true as const} : {},
      label: [`${p.name} at ${p.retailer}`, price, lowest.has(p.id) ? "the lowest price" : "", cheaper && p.id === r.pick ? "best value" : "", p.price === null ? "" : sure, meta].filter(Boolean).join(", "),
    };
  });
  const oldest = r.products.reduce((a, p) => p.price !== null && p.checked && (!a || p.checked < a) ? p.checked : a, "");
  return {
    v: 2, title: r.title, ...r.note ? {note: r.note} : {}, tiles, ...r.partial ? {partial: r.partial.replace(/came back that fit\.$/, "found.")} : {},
    checked: `Prices as of ${whenOf(oldest || now.toISOString(), now)}`,
    best: pick && pick.price !== null ? {label: cheaper ? "Best value" : "Going by", name: pick.name, price: priceOf(pick),
      by: [`at ${pick.retailer}`, pick.confidence ? SURE_LABEL[pick.confidence] : null, deliveryOf(pick)].filter(Boolean).join(" · "),
      ...pick.from ? {spec: "A starting price: the one you'd want may cost more."} : {},
      ...cheaper ? {value: true as const, ...r.why ? {why: r.why} : {}, more: `${moneyExact(r2(totalOf(pick) - totalOf(cheaper)))} more than the cheapest, at ${cheaper.retailer}`} : {}} : null,
    ifLabel: pick?.from ? "If you paid the starting price today" : pick?.confidence === "estimated" ? "If it's about that, today" : "If you bought it today",
    ifToday: pick && pick.price !== null ? whatIf(ctx, totalOf(pick))?.line ?? null : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// A card from before find_products (one product, the shops whose pages backed a price), as kept in a saved chat: drawn as it was
/** One shop's tile on an old card. */
export interface OfferRow { seller: string; meta: string; price: string; url: string; host: string; pick: boolean; label: string; photo?: string }
/** An old card as it was worked out and kept. */
export interface OldResearchView {
  product: string; note?: string; best: {label: string; price: string; by: string; spec?: string} | null;
  rows: OfferRow[]; ifLabel: string; ifToday: string | null; checked: string; limited?: string;
}
/** Whether a kept card is a new one. */
export const isNewView = (v: ResearchView | OldResearchView): v is ResearchView => (v as ResearchView).v === 2;
