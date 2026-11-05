// The shopping engine (shop.ts) with a fetch that does what each test says: Brave's answers, shops' pages, photos, and every way
// they fail. Real Brave responses for the acceptance questions are in shop_live_test.ts (recorded by shop_probe.ts).
import {braveUrl, candidatesOf, dedupe, type Fetch, fits, gbp, groupOf, nameOf, pageFacts, pricesIn, readShop, robotsAllow, runShop, safeUrl, samePageProduct,
  sanePrices, type ShopAsk, shopOf, type ShopProduct, snippetPrice, spread, termIn, verifyOn} from "./shop.ts";

const eq = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
const ok = (x: unknown, what = "expected true") => { if (!x) throw new Error(what); };
const NOW = new Date("2026-11-05T10:00:00Z");

Deno.test("what the phone sends: 1 to 6 searches, words to match and leave out, a budget; anything else is refused", () => {
  eq(readShop(JSON.stringify({queries: [" iPhone 17  UK ", "iPhone 17 Argos"], match: ["iPhone 17"], exclude: [], max_price: 0})),
    {queries: ["iPhone 17 UK", "iPhone 17 Argos"], match: ["iPhone 17"], exclude: [], maxPrice: 0});
  eq(readShop(JSON.stringify({queries: ["a b"]})), {queries: ["a b"], match: [], exclude: [], maxPrice: 0});
  for (const bad of [{queries: []}, {queries: ["x".repeat(121)]}, {queries: Array(7).fill("tv uk")}, {queries: ["tv"], max_price: -1},
    {queries: ["tv"], match: [5]}, {queries: "tv"}, null]) eq(readShop(JSON.stringify(bad)), {error: "bad_request"});
  eq(readShop("not json"), {error: "bad_request"});
});

Deno.test("a price in a shop's listing is the thing's own: not monthly, a was or RRP, a saving, a delivery charge or a spend threshold", () => {
  eq(pricesIn("Sony WH-1000XM6 £399.00 Was £449.00 Save £50"), [{price: 399, from: false}]);
  eq(pricesIn("£33.25/month for 12 months or £399"), [{price: 399, from: false}]);
  eq(pricesIn("Free delivery on orders over £50. £4.99 delivery. £279.00"), [{price: 279, from: false}]);
  eq(pricesIn("From £799 with trade-in £699"), [{price: 799, from: true}]);
  eq(pricesIn("£299.00 £329.00"), [{price: 299, from: false}]);
  eq(pricesIn("Spend £100 get £10 off"), []);
  // one figure, however often it's said; two different ones and it isn't clear which is this one
  eq(snippetPrice("£279.00 ... now £279.00"), {price: 279, from: false});
  eq(snippetPrice("128GB £799, 256GB £899"), null);
  eq(snippetPrice("Prices from £1,099"), {price: 1099, from: true});
  eq(snippetPrice("No price here"), null);
});

Deno.test("a price in structured data counts only in pounds", () => {
  eq(gbp("399.00", "GBP"), 399);
  eq(gbp(1099.99, "gbp"), 1099.99);
  eq(gbp("£1,299.00"), 1299);
  eq(gbp("399.00", "USD"), null);
  eq(gbp("$399"), null);
  eq(gbp("399.00"), null); // no currency said and no £: it could be anything
  eq(gbp("0", "GBP"), null);
});

Deno.test("shops: the UK shops we know by their site, a global site only by its UK pages, and never a review or a marketplace", () => {
  eq(shopOf("https://www.argos.co.uk/product/9120345")?.name, "Argos");
  eq(shopOf("https://www.apple.com/uk/shop/buy-iphone/iphone-17")?.name, "Apple");
  eq(shopOf("https://www.apple.com/shop/buy-iphone/iphone-17"), null);
  eq(shopOf("https://www.samsung.com/uk/tvs/qled-tv/q7f/")?.name, "Samsung");
  eq(shopOf("https://appleinsider.com/x"), null);
  eq(shopOf("https://www.currys.co.uk/products/x-10290109.html")?.skip, true);
  eq(shopOf("https://www.techradar.com/best/headphones"), null);
});

Deno.test("a product's name from a page's title, without the shop's name or what shops add round it", () => {
  eq(nameOf("Buy Sony WH-1000XM6 Wireless Headphones - Black | Argos", "Argos"), "Sony WH-1000XM6 Wireless Headphones - Black");
  eq(nameOf("Apple iPhone 17 256GB - Black | John Lewis & Partners", "John Lewis"), "Apple iPhone 17 256GB - Black");
  eq(nameOf("Samsung QE65Q7F 65\" QLED 4K Smart TV £599 - Currys", "Currys"), "Samsung QE65Q7F 65\" QLED 4K Smart TV");
});

