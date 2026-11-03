// A purchase Tim or Frank looked up, shown as a card leading his answer (the accountant function's BUYING): what it is, what he
// assumed, and up to 4 shops' prices. He searches, opens the shops' own pages (a product page or the shop's listing), then calls
// check_purchase with what he found. Anthropic hands back each page's text, so the app reads it itself: an offer is kept only when
// the page backs it, and only a price kept here reaches the engine. It has to be the shop's own page, not an article, showing that
// model at that price to the penny; a starting price ("From £32,295") or a size the page doesn't show with it is kept but said
// so, never passed off as that exact one's price. Delivery and refurbished come from the page too. His own words only name the shop, what it is, and which
// one he went by, and its link is the page he opened. Anything not kept is turned away with the reason. Pure.
import type Anthropic from "@anthropic-ai/sdk";
import {addDays, isoD, niceDate, nowHM} from "../dates";
import {moneyExact, r2} from "../money";
import {whatIf} from "../today";
import type {Ctx} from "../types";
import {poundsIn} from "./check";
import {hostOf} from "./web";

type Message = Anthropic.Beta.Messages.BetaMessageParam;

export type Condition = "new" | "refurbished" | "used";
export const CONDITIONS: Condition[] = ["new", "refurbished", "used"];
/** One shop's price, as its page has it. `checked`: when the page was read (ISO). `pick`: the one he went by. `from`: the page
 *  calls it a starting price ("From £32,295"). `unshown`: sizes he named that the page doesn't show with that price, so it isn't
 *  that exact one's price. With neither, it's an exact match. */
export interface Offer {
  seller: string; condition: Condition; price: number; delivery?: number | "free";
  url: string; title: string; host: string; checked: string; pick?: true; from?: true; unshown?: string[];
}
/** The card. */
export interface Research { product: string; note?: string; offers: Offer[] }
/** An offer the page didn't back, and why, in a few plain words with no £ in them (he reads them, and a tool's £ counts as known). */
export interface Rejected { seller: string; price: number; why: string; pick?: true }

/** What he says he found: check_purchase's arguments. */
export interface OfferClaim { seller: string; url: string; price: number; condition: Condition; delivery: number | null; pick: boolean }
export interface PurchaseClaim { product: string; assumed: string; identifies: string[]; offers: OfferClaim[] }

/** A page he opened: its address as it came back, what it's called, its text, and when it was read. */
export interface Page { url: string; host: string; title: string; text: string; read: string }
/** The pages he's opened in a conversation, by address (the one he asked for and the one it landed on), and the ones still opening.
 *  `recent`: the addresses of the ones opened for this question. */
export interface Pages { open: Map<string, Page>; waiting: Set<string>; recent?: Set<string> }

export const MAX_OFFERS = 4;
/** What the line where his answer will go says first, for a question that looks like one for the shops. */
export const PRICES_DOING = "Looking up prices…";
/** What the line where his answer will go says once he's found prices and is trying one against your money. */
export const CHECKING_IT = "Checking it against your money…";

