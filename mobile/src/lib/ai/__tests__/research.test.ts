import type Anthropic from "@anthropic-ai/sdk";
import {whatIf} from "../../today";
import {baseState, ctx as makeCtx} from "../../__tests__/fixtures";
import {catalogueIn, defaultCard, forTool, isNewView, nameParts, nextIdIn, notSubscription, photoQuery, pickOf, priceOf, pricesLikely, researchView, lowestOf, titleOf, totalOf,
  type OldResearchView, type Product, type Research} from "../research";

type Message = Anthropic.Beta.Messages.BetaMessageParam;
const NOW = new Date(2026, 9, 5, 9, 12);

const p = (id: string, over: Partial<Product> = {}): Product => ({id, name: "Sony WH-1000XM6 Headphones", brand: "Sony", model: "WH-1000XM6", group: "sony|wh1000xm6",
  retailer: "Argos", host: "argos.co.uk", url: `https://www.argos.co.uk/product/${id}`, price: 349.99, confidence: "search_listed", priceSource: `https://www.argos.co.uk/product/${id}`,
  image: "https://imgs.search.brave.com/s.jpg", condition: "new", delivery: "free", checked: new Date(2026, 9, 5, 9, 0).toISOString(), ...over});
// a conversation with find_products in it, as the phone sent it
const asked = (id: string): Message => ({role: "assistant", content: [{type: "tool_use", id, name: "find_products", input: {queries: ["x"]}}]} as unknown as Message);
const answered = (id: string, products: Product[], is_error = false): Message =>
  ({role: "user", content: [{type: "tool_result", tool_use_id: id, content: JSON.stringify({products: products.map(forTool)}), ...is_error ? {is_error} : {}}]} as unknown as Message);

describe("the products in a conversation", () => {
  test("every find_products result, by id, rebuilt from what he saw: a kept chat has them all", () => {
    const one = [p("p1"), p("p2", {retailer: "John Lewis", host: "johnlewis.com", confidence: "verified", price: 349, delivery: 4.99, priceSource: "https://www.johnlewis.com/x/p2"})];
    const two = [p("p3", {price: null, confidence: null, priceSource: null, image: null, from: undefined, inStock: false}), p("p4", {confidence: "estimated", from: true, condition: "refurbished"})];
    const msgs = JSON.parse(JSON.stringify([asked("t1"), answered("t1", one), asked("t2"), answered("t2", two)])) as Message[];
    const got = catalogueIn(msgs);
    expect([...got.keys()]).toEqual(["p1", "p2", "p3", "p4"]);
    expect(got.get("p1")).toEqual(p("p1"));
    expect(got.get("p2")).toEqual(one[1]);
    expect(got.get("p3")).toEqual(two[0]);
    expect(got.get("p4")).toEqual(two[1]);
    expect(nextIdIn(got)).toBe(5);
    expect(nextIdIn(new Map())).toBe(1);
  });

  test("only find_products' own results count: not an error, not another tool's, not something that isn't one of ours", () => {
    const other: Message = {role: "assistant", content: [{type: "tool_use", id: "t9", name: "overview", input: {}}]} as unknown as Message;
    const msgs = [asked("t1"), answered("t1", [p("p1")], true), other, answered("t9", [p("p2")]), asked("t3"),
      {role: "user", content: [{type: "tool_result", tool_use_id: "t3", content: "not json"}]} as unknown as Message,
      asked("t4"), answered("t4", [{...p("p5"), url: "javascript:alert(1)"}])];
    expect(catalogueIn(msgs).size).toBe(0);
  });

  test("what he's given has prices and delivery as the only numbers, and how sure each is in words", () => {
    const t = forTool(p("p1", {name: "Sony £349 WH-1000XM6", delivery: 4.99}));
    expect(t).toMatchObject({id: "p1", name: "Sony WH-1000XM6", shop: "Argos", price: 349.99, price_is: "listed in search; the shop's page couldn't be checked", delivery: 4.99});
    expect(Object.values(t).filter(v => typeof v === "number")).toEqual([349.99, 4.99]);
    expect(forTool(p("p2", {confidence: "verified"})).price_is).toBe("on the shop's own page now");
    expect(forTool(p("p3", {confidence: "estimated"})).price_is).toBe("an estimate, not a shop's current listing");
    expect(forTool(p("p4", {price: null, confidence: null})).price_is).toBe("no price found");
  });
});