const brave = (results: object[]) => ({web: {results}});
const tile = (over: Record<string, unknown> = {}) => ({title: "Sony WH-1000XM6 Wireless Noise Cancelling Headphones | Argos", url: "https://www.argos.co.uk/product/9120345",
  description: "Sony WH-1000XM6 headphones. £399.00. Free delivery.", thumbnail: {src: "https://imgs.search.brave.com/sony.jpg", original: "https://media.4rgos.it/sony.jpg"},
  page_fetched: "2026-11-04T08:00:00Z", ...over});

Deno.test("a search result: Brave's structured data first, else one clear price on a shop's product page, else the product with no price", () => {
  const [one] = candidatesOf(tile(), NOW);
  eq([one.name, one.retailer, one.price, one.confidence, one.condition, one.delivery, one.image], ["Sony WH-1000XM6 Wireless Noise Cancelling Headphones", "Argos", 399,
    "search_listed", "new", "free", "https://imgs.search.brave.com/sony.jpg"]);
  // structured offers: in pounds only, the shop's own
  const structured = candidatesOf(tile({description: "Headphones", product: {name: "Sony WH-1000XM6", offers: [{price: "379.00", priceCurrency: "GBP", url: "https://www.argos.co.uk/product/9120345"}, {price: "449", priceCurrency: "USD"}]}}), NOW);
  eq(structured.map(p => [p.name, p.price, p.confidence]), [["Sony WH-1000XM6", 379, "search_listed"]]);
  // a listing page's cluster: each product on it, at its own price
  const cluster = candidatesOf(tile({url: "https://www.argos.co.uk/browse/technology/headphones/c:30230/", title: "Headphones | Argos",
    product_cluster: [{name: "Sony WH-CH720N", offers: [{price: "79.99", priceCurrency: "GBP"}]}, {name: "JBL Tune 770NC", offers: [{price: "69.99", priceCurrency: "GBP"}]}]}), NOW);
  eq(cluster.map(p => [p.name, p.price, p.confidence]), [["Sony WH-CH720N", 79.99, "search_listed"], ["JBL Tune 770NC", 69.99, "search_listed"]]);
  // a listing page with no structured data: its prices can't be tied to one thing
  eq(candidatesOf(tile({url: "https://www.argos.co.uk/browse/technology/headphones/c:30230/", title: "Headphones | Argos"}), NOW), []);
  // a shop's product page with two prices in its snippets: the product, with no price
  const two = candidatesOf(tile({description: "128GB £799, 256GB £899"}), NOW);
  eq([two[0].price, two[0].confidence], [null, null]);
  // a review's "where to buy" is an estimate; an article with nothing structured is nothing
  const review = candidatesOf(tile({url: "https://www.whathifi.com/reviews/sony-wh-1000xm6", title: "Sony WH-1000XM6 review | What Hi-Fi?",
    product: {name: "Sony WH-1000XM6", offers: [{price: "399", priceCurrency: "GBP", url: "https://www.argos.co.uk/product/9120345"}]}}), NOW);
  eq(review.length, 0); // a review page's path is writing about it, never a listing
  const deals = candidatesOf(tile({url: "https://www.smallcamerashop.co.uk/sony-wh-1000xm6", title: "Sony WH-1000XM6",
    product: {name: "Sony WH-1000XM6", offers: [{price: "349", priceCurrency: "GBP"}]}}), NOW);
  eq(deals.map(p => [p.price, p.confidence]), [[349, "estimated"]]);
  // a listing seen over a month ago is an estimate now
  eq(candidatesOf(tile({page_fetched: "2026-09-01T00:00:00Z"}), NOW)[0].confidence, "estimated");
  // out of stock, and refurbished, as the listing says
  eq(candidatesOf(tile({description: "£399.00. Out of stock"}), NOW)[0].inStock, false);
  eq(candidatesOf(tile({title: "Refurbished Sony WH-1000XM6 | Argos"}), NOW)[0].condition, "refurbished");
});

const askFor = (over: Partial<ShopAsk> = {}): ShopAsk => ({queries: ["wireless headphones UK"], match: ["headphones"], exclude: [], maxPrice: 0, ...over});
const item = (name: string, price: number | null = 100, url = "https://www.argos.co.uk/product/1") => ({name, url, price});