// a £ amount where it is, as check.ts reads them
const POUND = /£\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g;
const NEAR = 300, DAY_MS = 86_400_000, OLD_DAYS = 7;
// not the price of the thing: by the month or a part of it, what you save, or only with something else
const AFTER = /^\s*(?:\/\s?(?:mo|month|m)\b|a month|per month|p\/?m\b|monthly|x\s?\d+|for \d+ months|off\b|deposit\b|upfront\b|up front\b|ex\.?\s?vat\b|excl?\.?\s?vat\b|(?:with|after)\s+(?:a\s+|your\s+)?trade)/i;
const BEFORE = /(?:\bwas|\brrp|\bsave|\bsaving|\bdeposit(?: of)?|\bpayments? of|\binstal?ments? of|\bmonthly|\bdown)[:\s]*$/i;
// the cheapest one goes for this: the page says so just before the price
const FROM = /(?:\bfrom|\bstarting (?:at|from)|\bprices? from)[:\s]*$/i;
// a price written straight after the one before it, with nothing between
const GLUED = /£\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*$/;
// the price that starts here
const HERE = /^£\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/;
const GONE = /\b(?:out of stock|sold out|currently unavailable|no longer available)\b/i;
const FREE = /\bfree (?:standard |uk |next[- ]day |home )?(?:delivery|shipping|postage)\b|\bdelivery:?\s*free\b/i;
const DELIVERY = /\b(?:delivery|postage|shipping)\b/i;
const REFURB = /\brefurb|\brenewed\b/i;
const SECOND_HAND = /\bpre-?owned\b|\bsecond[- ]?hand\b/i;
const USED = /\bused\b/i;
// a page on a shop's site that writes about things rather than sells them
const WRITING = /\/(?:blogs?|news|articles?|reviews?|guides?|buying-guides?|buyingguides|best-[^/]*|[^/]*-vs-[^/]*)(?:\/|$)/i;
// a different model, when the page's title has one of these and what he says it is doesn't (a 4K "Ultra HD" or "Mini LED" TV isn't)
const VARIANT = /\b(pro|max|ultra(?!\s*-?hd)|ti|plus|mini(?!\s*-?led))\b/gi;
// words in a shop's name that say nothing about which shop it is, and what shops' sites add to their names
const PLAIN_WORDS = new Set(["the", "and", "uk", "shop", "store", "online", "direct", "official", "ltd", "limited", "group", "co", "com"]);
const SITE_ENDINGS = new Set(["online", "direct", "uk", "shop", "store", "stores", "computers", "electrical", "electricals", "tech", "group"]);

