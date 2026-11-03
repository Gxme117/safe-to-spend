import type Anthropic from "@anthropic-ai/sdk";
import {whatIf} from "../../today";
import {baseState, ctx as makeCtx} from "../../__tests__/fixtures";
import {checkOffers, notPassed, notSubscription, ownSite, pagesIn, photoOn, photoQuery, pickOf, pricesLikely, researchView, totalOf, type Offer, type OfferClaim, type Page, type Pages, type PurchaseClaim, type Research} from "../research";

type Message = Anthropic.Beta.Messages.BetaMessageParam;
const NOW = new Date(2026, 9, 5, 9, 12), READ = new Date(2026, 9, 5, 9, 10).toISOString();
const APPLE = "https://www.apple.com/uk/shop/buy-iphone/iphone-17", SCAN = "https://www.scan.co.uk/products/scan-gamer-rtx-5060-16gb-1tb";
const ARGOS = "https://www.argos.co.uk/product/iphone-17-256gb", BM = "https://www.backmarket.co.uk/en-gb/p/iphone-17-256gb";

// as the pages really read, through a fetch
const APPLE_TEXT = "Buy iPhone 17. From £899 or £37.45 per month for 24 months. Storage: 256GB Footnote 1 Mist Blue £899.00 512GB Footnote 1 White £1,099.00 Free delivery. Trade in and save.";
const SCAN_TEXT = "Scan Gamer RTX gaming PC. Ryzen 5 5500, RTX5060, 16GB DDR4, 1TB. RRP: £1,049.99£999.98 Free delivery on this item. Stock arrives 1-2 days from time of order.";
// shops' listings, cut from the pages the live run opened on 2 Nov 2026
const ARGOS_TV = "https://www.argos.co.uk/sd/tv-55-inch", GLADIATOR = "https://www.gladiatorpc.co.uk/rtx-5060";
const ARNOLD = "https://www.arnoldclark.com/new-cars/bmw", MARSHALL = "https://www.marshall.co.uk/bmw/new-cars";
const ARGOS_TV_TEXT = "Price £10 - £15 (1) £15 - £20 (1) £20 - £25 (2) £25 - £50 (3) Show more Customer Rating Show All 5 only Clear all View 72 items 72 products Add to wishlist Bush 55 Inch 55USF26 Smart 4K UHD HDR Freely Fire TV Rating 4.6 out of 5, from 126 reviews ( 126 ) Product information sheet £279.00 Buy now, pay in 12 months or from £11.20 per month* Add to trolley Add to wishlist Add to wishlist TCL 55 Inch 55P6L-UK Smart 4K UHD HDR Google TV Rating 4.8 out of 5, from 17 reviews ( 17 ) Product information sheet Save £30.00 £299.00 £329.00 Buy now, pay in 12 months or from £12.00 per month* Add to trolley Add to wishlist Add to wishlist Samsung 58 Inch UE58U8000HKXXU Smart 4K UHD HDR Crystal TV Rating 4.2 out of 5, from 97 reviews ( 97 ) Product information sheet Lowest Price Ever £329.00 Buy now, pay in 12 months or from £13.21 per month* Add to trolley";
const GLADIATOR_TEXT = "[STEALTH NEXT DAY PC - Gladiator PC](https://www.gladiatorpc.co.uk/configure/config/74864)\n\n![STEALTH NEXT DAY PC - System Badge 1](https://www.gladiatorpc.co.uk/assets/img/configurator/74864Badge1.webp)\n\n### £1,399.99\n\nFree UK Shipping  \n4 Years Warranty as Standard\n\n| Processor:        | AMD Ryzen 5 7500F       |\n|-------------------|-------------------------|\n| Memory:           | 16GB DDR5               |\n| Graphics:         | GeForce RTX 5060 Ti 8GB |\n| Storage:          | 1TB M.2 NVMe SSD        |\n\n[Buy PC Now](https://www.gladiatorpc.co.uk/checkout/buynow/74864)";
const ARNOLD_TEXT = "[BMW 1 Series](https://www.arnoldclark.com/new-cars/bmw/1-series)\n\nFrom£32,295\n\n£399Per month View this car's full finance example\n\nOr\n\n[View offers]";
const MARSHALL_TEXT = "### [BMW 1 Series Range](https://www.marshall.co.uk/bmw/new-car-range/1-series/ \"BMW 1 Series Range\")\n\n[From £32,640](https://www.marshall.co.uk/bmw/new-car-range/1-series/ \"BMW 1 Series Range\")";