Deno.test("what fits: every match word, nothing excluded, no accessory unless asked, no Pro it doesn't name, within the budget", () => {
  ok(fits(item("Sony WH-1000XM6 Wireless Headphones"), askFor()));
  ok(!fits(item("Sony WF-1000XM5 Earbuds"), askFor()));
  ok(!fits(item("Sony WH-1000XM6 Headphones"), askFor({exclude: ["sony"]})));
  ok(!fits(item("Headphones Case for Sony WH-1000XM6"), askFor()));
  ok(fits(item("Hard Case for Sony Headphones"), askFor({queries: ["headphones case"]})));
  ok(fits(item("Apple iPhone 17 256GB Black"), askFor({match: ["iPhone 17"]})));
  ok(!fits(item("Apple iPhone 17 Pro 256GB"), askFor({match: ["iPhone 17"]})));
  ok(fits(item("Samsung QE65Q7F 65\" QLED 4K Ultra HD Smart TV"), askFor({match: ["Samsung", "65", "QLED"]})));
  ok(!fits(item("Samsung QE55Q7F 55\" QLED"), askFor({match: ["Samsung", "65", "QLED"]})));
  ok(!fits(item("Sony WH-1000XM6 Headphones", 399), askFor({maxPrice: 300})));
  ok(fits(item("Sony WH-1000XM6 Headphones", null), askFor({maxPrice: 300})));
  // the model can be in the address when the name leaves it out
  ok(fits(item("Gaming PC", 999, "https://www.scan.co.uk/products/3xs-rtx-5060-gaming-pc"), askFor({match: ["RTX 5060"]})));
});

const product = (over: Partial<ShopProduct> = {}): ShopProduct => ({name: "Sony WH-1000XM6 Headphones - Black", brand: "Sony", model: "WH-1000XM6", group: groupOf("Sony WH-1000XM6 Headphones - Black", "Sony"),
  retailer: "Argos", host: "argos.co.uk", url: "https://www.argos.co.uk/product/1", price: 399, currency: "GBP", confidence: "search_listed", priceSource: "https://www.argos.co.uk/product/1",
  image: null, condition: "new", delivery: null, checked: NOW.toISOString(), ...over});

Deno.test("one of each page, and one of each thing at each shop: the surest price kept; the same thing at two shops is two offers of one group", () => {
  const listed = product(), verified = product({url: "https://www.argos.co.uk/product/1?colour=white", name: "Sony WH-1000XM6 Headphones - White", confidence: "verified", price: 379});
  const john = product({retailer: "John Lewis", host: "johnlewis.com", url: "https://www.johnlewis.com/sony/p1"});
  const kept = dedupe([listed, verified, john, {...john}]);
  eq(kept.map(p => [p.retailer, p.price, p.confidence]), [["Argos", 379, "verified"], ["John Lewis", 399, "search_listed"]]);
  eq(kept[0].group, kept[1].group);
  ok(groupOf("Apple iPhone 17 256GB", "Apple") !== groupOf("Apple iPhone 17 Pro 256GB", "Apple"));
  ok(groupOf("Apple iPhone 17 256GB", "Apple") !== groupOf("Apple iPhone 17 512GB", "Apple"));
});

const ld = (data: unknown) => `<html><head><title>Page</title><script type="application/ld+json">${JSON.stringify(data)}</script></head><body></body></html>`;
const offer = (price: string, extra: object = {}) => ({"@type": "Offer", price, priceCurrency: "GBP", availability: "https://schema.org/InStock", ...extra});