// letters and digits only, with sizes one way, so a page's "55-inch" is "55inch" and its "256 GB" is "256gb"
const sizesOneWay = (s: string) => s.toLowerCase().replace(/(\d)\s*-?\s*(?:"|”|″|inches|inch)/g, "$1inch").replace(/(\d)in\b/g, "$1inch").replace(/(\d)\s+(gb|tb)\b/g, "$1$2");
const squash = (s: string) => sizesOneWay(s).replace(/[^a-z0-9]/g, "");
const noPounds = (s: string) => s.replace(/£/g, "").replace(/\s+/g, " ").trim();
const SIZE = /\b\d+\s?(?:gb|tb)\b|\b\d{2,3}(?:\s*-?\s*(?:"|”|″|inches|inch)|in\b)/gi;
// a size, squashed: "256gb", "55inch"; and as it's said: "256GB", "55-inch"
const isSize = (n: string) => /^\d+(?:gb|tb|inch)$/.test(n);
const sizeSaid = (n: string) => n.endsWith("inch") ? `${n.slice(0, -4)}-inch` : n.toUpperCase();
const listed = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;

// The name a site goes by: argos.co.uk → argos, shop.bt.com → bt, store.sony.co.uk → sony
function siteOf(host: string): string {
  const parts = host.split(".");
  const two = parts.length > 2 && /^(?:co|org|ltd|plc|me|net|ac|gov)$/.test(parts[parts.length - 2]);
  return parts[parts.length - (two ? 3 : 2)] ?? host;
}
/** Whether a page is on the shop's own site: John Lewis is johnlewis.com, CCL Computers cclonline.com, AO ao.com. A name that only
 *  shares a word isn't: Apple isn't appleinsider.com, Box isn't xbox.com. */
export function ownSite(seller: string, host: string): boolean {
  const site = squash(siteOf(host));
  if (site.length < 2) return false;
  const words = seller.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !PLAIN_WORDS.has(w));
  return [squash(seller), words.join(""), words[0] ?? ""].filter(Boolean).some(name =>
    site === name || name.startsWith(site) || (site.startsWith(name) && SITE_ENDINGS.has(site.slice(name.length))));
}

const urlKey = (url: string) => url.replace(/#.*$/, "").replace(/\/+$/, "").replace(/^https?:\/\/(?:www\.)?/i, "").toLowerCase();

/** The pages opened in these turns. A page that didn't open isn't one (it's why he should try another). `since`: where this
 *  question's turns start, so `recent` has the pages opened for it. */
export function pagesIn(turns: readonly Message[], since = 0): Pages {
  const open = new Map<string, Page>(), waiting = new Set<string>(), asked = new Map<string, string>(), done = new Set<string>(), recent = new Set<string>();
  for (const [i, m] of turns.entries()) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "server_tool_use" && b.name === "web_fetch") {
        const url = (b.input as {url?: unknown} | null)?.url;
        if (typeof url === "string") asked.set(b.id, url);
      } else if (b.type === "web_fetch_tool_result") {
        done.add(b.tool_use_id);
        const r = b.content;
        if (r.type !== "web_fetch_result" || r.content.source.type !== "text") continue;
        const host = hostOf(r.url);
        if (!host) continue;
        const page: Page = {url: r.url, host, title: r.content.title ?? "", text: r.content.source.data, read: r.retrieved_at ?? ""};
        open.set(urlKey(r.url), page);
        if (i >= since) recent.add(urlKey(r.url));
        const first = asked.get(b.tool_use_id);
        if (first) open.set(urlKey(first), page);
      }
    }
  }
  for (const [id, url] of asked) if (!done.has(id)) waiting.add(urlKey(url));
  return {open, waiting, recent};
}

/** The shops whose pages he opened for this question but left out of what he found, by site: each could have had a price. */
export function notPassed(claim: PurchaseClaim, pages: Pages): string[] {
  const named = new Set(claim.offers.map(o => pages.open.get(urlKey(o.url))?.host ?? hostOf(o.url)));
  return [...new Set([...pages.recent ?? []].map(k => pages.open.get(k)?.host).filter((h): h is string => !!h && !named.has(h)))];
}

// a price is what the thing costs, not what you save
const saving = (text: string, at: number) => BEFORE.test(text.slice(Math.max(0, at - 20), at));
// each place a price stands on a page as the price of the thing: not by the month, not what you save, and not a was price a
// listing puts straight after what it costs now ("Save £30.00 £299.00 £329.00"; an RRP before it, "£1,049.99£999.98", is fine)
function pricedAt(text: string, price: number): number[] {
  return [...text.matchAll(POUND)].flatMap(m => {
    const at = m.index!, end = at + m[0].length;
    if (poundsIn(m[0])[0] !== price || AFTER.test(text.slice(end, end + 30)) || saving(text, at)) return [];
    const glued = GLUED.exec(text.slice(Math.max(0, at - 30), at));
    if (glued && poundsIn(glued[0])[0] < price && !saving(text, at - glued[0].length)) return [];
    return [at];
  });
}
// The words that go with a price: from the price before it (prices written straight after each other, an RRP and what it is now,
// count as one) to the next one, at most NEAR either way. On a listing that's its own tile, so another product's name can't
// vouch for it; on a product page it reaches the spec under the price
function blockOf(text: string, at: number): {before: string; after: string} {
  let before = text.slice(Math.max(0, at - NEAR), at), last = before.lastIndexOf("£");
  while (last >= 0 && /^£\s?[\d,.]+\s*$/.test(before.slice(last))) {
    before = before.slice(0, last);
    last = before.lastIndexOf("£");
  }
  const end = at + (HERE.exec(text.slice(at))?.[0].length ?? 1), after = text.slice(end, end + NEAR), next = after.indexOf("£");
  return {before: before.slice(last + 1), after: next < 0 ? after : after.slice(0, next)};
}
// what's written just before a price on its own line, which names the product it's for on a listing ("Apple iPhone 17 Pro £999.00")
const lead = (before: string) => before.slice(before.lastIndexOf("\n") + 1).slice(-150);
// the words on a price's own line, not much either way: the row above can be another phone
function lineOf(text: string, at: number): string {
  const end = text.indexOf("\n", at);
  return text.slice(Math.max(text.lastIndexOf("\n", at) + 1, at - 100), Math.min(end < 0 ? text.length : end, at + 100));
}

const capital = (w: string) => `${w[0].toUpperCase()}${w.slice(1)}`;
const variantsIn = (s: string, product: string) => [...s.matchAll(VARIANT)].map(m => m[1].toLowerCase()).filter(v => !new RegExp(`\\b${v}\\b`).test(product));

// Why this page doesn't back this price for this product; or where on the page it does, whether the page calls it a starting
// price, and the sizes he named that it doesn't show with it. The model has to be there; a size can only be left unshown, never
// a different one, so a 512GB price never passes as 256GB.
function pageSays(page: Page, claim: PurchaseClaim, price: number): {why: string} | {at: number; from: boolean; unshown: string[]} {
  const where = squash(`${page.title} ${page.url}`), product = claim.product.toLowerCase();
  const all = [...claim.identifies.map(squash), ...(claim.product.match(SIZE) ?? []).map(squash)].filter(Boolean);
  const model = [...new Set(all.filter(n => !isSize(n)))], sizes = [...new Set(all.filter(isSize))];
  // a page for another model by its title, before anything else: its page could well show the price. Not a listing that names his
  // model on its own as well ("iPhone 17, 17 Pro and Pro Max"): there it's down to the words by each price
  const titled = variantsIn(page.title, product), name = squash(page.title);
  const plainToo = model.length > 0 && model.every(n => [...name.matchAll(new RegExp(n, "g"))]
    .some(m => !titled.some(v => name.slice(m.index! + n.length).startsWith(v))));
  if (titled.length && !plainToo) return {why: `that page is the ${capital(titled[0])}, not ${noPounds(claim.product)}`};
  const prices = pricedAt(page.text, price);
  if (!prices.length) return {why: poundsIn(page.text).includes(price) ? "on that page that figure isn't the price of the thing (monthly, part of a payment, or an old price)" : "the page doesn't show that price"};
  // each place on the page where it's that product at that price, and why the others aren't
  const kept: {at: number; from: boolean; unshown: string[]}[] = [], whys: string[] = [];
  for (const at of prices) {
    const {before, after} = blockOf(page.text, at), from = FROM.test(page.text.slice(Math.max(0, at - 20), at)), led = lead(before);
    // a starting price is the cheapest one's: a size after it isn't what it's for
    const by = squash(from ? before : `${before} ${after}`);
    const variant = variantsIn(led, product)[0];
    if (variant) { whys.push(`that price is for the ${capital(variant)}, not ${noPounds(claim.product)}`); continue; }
    const missing = model.find(n => !where.includes(n) && !squash(`${before} ${after}`).includes(n));
    if (missing) { whys.push(`the page doesn't show ${noPounds(claim.identifies.find(i => squash(i) === missing) ?? missing)} by that price`); continue; }
    // a size written with the price that isn't his is a different one's price
    const written = [...before.matchAll(SIZE)].map(m => squash(m[0]));
    if (sizes.length && written.length && !written.some(w => sizes.includes(w))) { whys.push(`that price is for the ${sizeSaid(written[written.length - 1])}`); continue; }
    if (GONE.test(after.slice(0, 150))) { whys.push("the page says it's out of stock"); continue; }
    kept.push({at, from, unshown: sizes.filter(n => !where.includes(n) && !by.includes(n)).map(sizeSaid)});
  }
  // that exact one somewhere is best. If the page ties this price to another size, a starting price or one with no size by it
  // elsewhere doesn't make it his size's
  const score = (k: typeof kept[0]) => k.unshown.length * 2 + Number(k.from);
  const best = kept.sort((a, b) => score(a) - score(b))[0], other = whys.find(w => w.startsWith("that price is for the"));
  if (best && (!best.unshown.length || !other)) return best;
  return {why: other ?? whys[whys.length - 1]};
}

/** Reads what he found against the pages he opened: what they back, and what they don't and why. `waiting`: a page he named hasn't
 *  opened yet (asked for beside this call, it opens on the next request). */
export function checkOffers(claim: PurchaseClaim, pages: Pages, now: Date): {research: Research | null; rejected: Rejected[]; waiting: boolean} {
  const offers: Offer[] = [], rejected: Rejected[] = [], product = noPounds(claim.product).slice(0, 80), note = noPounds(claim.assumed).slice(0, 100);
  let waiting = false;
  const named = claim.identifies.some(i => squash(i));
  for (const o of claim.offers) {
    const seller = noPounds(o.seller).slice(0, 40), key = urlKey(o.url), page = pages.open.get(key), pick = o.pick ? {pick: true as const} : {};
    const no = (why: string) => { rejected.push({seller, price: o.price, why, ...pick}); };
    if (!seller) { no("no shop named"); continue; }
    if (!named) { no("nothing says which product it is"); continue; }
    if (!page) {
      if (pages.waiting.has(key)) waiting = true;
      else no("you haven't opened that page");
      continue;
    }
    if (WRITING.test(page.url.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, ""))) { no("an article, not a shop page"); continue; }
    if (!ownSite(seller, page.host)) { no(`that page isn't on ${seller}'s own site`); continue; }
    if (page.read && now.getTime() - new Date(page.read).getTime() > OLD_DAYS * DAY_MS) { no("that copy of the page is too old"); continue; }
    if (!(o.price > 0)) { no("no price given"); continue; }
    const says = pageSays(page, claim, o.price);
    if ("why" in says) { no(says.why); continue; }
    // what kind it is, as he says, unless the page's own name or the words on the price's own line say it's refurbished or second-hand
    const called = `${page.title} ${page.url}`, by = lineOf(page.text, says.at);
    const condition: Condition = o.condition !== "new" ? o.condition : REFURB.test(called) || REFURB.test(by) ? "refurbished"
      : USED.test(called) || SECOND_HAND.test(called) || SECOND_HAND.test(by) ? "used" : "new";
    // delivery, only as the page says it
    const delivery = o.delivery === 0 ? (FREE.test(page.text) ? "free" as const : null) : o.delivery !== null && quotesDelivery(page.text, o.delivery) ? o.delivery : null;
    const offer: Offer = {seller, condition, price: o.price, ...delivery !== null ? {delivery} : {}, url: page.url, title: page.title || page.host, host: page.host,
      checked: page.read || now.toISOString(), ...pick, ...says.from ? {from: true as const} : {}, ...says.unshown.length ? {unshown: says.unshown} : {}};
    if (!offers.some(x => x.url === offer.url && x.price === offer.price)) offers.push(offer);
  }
  if (!offers.length) return {research: null, rejected, waiting};
  const kept = offers.slice(0, MAX_OFFERS);
  return {research: {product, ...note ? {note} : {}, offers: pickOne(kept, claim)}, rejected, waiting};
}