const page = (url: string, text: string, title = "iPhone 17", read = READ, host = /^https:\/\/(?:www\.)?([^/]+)/.exec(url)![1]): Page => ({url, host, title, text, read});
const pages = (...ps: Page[]): Pages => ({open: new Map(ps.map(p => [p.url.replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/+$/, "").toLowerCase(), p])), waiting: new Set()});
const offer = (over: Partial<OfferClaim> = {}): OfferClaim => ({seller: "Apple", url: APPLE, price: 899, condition: "new", delivery: null, pick: true, ...over});
const claim = (over: Partial<PurchaseClaim> = {}): PurchaseClaim => ({product: "iPhone 17, 256GB", assumed: "Apple's newest standard model", identifies: ["iPhone 17", "256GB"], offers: [offer()], ...over});
const checked = (c: PurchaseClaim, ps: Pages) => checkOffers(c, ps, NOW);
// the reason one offer's turned away, or "kept"
const why = (o: Partial<OfferClaim>, text: string, over: Partial<PurchaseClaim> = {}, title?: string, url = o.url ?? APPLE) => {
  const r = checked(claim({offers: [offer({url, ...o})], ...over}), pages(page(url, text, title)));
  return r.research ? "kept" : r.rejected[0].why;
};

describe("the pages he opened", () => {
  const turn = (...content: object[]) => ({role: "assistant", content} as unknown as Message);
  const asks = (id: string, url: string) => ({type: "server_tool_use", id, name: "web_fetch", input: {url}});
  const opened = (id: string, url: string, data: string, retrieved_at: string | null = READ) => ({type: "web_fetch_tool_result", tool_use_id: id,
    content: {type: "web_fetch_result", url, retrieved_at, content: {type: "document", title: "iPhone 17", source: {type: "text", media_type: "text/plain", data}}}});

  test("each by the address it came back with and the one he asked for, when a page moved him on", () => {
    const {open, waiting} = pagesIn([turn(asks("s1", "https://apple.com/iphone"), opened("s1", APPLE, APPLE_TEXT))]);
    expect(open.get("apple.com/iphone")).toMatchObject({url: APPLE, host: "apple.com", text: APPLE_TEXT, title: "iPhone 17", read: READ});
    expect(open.get("apple.com/uk/shop/buy-iphone/iphone-17")?.url).toBe(APPLE);
    expect(waiting.size).toBe(0);
  });

  test("one that didn't open, a PDF, or a bad address isn't a page; one still waiting is said to be", () => {
    const {open, waiting} = pagesIn([
      turn(asks("s1", ARGOS), {type: "web_fetch_tool_result", tool_use_id: "s1", content: {type: "web_fetch_tool_result_error", error_code: "url_not_accessible"}}),
      turn({type: "web_fetch_tool_result", tool_use_id: "s2", content: {type: "web_fetch_result", url: BM, retrieved_at: READ, content: {type: "document", source: {type: "base64", media_type: "application/pdf", data: "JVB"}}}}),
      turn(opened("s3", "javascript:alert(1)", "£899.00")),
      turn(asks("s4", SCAN)),
    ]);
    expect(open.size).toBe(0);
    expect([...waiting]).toEqual(["scan.co.uk/products/scan-gamer-rtx-5060-16gb-1tb"]);
  });

  test("a page asked for beside a tool opens on the next request: it's found there, and no longer waiting", () => {
    const {open, waiting} = pagesIn([turn(asks("s1", APPLE)), {role: "user", content: []}, turn(opened("s1", APPLE, APPLE_TEXT))]);
    expect(open.has("apple.com/uk/shop/buy-iphone/iphone-17")).toBe(true);
    expect(waiting.size).toBe(0);
  });

  test("no date on it: he read it just now, as far as anyone can say", () => {
    const {open} = pagesIn([turn(opened("s1", APPLE, APPLE_TEXT, null))]);
    const r = checked(claim(), {open, waiting: new Set()}).research!;
    expect(r.offers[0].checked).toBe(NOW.toISOString());
  });
});