Deno.test("a shop's page: its JSON-LD products and offers (graph, lists, variants, aggregate), else its price meta tags", () => {
  const graph = pageFacts(ld({"@context": "https://schema.org", "@graph": [{"@type": "WebPage"}, {"@type": "Product", name: "Sony WH-1000XM6", image: ["https://media.4rgos.it/s.jpg"], offers: offer("379.00")}]}));
  eq(graph.products.map(p => [p.name, p.offers.map(o => o.price), p.image]), [["Sony WH-1000XM6", [379], "https://media.4rgos.it/s.jpg"]]);
  const agg = pageFacts(ld({"@type": "Product", name: "iPhone 17", offers: {"@type": "AggregateOffer", lowPrice: "799", highPrice: "1199", priceCurrency: "GBP"}}));
  eq(agg.products[0].offers.map(o => [o.price, o.from]), [[799, true]]);
  const group = pageFacts(ld({"@type": "ProductGroup", name: "iPhone 17", hasVariant: [{"@type": "Product", name: "iPhone 17 256GB", offers: offer("799")}, {"@type": "Product", name: "iPhone 17 512GB", offers: offer("999")}]}));
  eq(group.products[0].offers.map(o => [o.name, o.price]), [["iPhone 17 256GB", 799], ["iPhone 17 512GB", 999]]);
  const meta = pageFacts(`<head><meta property="og:title" content="Bose QuietComfort Ultra Headphones"><meta property="product:price:amount" content="449.95"><meta property="product:price:currency" content="GBP"></head>`);
  eq(meta.products.map(p => [p.name, p.offers[0].price]), [["Bose QuietComfort Ultra Headphones", 449.95]]);
  // a broken block doesn't lose the next one
  const broken = pageFacts(`<script type="application/ld+json">{oops</script>${ld({"@type": "Product", name: "X 1", offers: offer("10")})}`);
  eq(broken.products.map(p => p.name), ["X 1"]);
  eq(pageFacts("<html>nothing</html>").products, []);
});

Deno.test("the page's own product must be the one found: its codes and numbers, no Pro it doesn't have, no other size", () => {
  ok(samePageProduct("Sony WH-1000XM6 Headphones - Black", "Sony WH-1000XM6 Wireless Noise Cancelling Headphones"));
  ok(!samePageProduct("Sony WH-1000XM6 Headphones", "Sony WH-1000XM5 Headphones"));
  ok(!samePageProduct("Apple iPhone 17 256GB", "Apple iPhone 17 Pro 256GB"));
  ok(!samePageProduct("Apple iPhone 17 256GB", "Apple iPhone 17 512GB"));
  ok(samePageProduct("Apple iPhone 17 256GB", "iPhone 17"));
  ok(samePageProduct("Bose QuietComfort Ultra Headphones", "Bose QuietComfort Ultra Wireless Headphones"));
});

Deno.test("read on its page: the page's price now wins and is verified; the exact size's offer, else the lowest as a starting price; stock and delivery as it says", () => {
  const c = product({name: "Apple iPhone 17 256GB", group: groupOf("Apple iPhone 17 256GB", "Apple"), price: 829});
  const page = ld({"@type": "ProductGroup", name: "iPhone 17", hasVariant: [{"@type": "Product", name: "iPhone 17 256GB", offers: offer("799", {shippingDetails: {shippingRate: {value: 0, currency: "GBP"}}})},
    {"@type": "Product", name: "iPhone 17 512GB", offers: offer("999")}]});
  const got = verifyOn(c, page, NOW);
  eq([got.outcome, got.product.price, got.product.confidence, got.product.from, got.product.delivery, got.product.checked], ["ok", 799, "verified", undefined, "free", NOW.toISOString()]);
  const plain = verifyOn(product({name: "Apple iPhone 17"}), page, NOW);
  eq([plain.product.price, plain.product.from], [799, true]);
  const gone = verifyOn(product(), ld({"@type": "Product", name: "Sony WH-1000XM6", offers: offer("379", {availability: "https://schema.org/OutOfStock"})}), NOW);
  eq([gone.product.price, gone.product.inStock], [379, false]);
  // another model's page, or no price on it: search's price stands, as listed
  const other = verifyOn(product(), ld({"@type": "Product", name: "Sony WH-1000XM5", offers: offer("249")}), NOW);
  eq([other.outcome, other.product.price, other.product.confidence], ["noPrice", 399, "search_listed"]);
});

Deno.test("robots.txt: its * group's longest matching rule wins", () => {
  const txt = "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /search\nDisallow: /basket\nAllow: /search/help\n";
  ok(robotsAllow(txt, "/product/123"));
  ok(!robotsAllow(txt, "/search?q=tv"));
  ok(robotsAllow(txt, "/search/help"));
  ok(!robotsAllow("User-agent: *\nDisallow: /", "/product/1"));
  ok(robotsAllow("User-agent: *\nDisallow:", "/product/1"));
  ok(!robotsAllow("User-agent: *\nDisallow: /*.json$", "/data.json"));
  ok(robotsAllow("", "/anything"));
});