// the page calls this much its delivery: the figure, then "delivery" just after it, or just before
function quotesDelivery(text: string, x: number): boolean {
  return [...text.matchAll(POUND)].some(m => {
    if (poundsIn(m[0])[0] !== x) return false;
    const at = m.index!, end = at + m[0].length;
    return DELIVERY.test(text.slice(end, end + 20)) || DELIVERY.test(text.slice(Math.max(0, at - 20), at));
  });
}

// the one he went by: the first he marked that's kept; else, what he'd have gone by, the cheapest of the kind he marked (or of new
// when he marked none), an exact match before a starting price. Of a different kind from what he marked, there's nothing to go
// by: refurbished isn't the new one he priced
function pickOne(kept: Offer[], claim: PurchaseClaim): Offer[] {
  const marked = claim.offers.find(o => o.pick), plain = kept.map(({pick, ...o}) => o as Offer);
  const first = kept.findIndex(o => o.pick);
  if (first >= 0) return plain.map((o, i) => i === first ? {...o, pick: true as const} : o);
  const kind = marked?.condition ?? (kept.some(o => o.condition === "new") ? "new" : kept[0].condition);
  const same = plain.filter(o => o.condition === kind), exact = same.filter(isExact);
  if (!same.length) return plain;
  const best = (exact.length ? exact : same).reduce((a, o) => totalOf(o) < totalOf(a) ? o : a);
  return plain.map(o => o === best ? {...o, pick: true as const} : o);
}