describe("checking a price on its page", () => {
  test("real page text: Apple's price by its storage, Scan's after its RRP", () => {
    const apple = checked(claim(), pages(page(APPLE, APPLE_TEXT, "Buy iPhone 17 - Apple (UK)")));
    expect(apple).toEqual({rejected: [], waiting: false, research: {product: "iPhone 17, 256GB", note: "Apple's newest standard model", offers: [
      {seller: "Apple", condition: "new", price: 899, url: APPLE, title: "Buy iPhone 17 - Apple (UK)", host: "apple.com", checked: READ, pick: true},
    ]}});
    const pc = claim({product: "Scan Gamer, RTX5060, 16GB, 1TB", identifies: ["RTX5060", "16GB", "1TB"], offers: [offer({seller: "Scan", url: SCAN, price: 999.98, delivery: 0})]});
    expect(checked(pc, pages(page(SCAN, SCAN_TEXT, "Scan Gamer RTX"))).research?.offers[0]).toMatchObject({price: 999.98, delivery: "free", host: "scan.co.uk", pick: true});
  });

  test("a price he hasn't opened a page for is turned away; one still opening isn't, it's waited for", () => {
    expect(why({url: APPLE}, APPLE_TEXT)).toBe("kept");
    const none = checked(claim(), pages());
    expect(none).toEqual({research: null, waiting: false, rejected: [{seller: "Apple", price: 899, why: "you haven't opened that page", pick: true}]});
    const waiting = checked(claim(), {open: new Map(), waiting: new Set(["apple.com/uk/shop/buy-iphone/iphone-17"])});
    expect(waiting).toEqual({research: null, rejected: [], waiting: true});
  });

  test("only that price, to the penny: never rounded, by the month, part of a payment, with a trade-in, or what it used to be", () => {
    expect(why({price: 899.01}, APPLE_TEXT)).toBe("the page doesn't show that price");
    expect(why({price: 37.45}, APPLE_TEXT)).toMatch(/isn't the price of the thing/);
    expect(why({price: 900}, APPLE_TEXT)).toBe("the page doesn't show that price");
    const shown = (text: string, price = 799) => why({price}, text, {identifies: ["iPhone 17"], product: "iPhone 17"});
    expect(shown("iPhone 17 £799")).toBe("kept");
    expect(shown("iPhone 17 from £799.00")).toBe("kept");
    for (const text of ["iPhone 17 £799/mo", "iPhone 17 £799 a month", "iPhone 17 £799 per month", "iPhone 17 £799 x 24", "iPhone 17 24 payments of £799", "iPhone 17 was £799 now £699",
      "iPhone 17 RRP: £799", "iPhone 17 Save £799", "iPhone 17 £799 deposit", "iPhone 17 deposit of £799", "iPhone 17 £799 with trade-in", "iPhone 17 £799 after trade in", "iPhone 17 £799 ex VAT", "iPhone 17 £799 off"]) {
      expect([text, shown(text)]).toEqual([text, expect.stringMatching(/isn't the price of the thing/)]);
    }
    // the RRP right before it doesn't count against the price after it
    expect(why({seller: "Scan", url: SCAN, price: 1049.99}, SCAN_TEXT, {product: "RTX5060", identifies: ["RTX5060"]})).toMatch(/isn't the price of the thing/);
    expect(why({seller: "Scan", url: SCAN, price: 999.98}, SCAN_TEXT, {product: "RTX5060", identifies: ["RTX5060"]})).toBe("kept");
    expect(why({price: 0}, APPLE_TEXT)).toBe("no price given");
  });

  test("not when the page says it's gone", () => {
    expect(why({price: 899}, "iPhone 17 256GB £899.00 Out of stock")).toBe("the page says it's out of stock");
    expect(why({price: 899}, "iPhone 17 256GB £899.00 In stock. " + "x".repeat(200) + " Sold out")).toBe("kept");
  });

  test("only that product: its model and size in the page's title or address, or right by the price", () => {
    expect(why({}, "Lots of phones. Galaxy S26. " + "x".repeat(400) + " £899.00", {product: "Galaxy S26", identifies: ["Galaxy S26"]}, "Phones")).toMatch(/doesn't show Galaxy S26 by that price/);
    // no size by a price, and none in the page's name: "From £899" doesn't say which one it's for, so it's kept as a starting
    // price that doesn't show 256GB, never as the 256GB's price (a size after a starting price isn't what it's for)
    const from = checked(claim(), pages(page(APPLE, "iPhone 17 from £899. In 256GB and 512GB.", "iPhone 17"))).research!.offers[0];
    expect([from.from, from.unshown]).toEqual([true, ["256GB"]]);
    // named in the title or address is enough
    expect(why({}, "x".repeat(400) + " £899.00", {identifies: ["iPhone 17"], product: "iPhone 17"}, "Apple iPhone 17 | Shop")).toBe("kept");
    expect(why({url: ARGOS, seller: "Argos"}, "x".repeat(400) + " £899.00", {}, "A phone")).toBe("kept");
    // a menu's mention far from the price isn't a page about it
    expect(why({url: "https://www.apple.com/uk/shop/phones"}, "Menu: iPhone 17 256GB " + "x".repeat(400) + " £899.00", {}, "iPhone 16 | Shop")).toMatch(/doesn't show iPhone 17/);
    // his words have to say which: nothing, and nothing's backed
    expect(why({}, APPLE_TEXT, {identifies: []})).toBe("nothing says which product it is");
    expect(why({}, APPLE_TEXT, {identifies: ["  "]})).toBe("nothing says which product it is");
  });

  test("the price for another size on the same page isn't this one's", () => {
    expect(why({price: 1099}, APPLE_TEXT)).toBe("that price is for the 512GB");
    expect(why({price: 899}, APPLE_TEXT, {product: "iPhone 17, 512GB", identifies: ["iPhone 17", "512GB"]})).toBe("that price is for the 256GB");
    expect(why({price: 1099}, APPLE_TEXT, {product: "iPhone 17, 512GB", identifies: ["iPhone 17", "512GB"]})).toBe("kept");
    // a spec list before one price isn't a list of prices: any size he named among them will do
    expect(why({seller: "Scan", url: SCAN, price: 999.98}, SCAN_TEXT, {product: "Scan Gamer, 16GB", identifies: ["RTX5060"]})).toBe("kept");
  });

  test("a different model by its title is turned away, however good the price; a TV's Ultra HD or Mini LED isn't one", () => {
    expect(why({}, APPLE_TEXT, {}, "Buy iPhone 17 Pro - Apple")).toBe("that page is the Pro, not iPhone 17, 256GB");
    expect(why({}, APPLE_TEXT, {}, "iPhone 17 Pro Max")).toMatch(/that page is the (Pro|Max)/);
    expect(why({}, APPLE_TEXT, {product: "iPhone 17 Pro, 256GB", identifies: ["256GB"]}, "Buy iPhone 17 Pro - Apple")).toBe("kept");
    const tv = {product: "Samsung 55-inch", identifies: ["Samsung"]};
    expect(why({seller: "Argos", url: ARGOS, price: 379}, 'Samsung 55" £379.00', tv, "Samsung 4K Ultra HD Smart TV")).toBe("kept");
    expect(why({seller: "Argos", url: ARGOS, price: 379}, 'Samsung 55" £379.00', tv, "Samsung Mini LED TV")).toBe("kept");
    expect(why({seller: "Argos", url: ARGOS, price: 379}, 'Samsung 55" £379.00', tv, "Samsung Ultra Wide")).toMatch(/that page is the Ultra/);
  });

  test("a screen or storage counts however it's written", () => {
    const shown = (text: string) => why({seller: "Argos", url: ARGOS, price: 379}, text, {product: "Samsung 55-inch TV", identifies: ["Samsung"]}, "A TV");
    for (const text of ['Samsung 55" £379.00', "Samsung 55in £379.00", "Samsung 55 inch £379.00", "Samsung 55-inch £379.00", "Samsung 55 Inches £379.00"]) expect([text, shown(text)]).toEqual([text, "kept"]);
    expect(shown("Samsung 65-inch £379.00")).toBe("that price is for the 65-inch");
    expect(why({}, "iPhone 17 256 GB £899.00")).toBe("kept");
    // a stock count isn't a screen
    expect(why({}, "iPhone 17 256GB 12 in stock £899.00")).toBe("kept");
  });

  test("the shop's own site only: never a blog, or someone else's page, however it's named", () => {
    expect(why({seller: "Amazon UK"}, APPLE_TEXT)).toBe("that page isn't on Amazon UK's own site");
    expect(why({seller: "Box", url: "https://box.co.uk/blog/iphone-17-256gb"}, APPLE_TEXT)).toBe("an article, not a shop page");
    expect(why({seller: "Apple", url: "https://www.apple.com/uk/newsroom/news/iphone-17"}, APPLE_TEXT)).toBe("an article, not a shop page");
    expect(why({seller: "Currys", url: "https://www.currys.co.uk/best-iphones/iphone-17"}, APPLE_TEXT)).toBe("an article, not a shop page");
    for (const [seller, host] of [["John Lewis", "johnlewis.com"], ["CCL Computers", "cclonline.com"], ["CCL", "cclonline.com"], ["AO", "ao.com"], ["AO.com", "ao.com"], ["Amazon UK", "amazon.co.uk"],
      ["Marshall BMW", "marshall.co.uk"], ["Appliances Direct", "appliancesdirect.co.uk"], ["Back Market", "backmarket.co.uk"], ["BT", "shop.bt.com"], ["Sony", "store.sony.co.uk"],
      ["Overclockers UK", "overclockers.co.uk"], ["The Range", "therange.co.uk"], ["Dick Lovett BMW", "dicklovett.co.uk"], ["Motoring Today", "motoring.today"], ["PC Specialist", "pc-specialist.co.uk"]]) {
      expect([seller, host, ownSite(seller, host)]).toEqual([seller, host, true]);
    }
    for (const [seller, host] of [["Apple", "appleinsider.com"], ["Box", "xbox.com"], ["The Range", "thesun.co.uk"], ["Appliances Direct", "laptopsdirect.co.uk"], ["Currys", "argos.co.uk"], ["Direct", "appliancesdirect.co.uk"]]) {
      expect([seller, host, ownSite(seller, host)]).toEqual([seller, host, false]);
    }
  });

  test("a shop's own listing counts: each price goes with its own tile, never a neighbour's (Argos, as it really reads)", () => {
    const tv = (o: Partial<OfferClaim>, over: Partial<PurchaseClaim>) => why({seller: "Argos", url: ARGOS_TV, ...o}, ARGOS_TV_TEXT, over, "55 Inch TVs | Argos");
    expect(tv({price: 279}, {product: "Bush 55 Inch 55USF26 Smart 4K TV", identifies: ["Bush", "55USF26"]})).toBe("kept");
    expect(tv({price: 299}, {product: "TCL 55 Inch 55P6L", identifies: ["TCL", "55P6L"]})).toBe("kept");
    // its was price, straight after what it costs now, isn't a price; the Samsung after it at that price isn't the TCL
    expect(tv({price: 329}, {product: "TCL 55 Inch 55P6L", identifies: ["TCL", "55P6L"]})).toBe("the page doesn't show TCL by that price");
    // the 58-inch doesn't pass as a 55, and another tile's model doesn't vouch for this price
    expect(tv({price: 329}, {product: "Samsung 55-inch Crystal TV", identifies: ["Samsung"]})).toBe("that price is for the 58-inch");
    expect(tv({price: 279}, {product: "TCL 55 Inch 55P6L", identifies: ["TCL", "55P6L"]})).toBe("the page doesn't show TCL by that price");
  });

  test("a listing titled for several models backs the plain one's row; the Pro's own page still can't", () => {
    const list = "- Apple iPhone 16 £799.00\n- Apple iPhone 17 £889.00\n- Apple iPhone 17 Pro £999.00\n- Apple iPhone 17 Pro Max £1,099.00";
    const plain = {product: "iPhone 17", identifies: ["iPhone 17"]};
    expect(why({price: 889}, list, plain, "iPhone 17, 17 Pro and Pro Max deals")).toBe("kept");
    expect(why({price: 999}, list, plain, "iPhone 17, 17 Pro and Pro Max deals")).toBe("that price is for the Pro, not iPhone 17");
    expect(why({price: 999}, "Buy iPhone 17 Pro. iPhone 17 £999.00", plain, "Buy iPhone 17 Pro - Apple")).toBe("that page is the Pro, not iPhone 17");
  });

  test("a spec under the price counts (Gladiator); one it doesn't show is kept but said, never claimed", () => {
    const pc = {product: "Gaming PC, Ryzen 5 7500F, RTX 5060 Ti 8GB, 16GB DDR5, 1TB SSD", identifies: ["Ryzen 5 7500F", "RTX 5060 Ti"]};
    const kept = (product: string) => checked(claim({...pc, product, offers: [offer({seller: "Gladiator PC", url: GLADIATOR, price: 1399.99})]}),
      pages(page(GLADIATOR, GLADIATOR_TEXT, "RTX 5060 and 5060 Ti systems from Gladiator PC"))).research?.offers[0];
    expect(kept(pc.product)).toMatchObject({price: 1399.99, pick: true});
    expect(kept(pc.product)?.unshown).toBeUndefined();
    expect(kept(pc.product)?.from).toBeUndefined();
    expect(kept(`${pc.product}, 2TB`)?.unshown).toEqual(["2TB"]);
  });

  test("a starting price is kept as one: \"From £32,295\" (Arnold Clark, Marshall)", () => {
    const bmw = {product: "BMW 1 Series", identifies: ["BMW 1 Series"]};
    const at = (url: string, seller: string, price: number, text: string, title: string) =>
      checked(claim({...bmw, offers: [offer({seller, url, price})]}), pages(page(url, text, title))).research?.offers[0];
    expect(at(ARNOLD, "Arnold Clark", 32295, ARNOLD_TEXT, "New BMW cars")).toMatchObject({price: 32295, from: true});
    expect(at(MARSHALL, "Marshall BMW", 32640, MARSHALL_TEXT, "Marshall BMW")).toMatchObject({price: 32640, from: true});
    // its finance figure isn't a price
    expect(why({seller: "Arnold Clark", url: ARNOLD, price: 399}, ARNOLD_TEXT, bmw, "New BMW cars")).toMatch(/isn't the price of the thing/);
  });

  test("the price for another size wins over a starting price elsewhere on the page: a 512GB never goes by £899", () => {
    expect(why({price: 899}, APPLE_TEXT, {product: "iPhone 17, 512GB", identifies: ["iPhone 17"]})).toBe("that price is for the 256GB");
    // the exact one is found, wherever on the page it is
    expect(checked(claim(), pages(page(APPLE, APPLE_TEXT))).research?.offers[0].from).toBeUndefined();
  });

  test("a copy of a page gone stale isn't today's price", () => {
    const r = checked(claim(), pages(page(APPLE, APPLE_TEXT, "iPhone 17", new Date(2026, 8, 20).toISOString())));
    expect(r.rejected[0].why).toBe("that copy of the page is too old");
    expect(checked(claim(), pages(page(APPLE, APPLE_TEXT, "iPhone 17", new Date(2026, 9, 1).toISOString()))).research?.offers[0].checked).toBe(new Date(2026, 9, 1).toISOString());
  });

  test("delivery only as the page says it, and it never costs the offer", () => {
    const delivery = (d: number | null, text: string) => checked(claim({offers: [offer({delivery: d})]}), pages(page(APPLE, text))).research!.offers[0].delivery;
    expect(delivery(0, "iPhone 17 256GB £899.00 Free standard delivery")).toBe("free");
    expect(delivery(0, "iPhone 17 256GB £899.00")).toBeUndefined();
    expect(delivery(4.99, "iPhone 17 256GB £899.00. Delivery £4.99")).toBe(4.99);
    expect(delivery(4.99, "iPhone 17 256GB £899.00, or £4.99 for AppleCare")).toBeUndefined();
    expect(delivery(null, "iPhone 17 256GB £899.00 Free delivery")).toBeUndefined();
  });

  test("what it is: as he says, unless the page's name or the words by its price say it's refurbished or second-hand; a menu can't", () => {
    const kind = (c: OfferClaim["condition"], text: string, title = "iPhone 17") => checked(claim({offers: [offer({condition: c})]}), pages(page(APPLE, text, title))).research!.offers[0].condition;
    expect(kind("new", "iPhone 17 256GB £899.00")).toBe("new");
    expect(kind("new", "iPhone 17 256GB £899.00", "Refurbished iPhone 17")).toBe("refurbished");
    expect(kind("new", "iPhone 17 256GB Renewed £899.00")).toBe("refurbished");
    expect(kind("new", "Pre-owned iPhone 17 256GB £899.00")).toBe("used");
    expect(kind("new", "iPhone 17 256GB £899.00", "Used iPhone 17")).toBe("used");
    expect(kind("used", "Refurbished iPhone 17 256GB £899.00")).toBe("used");
    expect(kind("new", `Shop refurbished phones here ${"x".repeat(200)} iPhone 17 256GB £899.00`)).toBe("new");
    // the row above is another phone (a real price list, as a shop's page reads)
    expect(kind("new", "- Apple iPhone 15 Pro Max - Premium Refurbished £699.00\n- Apple iPhone 16 £799.00\n- Apple iPhone 17 256GB £899.00\n- Apple iPhone 17 Pro £999.00")).toBe("new");
  });

  test("the one he went by: the first he marked; turned away, the cheapest of the same kind; of another kind, none", () => {
    const argos = page(ARGOS, "iPhone 17 256GB £879.00", "Apple iPhone 17 256GB | Argos"), bm = page(BM, "Refurbished iPhone 17 256GB £619.00", "iPhone 17 256GB | Back Market");
    const a = offer({seller: "Argos", url: ARGOS, price: 879, pick: false}), m = offer({seller: "Back Market", url: BM, price: 619, condition: "refurbished", pick: false});
    const both = checked(claim({offers: [offer({pick: true}), {...a, pick: true}, m]}), pages(page(APPLE, APPLE_TEXT), argos, bm)).research!;
    expect(both.offers.filter(o => o.pick).map(o => o.seller)).toEqual(["Apple"]);
    // his pick has no page: the cheapest new one that does, never the refurbished one
    const instead = checked(claim({offers: [offer({price: 999}), {...a}, m]}), pages(page(APPLE, APPLE_TEXT), argos, bm));
    expect(pickOf(instead.research)?.seller).toBe("Argos");
    expect(instead.rejected).toEqual([{seller: "Apple", price: 999, why: "the page doesn't show that price", pick: true}]);
    // no new one left: nothing to go by, though what's backed is still shown
    const other = checked(claim({offers: [offer({price: 999}), m]}), pages(page(APPLE, APPLE_TEXT), bm));
    expect(pickOf(other.research)).toBeNull();
    expect(other.research?.offers.map(o => o.seller)).toEqual(["Back Market"]);
    // none marked: the cheapest new
    expect(pickOf(checked(claim({offers: [{...offer(), pick: false}, a]}), pages(page(APPLE, APPLE_TEXT), argos)).research)?.seller).toBe("Argos");
    // turned away, an exact match before a cheaper starting price
    const from = page("https://www.currys.co.uk/iphone-17", "iPhone 17 from £799.00", "iPhone 17 | Currys");
    const c = offer({seller: "Currys", url: from.url, price: 799, pick: false});
    expect(pickOf(checked(claim({offers: [offer({price: 999}), a, c]}), pages(page(APPLE, APPLE_TEXT), argos, from)).research)?.seller).toBe("Argos");
  });

  test("the shops he opened for this question and didn't name, by site", () => {
    const turn = (...content: object[]) => ({role: "assistant", content} as unknown as Message);
    const opened = (id: string, url: string) => ({type: "web_fetch_tool_result", tool_use_id: id,
      content: {type: "web_fetch_result", url, retrieved_at: READ, content: {type: "document", title: "x", source: {type: "text", media_type: "text/plain", data: "£1.00"}}}});
    const ps = pagesIn([turn(opened("s0", SCAN)), {role: "user", content: []}, turn(opened("s1", APPLE), opened("s2", ARGOS), opened("s3", BM), opened("s4", `${BM}-white`))], 1);
    expect(notPassed(claim(), ps)).toEqual(["argos.co.uk", "backmarket.co.uk"]);
    expect(notPassed(claim({offers: [offer(), offer({seller: "Back Market", url: BM})]}), ps)).toEqual(["argos.co.uk"]);
  });

  test("each shop's page once, at most four, and no £ in anything of his that's kept or told back", () => {
    const shops = ["alpha", "bravo", "charlie", "delta", "echo"].map(s => page(`https://${s}.example/iphone-17-256gb`, "iPhone 17 256GB £10.00"));
    const many = checked(claim({offers: shops.map((p, i) => offer({seller: ["alpha", "bravo", "charlie", "delta", "echo"][i], url: p.url, price: 10, pick: false}))}), pages(...shops));
    expect(many.research?.offers).toHaveLength(4);
    const twice = checked(claim({offers: [offer(), offer({pick: false})]}), pages(page(APPLE, APPLE_TEXT)));
    expect(twice.research?.offers).toHaveLength(1);
    const r = checked(claim({product: "iPhone 17 £5, 256GB", assumed: "Was £999", offers: [offer({seller: "Apple £1"}), offer({seller: "Currys £799", url: "https://x.example/iphone-17-256gb"})]}), pages(page(APPLE, APPLE_TEXT)));
    expect(JSON.stringify([r.research?.product, r.research?.note, r.research?.offers.map(o => o.seller), r.rejected.map(x => [x.seller, x.why])])).not.toContain("£");
  });
});

describe("the card as shown", () => {
  const A: Offer = {seller: "Argos", condition: "new", price: 799, delivery: "free", url: ARGOS, title: "Argos", host: "argos.co.uk", checked: new Date(2026, 9, 5, 9, 12).toISOString(), pick: true};
  const B: Offer = {seller: "Apple", condition: "new", price: 799, url: APPLE, title: "Apple", host: "apple.com", checked: A.checked};
  const M: Offer = {seller: "Back Market", condition: "refurbished", price: 619, delivery: 9.99, url: BM, title: "BM", host: "backmarket.co.uk", checked: A.checked};
  const research = (...offers: Offer[]): Research => ({product: "iPhone 17, 128GB", note: "Apple's newest standard model", offers});

  test("the price he went by, the shops in order, and what buying it today does, in the engine's own words", () => {
    const c = makeCtx(), v = researchView(c, research(A, B, M), NOW);
    expect(v.best).toEqual({label: "Best new price", price: "£799.00", by: "at Argos · New · Free delivery"});
    expect(v.rows.map(r => [r.seller, r.meta, r.price, r.pick])).toEqual([
      ["Argos", "New · Free delivery", "£799.00", true],
      ["Back Market", "Refurbished · £9.99 delivery", "£619.00", false],
      ["Apple", "New", "£799.00", false],
    ]);
    expect(v.rows[0]).toMatchObject({url: ARGOS, host: "argos.co.uk", label: "Open Argos's listing, £799.00, New · Free delivery, on argos.co.uk"});
    // the same sentence Today's "What if I spend…" says for it
    expect(v.ifToday).toBe(whatIf(c, 799)!.line);
    expect(v.checked).toBe("Prices as listed, checked 09:12");
    expect(v.limited).toBeUndefined();
  });

  test("a starting price says \"From\" wherever it's shown, and a spec the page doesn't show with it is said under it", () => {
    const c = makeCtx(), v = researchView(c, research({...A, from: true, unshown: ["16GB", "1TB"]}, B), NOW);
    expect(v.best).toEqual({label: "Best price", price: "From £799.00", by: "at Argos · New · Free delivery", spec: "The page doesn't show 16GB or 1TB at this price, so that spec may cost more."});
    expect(v.rows[0]).toMatchObject({price: "From £799.00", meta: "New · Starting price · Free delivery"});
    expect(v.ifLabel).toBe("If you paid the starting price today");
    expect(v.ifToday).toBe(whatIf(c, 799)!.line);
    const unshown = researchView(c, research({...A, unshown: ["256GB"]}), NOW);
    expect([unshown.best?.price, unshown.rows[0].meta, unshown.ifLabel]).toEqual(["£799.00", "New · Spec not shown at this price · Free delivery", "If you bought it today"]);
  });

  test("one shop is shown as one, and says so", () => {
    expect(researchView(makeCtx(), research(A), NOW).limited).toBe("Only one shop's own page could be checked.");
  });

  test("what the price he went by is: the best of all, the best new one, or just the one he went by", () => {
    const c = makeCtx();
    expect(researchView(c, research(A, B), NOW).best?.label).toBe("Best price");
    expect(researchView(c, research({...A, price: 829}, B), NOW).best?.label).toBe("Going by");
    expect(researchView(c, research({...M, pick: true}, B), NOW).best?.label).toBe("Best price");
  });

  test("what buying it today does goes by the whole cost, delivery too; nothing without one to go by or a daily amount", () => {
    const c = makeCtx();
    expect(totalOf({...M, pick: true})).toBe(628.99);
    expect(researchView(c, research({...M, pick: true}), NOW).ifToday).toBe(whatIf(c, 628.99)!.line);
    const none = researchView(c, research(B), NOW);
    expect([none.best, none.ifToday]).toEqual([null, null]);
    expect(researchView(makeCtx({state: baseState({incomes: []})}), research(A), NOW).ifToday).toBeNull();
  });

  test("when the prices were read: the time today, yesterday, or the day; the oldest of them", () => {
    const at = (d: Date) => researchView(makeCtx(), research({...A, checked: d.toISOString()}, B), NOW).checked;
    expect(at(new Date(2026, 9, 4, 18, 40))).toBe("Prices as listed, checked yesterday 18:40");
    expect(at(new Date(2026, 9, 3, 18, 40))).toBe("Prices as listed, checked Sat 3 Oct, 18:40");
  });
});

test("a question for the shops: the first thing the line says, and whether a price has to be checked; a subscription isn't one", () => {
  for (const q of ["Frank, can I afford a new iPhone?", "Could I buy a BMW?", "Is it worth getting a new TV?", "How much would a decent gaming PC cost?", "Should I get a new phone?", "How much does a PS5 cost in the UK, and could I buy one today?"]) {
    expect([q, pricesLikely(q)]).toEqual([q, true]);
  }
  for (const q of ["How much did I spend on takeaways?", "What can I spend today?", "Can I afford a £1,200 holiday?", "How much is left today?", "Can I afford rent this month?", "What's due before payday?",
    "How much does Netflix cost?", "How much is Netflix a month in the UK right now?", "What's the cheapest plan for Disney?", "How much would Spotify cost a year?"]) {
    expect([q, pricesLikely(q)]).toEqual([q, false]);
  }
  expect(notSubscription("And an Xbox Series X?")).toBe(true);
  expect(notSubscription("And what about Netflix?")).toBe(false);
});

test("a shop's own photo of it, from its page: its words or address name his model, never its logo, a badge, a video or a Pro", () => {
  const iphone: PurchaseClaim = {product: "iPhone 17, 256GB", assumed: "", identifies: ["iPhone 17", "256GB"], offers: []};
  // as Mobile Phones Direct's and Lebara's pages read on 2 Nov 2026
  const MPD = "https://www.mobilephonesdirect.co.uk/apple/iphone-17-256gb-white", LEBARA = "https://phones.lebara.co.uk/apple/iphone-17-256gb-white";
  const mpd = page(MPD, "![MobilePhonesDirect.co.uk](https://www.mobilephonesdirect.co.uk/themes/mpd/img/logo/mpd-logo-mobile.svg)\n![iPhone 17 Pro 256GB top deal](https://www.mobilephonesdirect.co.uk/files/images/thumbnail/handsets/apple/01_iphone17pro_orange_pm.png)\n![iPhone 17 256GB top deal](https://www.mobilephonesdirect.co.uk/files/images/thumbnail/handsets/apple/01_iphone17_black_pm.png)\n![iPhone 16 128GB top deal](https://www.mobilephonesdirect.co.uk/files/images/thumbnail/handsets/apple/01_iphone16_black_pm.png)\niPhone 17 256GB £889.00");
  expect(photoOn(mpd, iphone)).toBe("https://www.mobilephonesdirect.co.uk/files/images/thumbnail/handsets/apple/01_iphone17_black_pm.png");
  const lebara = page(LEBARA, "![Logo](https://phones.lebara.co.uk/themes/lebara/img/logo/lebara-ao.svg)\n![iPhone 17 256GB White - Image 2](https://img.youtube.com/vi/6RacMBJCZcw/0.jpg)\n![iPhone 17 256GB White - Image 3](https://phones.lebara.co.uk/files/images/thumbnail/handsets/apple/02_iphone17_white_pm.png)");
  expect(photoOn(lebara, iphone)).toBe("https://phones.lebara.co.uk/files/images/thumbnail/handsets/apple/02_iphone17_white_pm.png");
  expect(photoOn(page(SCAN, GLADIATOR_TEXT), iphone)).toBeNull();
  expect(photoOn(mpd, {...iphone, identifies: ["256GB"]})).toBeNull();
  // and it rides on the offer, and the card's tile
  const r = checkOffers({...iphone, offers: [{seller: "Mobile Phones Direct", url: MPD, price: 889, condition: "new", delivery: null, pick: true}]}, pages(mpd), NOW).research!;
  expect(researchView(makeCtx({state: baseState()}), r, NOW).rows[0].photo).toBe("https://www.mobilephonesdirect.co.uk/files/images/thumbnail/handsets/apple/01_iphone17_black_pm.png");
});

test("a card's photo is looked up by its name without his asides, as live runs named them", () => {
  expect(photoQuery("iPhone 17, 256GB")).toBe("iPhone 17");
  expect(photoQuery("BMW iX1 (new, cheapest BMW listed)")).toBe("BMW iX1");
  expect(photoQuery("BMW 1 Series, new, from price")).toBe("BMW 1 Series");
  expect(photoQuery("Hisense 55E6QTUK 55 inch Smart 4K UHD HDR LED Freely TV")).toBe("Hisense 55E6QTUK 55 inch Smart 4K UHD HDR LED Freely TV");
  expect(photoQuery("(refurbished) ")).toBe("(refurbished)");
});