Deno.test("found in the first live run (5 Nov): a delivery charge isn't a price, 17e isn't 17, entities read, search pages and comparison sites aren't products", () => {
  eq(snippetPrice("Apple iPhone 17 512GB. £2.95 standard delivery. Free click and collect."), null);
  eq(snippetPrice("2026 Apple MacBook Air. Free Delivery on orders over £50. Free on orders over £40, £2.95 if you spend less. Choose a colour"), null);
  eq(snippetPrice("Sony WH-1000XM6 headphones. £399.00. Free delivery."), {price: 399, from: false});
  eq(candidatesOf(tile({title: "GRADE A1 - Samsung QE65Q7F 65\" QLED | Appliances Direct", url: "https://www.appliancesdirect.co.uk/p/a1-qe65q7f/"}), NOW)[0].condition, "refurbished");
  eq(candidatesOf(tile({url: "https://www.compareaprice.co.uk/sony-wh-1000xm6", product: {name: "Sony WH-1000XM6", offers: [{price: "249.99", priceCurrency: "GBP"}]}}), NOW), []);
  eq(snippetPrice("£899.00 £3.95 next day delivery"), {price: 899, from: false});
  eq(snippetPrice("£279 free delivery"), {price: 279, from: false});
  ok(termIn("iPhone 17", "Apple iPhone 17 256GB Black"));
  ok(!termIn("iPhone 17", "Apple iPhone 17e 128GB"));
  ok(termIn("65", "Samsung QE65Q7F 65\" QLED"));
  ok(termIn("RTX 5060", "CyberPowerPC RTX5060 Gaming PC"));
  ok(!fits(item("Apple iPhone 17e 256GB"), askFor({match: ["iPhone 17"]})));
  const [frame] = candidatesOf(tile({title: "SAMSUNG Q7F 65&quot; QLED &amp; 4K TV - Currys", url: "https://www.currys.co.uk/products/samsung-q7f-10282636.html", description: "£549.97"}), NOW);
  eq(frame.name, "SAMSUNG Q7F 65\" QLED & 4K TV");
  eq(frame.evidence, "£549.97");
  eq(candidatesOf(tile({url: "https://www.argos.co.uk/sd/wireless-bluetooth-headphones/", title: "Wireless Bluetooth Headphones | Argos"}), NOW), []);
  eq(candidatesOf(tile({url: "https://www.smartphonechecker.co.uk/phones/apple/iphone-17/256gb", product: {name: "Apple iPhone 17 256GB", offers: [{price: "29.99", priceCurrency: "GBP"}]}}), NOW), []);
});

Deno.test("a listed price far under what the same thing costs elsewhere is dropped, never a shop page's; and no shop takes more than 4 of the 12", () => {
  const at = (retailer: string, price: number, confidence: ShopProduct["confidence"] = "search_listed") =>
    product({retailer, host: `${retailer}.co.uk`, url: `https://${retailer}.co.uk/p`, price, confidence, name: "Apple iPhone 17 512GB", group: "apple|17|512gb"});
  const checked = sanePrices([at("argos", 999), at("currys", 1099), at("johnlewis", 2.95), at("apple", 1099, "verified")]);
  eq(checked.map(p => [p.retailer, p.price, p.confidence]), [["argos", 999, "search_listed"], ["currys", 1099, "search_listed"], ["johnlewis", null, null], ["apple", 1099, "verified"]]);
  eq(sanePrices([at("argos", 2.95)])[0].price, 2.95); // nothing to compare with: left as it is
  const many = [...Array(8)].map((_, i) => at("currys", 500 + i)).concat([at("argos", 700), at("tesco", 710)]);
  eq(spread(many, 6).map(p => p.retailer), ["currys", "currys", "currys", "currys", "argos", "tesco"]);
  eq(spread(many).length, 10); // room left over: the rest come back after
});