/** The offer he went by on a card, if any. */
export const pickOf = (r: Research | null | undefined) => r?.offers.find(o => o.pick) ?? null;
/** Whether the page shows that exact one at that price: not a starting price, and every size he named shown with it. */
export const isExact = (o: Offer) => !o.from && !o.unshown?.length;
/** What a page doesn't show with its price, in a sentence. */
export const unshownLine = (o: Offer) => o.unshown?.length ? `The page doesn't show ${listed(o.unshown)} at this price, so that spec may cost more.` : null;

// Subscriptions and plans are what the web rules are for, not this: there's no shop's page to open for what Netflix charges
const SUBSCRIPTIONS = /\b(?:subscriptions?|netflix|spotify|disney|plans?|a month|per month|monthly|a year|broadband|insurance|contract|tariff)\b/i;
/** Whether a question that searched carries on a purchase already being looked at: "And an Xbox?". */
export const notSubscription = (question: string) => !SUBSCRIPTIONS.test(question);

// "can I afford a new iPhone", "is it worth getting a TV", "how much would a gaming PC cost": a question for the shops. One
// with its own figure in it, or about money you have, spend or owe, or a subscription, isn't
const SHOPS = /\b(?:afford|buy|buying|purchase|get(?:ting)? (?:a|an|the|some|one|new)|worth (?:it|getting|buying)|how much (?:is|are|does|do|would|will) (?:a|an|the|one|it)|cost|price of)\b/i;
const NOT_SHOPS = /£|\d\s?(?:quid|pounds?)\b|\b(?:left|spend|spent|spending|due|owe|bills?|rent|payday|budgets?|takeaways?|lunch|dinner|coffee|groceries|drinks?)\b/i;
/** Whether a question looks like it's about buying something: what the line where his answer will go says first, and whether a
 *  price has to come through check_purchase. */