describe("the card", () => {
  test("find_products' own card: its order, up to 8, at most 2 of a thing when there are several things; one thing, its shops", () => {
    const things = ["a", "b", "c", "d"].flatMap(g => [1, 2, 3].map(n => p(`p${g}${n}`, {group: g})));
    const card = defaultCard(things, "headphones", "Only 2 products came back that fit.");
    expect(card.products.map(x => x.id)).toEqual(["pa1", "pa2", "pb1", "pb2", "pc1", "pc2", "pd1", "pd2"]);
    expect(card).toMatchObject({v: 2, title: "headphones", partial: "Only 2 products came back that fit."});
    const shops = defaultCard([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => p(`p${n}`)), "MacBook Air");
    expect(shops.products).toHaveLength(8);
    expect(titleOf({queries: ["best laptop UK"], match: []})).toBe("Best laptop UK");
    expect(titleOf({queries: ["x"], match: ["gaming PC"]})).toBe("Gaming PC");
  });

  test("as shown: each tile's price and how sure it is in words and an icon, never colour alone; the pick leads, with what buying it today would do", () => {
    const c = makeCtx({state: baseState()});
    const r: Research = {v: 2, title: "Wireless headphones", note: "Over-ear", pick: "p2", products: [
      p("p1"), p("p2", {retailer: "John Lewis", confidence: "verified", price: 449.95, delivery: 4.99}),
      p("p3", {confidence: "estimated", price: 69.49}), p("p4", {from: true, price: 1099}),
      p("p5", {price: null, confidence: null, priceSource: null, image: null, inStock: false, condition: "unknown", delivery: null}),
    ]};
    const v = researchView(c, r, NOW);
    expect(v.tiles.map(t => [t.price, t.sure, t.sureIcon, t.selectable, t.pick])).toEqual([
      ["£349.99", "Listed in search", "search", true, false],
      ["£449.95", "On the shop's page", "check", true, true],
      ["About £69", "Estimate", "estimate", true, false],
      ["From £1,099.00", "Listed in search", "search", true, false],
      ["No price found", "", null, false, false],
    ]);
    expect(v.tiles[0].meta).toBe("New · Free delivery");
    expect(v.tiles[1].meta).toBe("New · £4.99 delivery");
    expect(v.tiles[3].meta).toBe("New · Free delivery · Starting price");
    expect(v.tiles[4].meta).toBe("Out of stock");
    expect(v.tiles[0].label).toBe("Sony WH-1000XM6 Headphones at Argos, £349.99, the lowest price, Listed in search, New · Free delivery");
    // dearer than the cheapest on the card: his best value, with how much more (the card's own sum, with delivery)
    expect(v.best).toEqual({label: "Best value", name: "Sony WH-1000XM6 Headphones", price: "£449.95", by: "at John Lewis · On the shop's page · £4.99 delivery",
      value: true, more: "£104.95 more than the cheapest, at Argos"});
    expect(v.tiles.map(t => !!t.value)).toEqual([false, true, false, false, false]);
    expect(v.tiles[1].label).toContain("best value");
    expect(researchView(c, {...r, why: "A newer model"}, NOW).best?.why).toBe("A newer model");
    // the cheapest picked: going by it, nothing more said
    expect(researchView(c, {...r, pick: "p1"}, NOW).best).toEqual({label: "Going by", name: "Sony WH-1000XM6 Headphones", price: "£349.99", by: "at Argos · Listed in search · Free delivery"});
    expect(v.ifLabel).toBe("If you bought it today");
    expect(v.ifToday).toBe(whatIf(c, 454.94)!.line);
    expect(v.checked).toBe("Prices as of 09:00");
    expect(isNewView(v)).toBe(true);
    expect(pickOf(r)?.id).toBe("p2");
  });

  test("an estimate or a starting price tried today says so; no pick, no engine; fewer than five says so", () => {
    const c = makeCtx({state: baseState()});
    const est = researchView(c, {v: 2, title: "x", products: [p("p1", {confidence: "estimated"})], pick: "p1"}, NOW);
    expect(est.ifLabel).toBe("If it's about that, today");
    const from = researchView(c, {v: 2, title: "x", products: [p("p1", {from: true})], pick: "p1"}, NOW);
    expect(from.ifLabel).toBe("If you paid the starting price today");
    expect(from.best?.spec).toBe("A starting price: the one you'd want may cost more.");
    const none = researchView(c, {v: 2, title: "x", products: [p("p1"), p("p2")], partial: "Only 2 products came back that fit."}, NOW);
    expect([none.best, none.ifToday, none.partial]).toEqual([null, null, "Only 2 products found."]);
    // a price seen yesterday, or earlier, says when
    expect(researchView(c, {v: 2, title: "x", products: [p("p1", {checked: new Date(2026, 9, 4, 18, 40).toISOString()})]}, NOW).checked).toBe("Prices as of yesterday 18:40");
  });

  test("the lowest price is marked: with delivery, a shop's price not an estimate, only with two or more to compare", () => {
    const c = makeCtx({state: baseState()});
    const v = researchView(c, {v: 2, title: "x", products: [
      p("p1", {price: 50, delivery: 10}), p("p2", {price: 55}), p("p3", {confidence: "estimated", price: 20}), p("p4", {price: null, confidence: null}),
    ]}, NOW);
    expect(v.tiles.map(t => t.lowest)).toEqual([false, true, false, false]);
    expect(v.tiles[1].label).toContain("the lowest price");
    expect(lowestOf([p("p1"), p("p2", {confidence: "estimated", price: 1})])).toBeNull(); // only one shop's price
  });

  test("the cheapest is one that fits: new, in stock, a real price; on a tie, one on the shop's own page", () => {
    const others = [p("p1", {price: 100, condition: "used"}), p("p2", {price: 100, condition: "refurbished"}), p("p3", {price: 100, inStock: false}),
      p("p4", {price: 100, from: true}), p("p5", {price: 100, confidence: "estimated"})];
    expect(lowestOf([...others, p("p6", {price: 300}), p("p7", {price: 200, condition: "unknown"})])?.id).toBe("p7");
    expect(lowestOf([...others, p("p6", {price: 300})])).toBeNull(); // only one that fits
    expect(lowestOf([p("p1", {price: 200}), p("p2", {price: 200, confidence: "verified"}), p("p3", {price: 250})])?.id).toBe("p2");
    expect(lowestOf([p("p1", {price: 200, delivery: 5}), p("p2", {price: 204, delivery: "free"})])?.id).toBe("p2");
  });

  test("find_products' own card always has the cheapest that fits, even when it came back last", () => {
    const many = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => p(`p${n}`, {price: n === 10 ? 99 : 300 + n}));
    const card = defaultCard(many, "x");
    expect(card.products).toHaveLength(8);
    expect(card.products.map(x => x.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p10"]);
    // left off by the two-of-a-thing rule: added
    const things = ["a", "b", "c"].flatMap(g => [1, 2, 3].map(n => p(`p${g}${n}`, {group: g, price: g === "c" && n === 3 ? 50 : 300})));
    expect(defaultCard(things, "x").products.map(x => x.id)).toEqual(["pa1", "pa2", "pb1", "pb2", "pc1", "pc2", "pc3"]);
  });

  test("every shop tied for the lowest price is marked; none when every price is the same", () => {
    const c = makeCtx({state: baseState()});
    const tied = researchView(c, {v: 2, title: "x", products: [
      p("p1", {retailer: "Currys", price: 749}), p("p2", {retailer: "John Lewis", price: 749}), p("p3", {price: 799}),
    ]}, NOW);
    expect(tied.tiles.map(t => t.lowest)).toEqual([true, true, false]);
    const same = researchView(c, {v: 2, title: "x", products: [p("p1", {price: 749}), p("p2", {retailer: "Currys", price: 749})]}, NOW);
    expect(same.tiles.map(t => t.lowest)).toEqual([false, false]);
  });

  test("what a product costs to have: its price and any delivery charge; the price as the card says it", () => {
    expect(totalOf(p("p1", {price: 899, delivery: 4.99}))).toBe(903.99);
    expect(totalOf(p("p1", {price: 899, delivery: "free"}))).toBe(899);
    expect(priceOf(p("p1", {price: 32295, from: true}))).toBe("From £32,295.00");
  });

  test("a card kept from before is told apart from a new one", () => {
    const old: OldResearchView = {product: "iPhone 17, 256GB", best: null, rows: [], ifLabel: "If you bought it today", ifToday: null, checked: "Prices as listed, checked 09:12"};
    expect(isNewView(old)).toBe(false);
  });
});

test("a question for the shops: the first thing the line says, and whether a price has to come from them; a subscription isn't one", () => {
  for (const q of ["Frank, can I afford a new iPhone?", "Could I buy a BMW?", "Is it worth getting a new TV?", "How much would a decent gaming PC cost?", "Should I get a new phone?",
    "How much does a PS5 cost in the UK, and could I buy one today?", "Find me some wireless headphones", "What's the cheapest place to buy a MacBook?"]) {
    expect([q, pricesLikely(q)]).toEqual([q, true]);
  }
  for (const q of ["How much did I spend on takeaways?", "What can I spend today?", "Can I afford a £1,200 holiday?", "How much is left today?", "Can I afford rent this month?", "What's due before payday?",
    "How much does Netflix cost?", "How much is Netflix a month in the UK right now?", "What's the cheapest plan for Disney?", "How much would Spotify cost a year?"]) {
    expect([q, pricesLikely(q)]).toEqual([q, false]);
  }
  expect(notSubscription("And an Xbox Series X?")).toBe(true);
  expect(notSubscription("And what about Netflix?")).toBe(false);
});

test("a product is named by its model and size, the rest of the shop's listing under it", () => {
  expect(nameParts("Apple Watch Ultra 4 GPS + Cell 49mm Titanium Burgundy Alpine Loop"))
    .toEqual({title: "Apple Watch Ultra 4 49mm", specs: "GPS + Cell Titanium Burgundy Alpine Loop"});
  expect(nameParts("Sony WH-1000XM6 Wireless Noise Cancelling Headphones, Black"))
    .toEqual({title: "Sony WH-1000XM6", specs: "Wireless Noise Cancelling Headphones · Black"});
  expect(nameParts("Apple iPhone 17 Pro 256GB Cosmic Orange")).toEqual({title: "Apple iPhone 17 Pro 256GB", specs: "Cosmic Orange"});
  expect(nameParts("Samsung 65 Inch QN90F Neo QLED 4K HDR Smart TV")).toEqual({title: "Samsung QN90F 65″", specs: "Neo QLED 4K HDR Smart TV"});
  expect(nameParts('LG OLED65C5 65" 4K Smart TV (2025)')).toEqual({title: "LG OLED65C5 65″", specs: "4K Smart TV · 2025"});
  expect(nameParts("Apple AirPods Pro (3rd generation)")).toEqual({title: "Apple AirPods Pro (3rd generation)", specs: ""});
  expect(nameParts("Bose QuietComfort Ultra Headphones")).toEqual({title: "Bose QuietComfort Ultra Headphones", specs: ""});
  expect(nameParts("Apple Watch Series 11 GPS 42mm Jet Black Aluminium Case - Sport Band")).toEqual({title: "Apple Watch Series 11 42mm", specs: "GPS Jet Black Aluminium Case · Sport Band"});
  // "2 in 1" isn't a size
  expect(nameParts("Lenovo Yoga 7 2 in 1 Laptop").title).not.toContain("″");
});

test("an old card's photo is looked up by its name without his asides, as live runs named them", () => {
  expect(photoQuery("iPhone 17, 256GB")).toBe("iPhone 17");
  expect(photoQuery("BMW iX1 (new, cheapest BMW listed)")).toBe("BMW iX1");
  expect(photoQuery("BMW 1 Series, new, from price")).toBe("BMW 1 Series");
  expect(photoQuery("(refurbished) ")).toBe("(refurbished)");
});