Deno.test("only public https addresses are fetched", () => {
  ok(safeUrl("https://www.argos.co.uk/product/1"));
  for (const bad of ["http://www.argos.co.uk/", "https://localhost/x", "https://10.0.0.1/x", "https://[::1]/x", "https://user:pw@argos.co.uk/", "https://argos.co.uk:8443/", "https://intranet/x", "ftp://x.co.uk/"]) ok(!safeUrl(bad), bad);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The whole call, with a fetch that answers as each test needs
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function net(routes: [RegExp | string, Handler][]) {
  const calls: string[] = [];
  const f: Fetch = async (url, init) => {
    calls.push(url);
    for (const [at, h] of routes) if (typeof at === "string" ? url.startsWith(at) : at.test(url)) return await h(url, init);
    return new Response("not found", {status: 404});
  };
  return {f, calls, count: (at: RegExp) => calls.filter(u => at.test(u)).length};
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json", ...headers}});
const html = (body: string, status = 200) => new Response(body, {status, headers: {"content-type": "text/html"}});
const BRAVE = /api\.search\.brave\.com\/res\/v1\/web\/search/, IMAGES = /api\.search\.brave\.com\/res\/v1\/images\/search/;
const hang = (_: string, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError"))));

// five headphones at five shops, as a search for them finds them
const SHOPS5 = [
  ["Sony WH-1000XM6 Wireless Headphones | Argos", "https://www.argos.co.uk/product/9120345", "£399.00"],
  ["Bose QuietComfort Ultra Headphones | John Lewis & Partners", "https://www.johnlewis.com/bose-qc-ultra/p111", "£449.95"],
  ["Sony WH-CH720N Wireless Headphones - Very", "https://www.very.co.uk/sony-wh-ch720n/1600123.prd", "£79.99"],
  ["JBL Tune 770NC Wireless Headphones | AO", "https://ao.com/product/jbltune770nc-jbl-headphones", "£69.99"],
  ["Sennheiser Momentum 4 Wireless Headphones - Richer Sounds", "https://www.richersounds.com/sennheiser-momentum-4.html", "£249.00"],
] as const;
const results5 = SHOPS5.map(([title, url, price]) => ({title, url, description: `${title.split(/ [|-] /)[0]}. ${price}. Free delivery.`, thumbnail: {src: `https://imgs.search.brave.com/${url.length}.jpg`}, page_fetched: "2026-11-04T08:00:00Z"}));
const allowAll: [RegExp, Handler] = [/robots\.txt$/, () => new Response("User-agent: *\nDisallow: /basket", {status: 200})];

Deno.test("five things that fit come back at once, each with the shop, its price as listed and a photo; no more searches needed", async () => {
  const n = net([[BRAVE, () => json(brave(results5))], allowAll, [/argos|johnlewis|very|ao\.com|richersounds/, () => html("<html>no structured data</html>")]]);
  const r = await runShop(askFor({queries: ["wireless headphones UK", "noise cancelling headphones UK"]}), {fetch: n.f, key: "k", now: () => NOW});
  if ("error" in r) throw new Error(r.error);
  eq(r.products.length, 5);
  eq(r.partial, undefined);
  ok(r.products.every(p => p.confidence === "search_listed" && p.price !== null && p.image?.startsWith("https://imgs.search.brave.com/")));
  eq(r.stats.fallback, 0);
  eq(r.stats.brave, 2);
  eq(r.stats.pages.noPrice, 5);
  // the same five from both searches are five, not ten
  eq(new Set(r.products.map(p => p.url)).size, 5);
});

Deno.test("a page that reads: its price now, verified, wins over search's; one that fails (500 twice, a timeout, a 403) keeps search's, labelled as listed", async () => {
  const n = net([[BRAVE, () => json(brave(results5))], allowAll,
    [/argos\.co\.uk\/product/, () => html(ld({"@type": "Product", name: "Sony WH-1000XM6", offers: offer("379.00")}))],
    [/johnlewis/, () => html("busy", 500)],
    [/very\.co\.uk/, hang],
    [/ao\.com\/product/, () => html("Access denied", 403)],
    [/richersounds/, () => { throw new TypeError("connection reset"); }]]);
  const r = await runShop(askFor(), {fetch: n.f, key: "k", now: () => NOW, budgetMs: 12_000});
  if ("error" in r) throw new Error(r.error);
  const by = (shop: string) => r.products.find(p => p.retailer === shop)!;
  eq([by("Argos").price, by("Argos").confidence, by("Argos").priceSource], [379, "verified", "https://www.argos.co.uk/product/9120345"]);
  eq([by("John Lewis").price, by("John Lewis").confidence], [449.95, "search_listed"]);
  eq([by("Very").price, by("Very").confidence], [79.99, "search_listed"]);
  eq([by("AO").price, by("AO").confidence], [69.99, "search_listed"]);
  eq(by("Richer Sounds").confidence, "search_listed");
  eq(r.products.length, 5);
  // a 500 is worth a second try, a 403 isn't
  eq(n.count(/johnlewis\.com\/bose/), 2);
  eq(n.count(/ao\.com\/product/), 1);
  eq([r.stats.pages.ok, r.stats.pages.error, r.stats.pages.timeout, r.stats.pages.blocked], [1, 2, 1, 1]);
  eq(r.stats.verified, 1);
});

Deno.test("fewer than five that fit: more searches, the shops' own listings for the match words, and what they add is kept", async () => {
  const first = brave(results5.slice(0, 2)), more = brave(results5.slice(2));
  const n = net([[BRAVE, url => json(/site%3A/.test(url) || /buy%20UK/.test(url) ? more : first)], allowAll, [/./, () => html("<html></html>")]]);
  const r = await runShop(askFor({queries: ["wireless headphones UK"]}), {fetch: n.f, key: "k", now: () => NOW});
  if ("error" in r) throw new Error(r.error);
  ok(r.stats.fallback > 0, "searched again");
  ok(n.calls.some(u => u.includes(encodeURIComponent("headphones site:argos.co.uk"))), "a shop's own listing");
  eq(r.products.length, 5);
  ok(r.stats.brave <= 8);
});

Deno.test("nothing comes back from any search: more searches, then an honest empty answer, never a made-up product", async () => {
  const n = net([[BRAVE, () => json(brave([]))]]);
  const r = await runShop(askFor(), {fetch: n.f, key: "k", now: () => NOW});
  if ("error" in r) throw new Error(r.error);
  eq(r.products, []);
  eq(r.partial, "Nothing came back that fits.");
  ok(r.stats.fallback > 0);
});

Deno.test("only three exist: those three, and it says so", async () => {
  const n = net([[BRAVE, () => json(brave(results5.slice(0, 3)))], allowAll, [/./, () => html("")]]);
  const r = await runShop(askFor(), {fetch: n.f, key: "k", now: () => NOW});
  if ("error" in r) throw new Error(r.error);
  eq(r.products.length, 3);
  eq(r.partial, "Only 3 products came back that fit.");
});

Deno.test("every search fails: unavailable, and nothing invented", async () => {
  const n = net([[BRAVE, () => json({error: "down"}, 503)]]);
  const r = await runShop(askFor({queries: ["a", "b"]}), {fetch: n.f, key: "k", now: () => NOW});
  eq("error" in r && r.error, "unavailable");
  // each tried twice (a 503 is worth one more go), no more
  eq(n.count(BRAVE), 4);
  const offline = await runShop(askFor(), {fetch: () => Promise.reject(new TypeError("offline")), key: "k", now: () => NOW});
  eq("error" in offline && offline.error, "unavailable");
});

Deno.test("Brave says slow down: one more go after the wait it gives; a 401 isn't tried again", async () => {
  let tries = 0;
  const n = net([[BRAVE, () => ++tries === 1 ? json({}, 429, {"retry-after": "1"}) : json(brave(results5))], allowAll, [/./, () => html("")]]);
  const r = await runShop(askFor(), {fetch: n.f, key: "k", now: () => NOW});
  if ("error" in r) throw new Error(r.error);
  eq(r.products.length, 5);
  const bad = net([[BRAVE, () => json({}, 401)]]);
  const r2 = await runShop(askFor(), {fetch: bad.f, key: "k", now: () => NOW});
  eq("error" in r2 && r2.error, "unavailable");
  eq(bad.count(BRAVE), 1); // refused: not tried again, and no more searches after every one failed
  eq((await runShop(askFor(), {fetch: bad.f, key: "", now: () => NOW}) as {error: string}).error, "not_configured");
});

Deno.test("no photo with a product: Brave's image search by its name; none there either, and the product stays, with no photo", async () => {
  const noPics = results5.map(({thumbnail: _t, ...r}) => r);
  let asked = 0;
  const n = net([[BRAVE, () => json(brave(noPics))], [IMAGES, () => ++asked === 1 ? json({results: [{title: "Sony WH-1000XM6", thumbnail: {src: "https://imgs.search.brave.com/found.jpg"}}]}) : json({results: []})],
    allowAll, [/./, () => html("")]]);
  const r = await runShop(askFor(), {fetch: n.f, key: "k", now: () => NOW});
  if ("error" in r) throw new Error(r.error);
  eq(r.products.length, 5);
  eq(r.products.filter(p => p.image === "https://imgs.search.brave.com/found.jpg").length, 1);
  eq(r.products.filter(p => p.image === null).length, 4);
  eq(n.count(IMAGES), 3); // a few image searches a call, no more
});

Deno.test("a photo from a shop's page is checked before it's used; one that doesn't load isn't", async () => {
  const one = [{...results5[0], thumbnail: undefined}];
  const page = ld({"@type": "Product", name: "Sony WH-1000XM6", image: "https://media.4rgos.it/i/sony.jpg", offers: offer("379")});
  const n = net([[BRAVE, () => json(brave(one))], allowAll, [/media\.4rgos\.it/, () => new Response("", {status: 200, headers: {"content-type": "image/jpeg"}})],
    [/argos\.co\.uk\/product/, () => html(page)], [IMAGES, () => json({results: []})]]);
  const r = await runShop(askFor(), {fetch: n.f, key: "k", now: () => NOW});
  if ("error" in r) throw new Error(r.error);
  eq([r.products[0].confidence, r.products[0].image], ["verified", "https://media.4rgos.it/i/sony.jpg"]);
  const dead = net([[BRAVE, () => json(brave(one))], allowAll, [/media\.4rgos\.it/, () => new Response("", {status: 404})],
    [/argos\.co\.uk\/product/, () => html(page)], [IMAGES, () => json({results: []})]]);
  const r2 = await runShop(askFor(), {fetch: dead.f, key: "k", now: () => NOW});
  if ("error" in r2) throw new Error(r2.error);
  eq(r2.products[0].image, null);
});

Deno.test("a product with no price anywhere is still a product, after the priced ones, and never given one", async () => {
  const noPrice = results5.map((r, i) => i === 0 ? {...r, description: "Sony WH-1000XM6 wireless headphones."} : r);
  const n = net([[BRAVE, () => json(brave(noPrice))], allowAll, [/./, () => html("")]]);
  const r = await runShop(askFor(), {fetch: n.f, key: "k", now: () => NOW});
  if ("error" in r) throw new Error(r.error);
  const sony = r.products.find(p => p.retailer === "Argos")!;
  eq([sony.price, sony.confidence, sony.priceSource], [null, null, null]);
  eq(r.products[r.products.length - 1].retailer, "Argos");
  eq(r.stats.noPrice, 1);
});

Deno.test("robots.txt says no: the page isn't read, and search's price stands; a shop known to refuse isn't tried at all", async () => {
  const currys = {...results5[0], url: "https://www.currys.co.uk/products/sony-wh-1000xm6-10291234.html", title: "SONY WH-1000XM6 Headphones - Currys"};
  const n = net([[BRAVE, () => json(brave([results5[0], currys]))], [/argos\.co\.uk\/robots\.txt/, () => new Response("User-agent: *\nDisallow: /product/")],
    [/./, () => html("")]]);
  const r = await runShop(askFor(), {fetch: n.f, key: "k", now: () => NOW, robots: new Map()});
  if ("error" in r) throw new Error(r.error);
  eq(n.count(/^https:\/\/www\.argos\.co\.uk\/product/), 0);
  eq(n.count(/^https:\/\/www\.currys\.co\.uk/), 0);
  eq([r.stats.pages.robots, r.stats.pages.skipped], [1, 1]);
  ok(r.products.every(p => p.confidence === "search_listed"));
});

Deno.test("a page that redirects to another site isn't followed", async () => {
  const n = net([[BRAVE, () => json(brave([results5[0]]))], allowAll,
    [/argos\.co\.uk\/product/, () => new Response(null, {status: 302, headers: {location: "https://evil.example.com/steal"}})]]);
  const r = await runShop(askFor(), {fetch: n.f, key: "k", now: () => NOW, robots: new Map()});
  if ("error" in r) throw new Error(r.error);
  eq(n.count(/evil/), 0);
  eq(r.stats.pages.blocked, 1);
  eq(r.products[0].confidence, "search_listed");
});

Deno.test("slow shops can't hold it up: the call ends on time with what it has", async () => {
  const n = net([[BRAVE, () => json(brave(results5))], [/robots\.txt$/, hang], [/./, hang]]);
  const started = Date.now();
  const r = await runShop(askFor(), {fetch: n.f, key: "k", now: () => NOW, budgetMs: 4_000, robots: new Map()});
  if ("error" in r) throw new Error(r.error);
  ok(Date.now() - started < 7_000, `took ${Date.now() - started}ms`);
  eq(r.products.length, 5);
  ok(r.products.every(p => p.confidence === "search_listed"));
});

Deno.test("the search Brave is asked for: UK results in English, with extra snippets and no markup", () => {
  const u = new URL(braveUrl("iPhone 17 UK"));
  eq([u.searchParams.get("q"), u.searchParams.get("country"), u.searchParams.get("search_lang"), u.searchParams.get("extra_snippets"), u.searchParams.get("text_decorations")],
    ["iPhone 17 UK", "GB", "en", "true", "false"]);
});