export const pricesLikely = (question: string) => SHOPS.test(question) && !NOT_SHOPS.test(question) && notSubscription(question);

/** What it costs to have: the price, and delivery when the page gives one. */
export const totalOf = (o: Offer) => r2(o.price + (typeof o.delivery === "number" ? o.delivery : 0));

export interface OfferRow { seller: string; meta: string; price: string; url: string; host: string; pick: boolean; label: string }
/** The card as shown. `best`: the price he went by (none when no offer of that kind was backed). `ifToday`: what buying it today
 *  would do, in the engine's own words, as Today's "What if I spend…" says them. `limited`: only one shop's page backed a price. */
export interface ResearchView {
  product: string; note?: string; best: {label: string; price: string; by: string; spec?: string} | null;
  rows: OfferRow[]; ifLabel: string; ifToday: string | null; checked: string; limited?: string;
}

const CONDITION: Record<Condition, string> = {new: "New", refurbished: "Refurbished", used: "Used"};
const deliveryOf = (o: Offer) => o.delivery === "free" ? "Free delivery" : o.delivery !== undefined ? `${moneyExact(o.delivery)} delivery` : null;

// when the prices were read: "09:12" today, "yesterday 18:40", else the day
function whenOf(iso: string, now: Date): string {
  const d = new Date(iso), day = isoD(d), today = isoD(now);
  return day === today ? nowHM(d) : day === addDays(today, -1) ? `yesterday ${nowHM(d)}` : `${niceDate(day)}, ${nowHM(d)}`;
}

/** The card, worked out once as it's shown (so what it says about today is what his answer said at the time). */
export function researchView(ctx: Ctx, r: Research, now: Date): ResearchView {
  const pick = pickOf(r);
  const cheapest = (os: Offer[]) => Math.min(...os.map(totalOf));
  const label = !pick ? "" : totalOf(pick) <= cheapest(r.offers) ? "Best price"
    : pick.condition === "new" && totalOf(pick) <= cheapest(r.offers.filter(o => o.condition === "new")) ? "Best new price" : "Going by";
  // a starting price says so wherever it's shown, as the page does
  const priceOf = (o: Offer) => `${o.from ? "From " : ""}${moneyExact(o.price)}`;
  const rows = [...r.offers].sort((a, b) => Number(!!b.pick) - Number(!!a.pick) || totalOf(a) - totalOf(b)).map(o => {
    const meta = [CONDITION[o.condition], o.from ? "Starting price" : o.unshown?.length ? "Spec not shown at this price" : null, deliveryOf(o)].filter(Boolean).join(" · ");
    const price = priceOf(o);
    return {seller: o.seller, meta, price, url: o.url, host: o.host, pick: !!o.pick, label: `Open ${o.seller}'s listing, ${price}, ${meta}, on ${o.host}`};
  });
  const oldest = r.offers.reduce((a, o) => o.checked < a ? o.checked : a, r.offers[0].checked), spec = pick && unshownLine(pick);
  return {
    product: r.product, ...r.note ? {note: r.note} : {},
    best: pick && {label, price: priceOf(pick), by: [`at ${pick.seller}`, CONDITION[pick.condition], deliveryOf(pick)].filter(Boolean).join(" · "), ...spec ? {spec} : {}},
    rows, ifLabel: pick?.from ? "If you paid the starting price today" : "If you bought it today", ifToday: pick ? whatIf(ctx, totalOf(pick))?.line ?? null : null,
    checked: `Prices as listed, checked ${whenOf(oldest, now)}`,
    ...r.offers.length === 1 ? {limited: "Only one shop's own page could be checked."} : {},
  };
}
