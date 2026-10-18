import {calc} from "../calc";
import {bubbleRadii, livingAction, livingDraft, livingDue, livingItems, livingMarked, livingPayment, livingPayments, livingTotals, pack, pileOrder, R_ADD, saveLiving} from "../living";
import {baseState, ctx, TODAY, tx} from "./fixtures";

// the sample in design/living-screen.html: rent, groceries (4 weekly shops), council tax, energy, travel, water, internet, gym, phone, Spotify, Netflix
const SAMPLE = [750, 220, 120, 95, 80, 35, 28, 25, 18, 12, 11];
// where the reference's own pack() puts them (and the "+") in its 358 × 500 pit: [x, y, r]
const REFERENCE: [number, number, number][] = [
  [109.5, 390.5, 109.5], [273.14, 438.86, 61.14], [311.3, 337.99, 46.7], [231.02, 299.48, 42.33], [39.48, 259.01, 39.48], [168.36, 264.81, 29.29],
  [292.36, 266.39, 27.36], [105.3, 254.57, 26.49], [250.69, 235.76, 24.35], [335.65, 241.95, 22.35], [238.18, 363.41, 22], [202.46, 221.3, 26],
];
const packSample = () => {
  const radii = bubbleRadii(SAMPLE);
  return pack([...SAMPLE.map((_, i) => ({id: `b${i}`, r: radii[i]})), {id: "add", r: R_ADD}], 358, 500);
};

test("the cheapest is 44pt across and the priciest 219pt, and a bigger amount is always a bigger bubble", () => {
  const radii = bubbleRadii(SAMPLE);
  expect(radii[radii.length - 1] * 2).toBeCloseTo(44);
  expect(radii[0] * 2).toBeCloseTo(219);
  for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1]);
  // area grows in step with the cost
  const area = (r: number) => r * r - 22 * 22;
  expect(area(radii[1]) / area(radii[2])).toBeCloseTo((220 - 11) / (120 - 11));
});

test("a lone bill is 120pt across", () => {
  expect(bubbleRadii([400])).toEqual([60]);
});

test("the pile lands exactly where the reference puts it", () => {
  const pos = packSample();
  const got = [...SAMPLE.map((_, i) => pos[`b${i}`]), pos.add];
  got.forEach((p, i) => {
    expect(p.x).toBeCloseTo(REFERENCE[i][0], 1);
    expect(p.y).toBeCloseTo(REFERENCE[i][1], 1);
    expect(p.r).toBeCloseTo(REFERENCE[i][2], 1);
  });
});

test("nothing overlaps, everything is inside the walls and on the floor or resting on something, the biggest at the bottom left", () => {
  const ps = Object.values(packSample());
  for (const p of ps) {
    expect(p.x - p.r).toBeGreaterThanOrEqual(-0.01);
    expect(p.x + p.r).toBeLessThanOrEqual(358.01);
    expect(p.y + p.r).toBeLessThanOrEqual(500.01);
    const onFloor = Math.abs(p.y + p.r - 500) < 0.5;
    const touching = ps.filter(q => q !== p && Math.abs(Math.hypot(q.x - p.x, q.y - p.y) - (q.r + p.r)) < 0.5);
    expect(onFloor || touching.length > 0).toBe(true);
    for (const q of ps) if (q !== p) expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeGreaterThanOrEqual(q.r + p.r - 0.31);
  }
  expect(ps[0]).toMatchObject({x: 109.5, y: 390.5});
});

test("every bill at its monthly cost and every everyday amount, biggest first; a bill with no amount isn't a bubble", () => {
  const state = baseState({bills: [
    {id: "rent", name: "Rent", amount: 400, freq: "monthly", day: 15, method: "dd"},
    {id: "tv", name: "TV licence", amount: 180, freq: "yearly", date: "2027-04-01"},
    {id: "car", name: "Car insurance", amount: 0, freq: "monthly"},
  ]});
  const c0 = ctx({state});
  const items = livingItems(c0, calc(c0));
  expect(items.map(x => [x.name, x.amount, x.icon, x.estimate])).toEqual([
    ["Rent", 400, "house", false], ["Groceries", 200, "cart", true], ["TV licence", 15, "tv", false],
  ]);
});

test("paid ones are packed last, so they sit on top of the pile", () => {
  const items = [{id: "rent", paid: true}, {id: "food", paid: false}, {id: "phone", paid: true}, {id: "gym", paid: false}];
  expect(pileOrder(items).map(x => x.id)).toEqual(["food", "gym", "rent", "phone"]);
  // packed in that order, a paid bubble rests higher than the unpaid one of the same size
  const pos = pack(pileOrder([{id: "a", r: 40, paid: true}, {id: "b", r: 40, paid: false}, {id: "c", r: 40, paid: false}, {id: "d", r: 40, paid: false}]), 200, 400);
  expect(pos.a.y).toBeLessThan(Math.min(pos.b.y, pos.c.y));
});

test("a bill is paid once everything due for it this pay cycle has gone out", () => {
  const paidPhone = tx({amount: 20, date: "2026-10-01", billId: "phone", forDate: "2026-10-01"});
  const c0 = ctx({txs: [paidPhone]});
  const items = livingItems(c0, calc(c0));
  expect(items.find(x => x.name === "Phone")?.paid).toBe(true);
  expect(items.find(x => x.name === "Rent")?.paid).toBe(false);
});

test("the header: what it all costs a month, and what still has to go out before payday", () => {
  const c0 = ctx({today: TODAY});
  const c = calc(c0);
  expect(livingTotals(livingItems(c0, c), c)).toEqual({total: 620, left: c.need});
});

test("the sheet's due line: when a bill's due, that it's gone out, and what's been spent from an everyday amount", () => {
  const paidPhone = tx({amount: 20, date: "2026-10-01", billId: "phone", forDate: "2026-10-01"});
  const due = (txs: ReturnType<typeof tx>[], name: string, today = TODAY) => {
    const c0 = ctx({txs, today});
    const c = calc(c0);
    return livingDue(c0, c, livingItems(c0, c).find(x => x.name === name)!);
  };
  expect(due([], "Rent")).toEqual({line: "Due Thu 15 Oct,", bold: "in 10 days"});
  expect(due([], "Rent", "2026-10-14")).toEqual({line: "Due Thu 15 Oct,", bold: "tomorrow"});
  expect(due([], "Rent", "2026-10-15")).toEqual({line: "Due today", bold: ""});
  expect(due([], "Phone")).toEqual({line: "Was due Thu 1 Oct", bold: ""});
  expect(due([paidPhone], "Phone")).toEqual({line: "· Thu 1 Oct", bold: "", paid: true});
  // everyday: what's left of it this pay cycle
  expect(due([], "Groceries")).toEqual({line: "Nothing spent yet,", bold: "£200 left"});
  expect(due([tx({amount: 50, date: "2026-10-02", cat: "groceries"})], "Groceries")).toEqual({line: "£50 spent so far,", bold: "£150 left"});
  // gone past the amount: "extra", never "over"
  expect(due([tx({amount: 230, date: "2026-10-02", cat: "groceries"})], "Groceries")).toEqual({line: "£230 spent so far,", bold: "£30 extra"});
});

test("Mark as paid logs the bill's payment for its first unpaid due date; Mark as unpaid removes only payments logged here", () => {
  const at = (txs: ReturnType<typeof tx>[], name: string) => {
    const c0 = ctx({txs});
    const c = calc(c0);
    return {c0, c, item: livingItems(c0, c).find(x => x.name === name)!};
  };
  const rent = at([], "Rent");
  expect(livingAction(rent.c0, rent.c, rent.item)).toBe("pay");
  const pay = livingPayment(rent.c0, rent.c, rent.item)!;
  expect(pay).toEqual({type: "expense", amount: 400, cat: "rent", note: "", date: TODAY, billId: "rent", forDate: "2026-10-15"});
  // logged, it's paid, and it can be unmarked
  const logged = tx(pay);
  const paid = at([logged], "Rent");
  expect(paid.item.paid).toBe(true);
  expect(livingAction(paid.c0, paid.c, paid.item)).toBe("unpay");
  expect(livingMarked(paid.c0, paid.c, paid.item)).toEqual([logged.id]);
  // paid from the bank: that payment really went out, so there's nothing to unmark
  const bank = at([tx({...pay, monzoId: "m1"})], "Rent");
  expect(livingAction(bank.c0, bank.c, bank.item)).toBeNull();
  // an everyday amount logs spending
  const food = at([], "Groceries");
  expect(livingAction(food.c0, food.c, food.item)).toBe("log");
  expect(livingPayment(food.c0, food.c, food.item)).toBeNull();
});

test("editing: a bill keeps everything but its name, amount and day; an everyday amount its name and monthly amount", () => {
  const state = baseState();
  const c0 = ctx({state});
  const items = livingItems(c0, calc(c0));
  const rent = items.find(x => x.name === "Rent")!, food = items.find(x => x.name === "Groceries")!;
  const d = livingDraft(state, rent);
  expect(d).toMatchObject({name: "Rent", amount: "400", due: "day", day: "15", last: false});
  const old = state.bills.find(b => b.id === "rent")!;
  expect(saveLiving(state, rent, {...d, name: " Flat ", amount: "425.5", day: "28"})).toEqual({bill: {...old, name: "Flat", amount: 425.5, day: 28}});
  // a blank day: no payment date, unless it went out on the last working day
  expect(saveLiving(state, rent, {...d, day: ""})).toEqual({bill: (({day: _, ...b}) => b)(old)});
  expect(saveLiving(state, rent, {...d, day: "", last: true})).toEqual({bill: {...old, day: "last"}});
  expect(saveLiving(state, rent, {...d, day: "32"})).toEqual({error: "Pick a day from 1 to 31"});
  expect(saveLiving(state, rent, {...d, amount: "0"})).toEqual({error: "Enter how much it is, e.g. 650"});
  expect(saveLiving(state, rent, {...d, name: " "})).toEqual({error: "Give it a name"});
  const fd = livingDraft(state, food);
  expect(fd).toMatchObject({name: "Groceries", amount: "200", due: null});
  const r = saveLiving(state, food, {...fd, amount: "250"});
  expect("categories" in r && r.categories.find(x => x.id === food.ref)?.budget).toBe(250);
});

test("a paid bill's payments: filed against it, or in its category around its due date, this pay cycle only", () => {
  const filed = tx({amount: 20, date: "2026-10-01", billId: "phone", forDate: "2026-10-01", note: "EE"});
  const byCat = tx({amount: 400, date: "2026-10-14", cat: "rent", note: "Landlord"});
  const before = tx({amount: 400, date: "2026-09-15", cat: "rent"});
  const c0 = ctx({txs: [byCat, before, filed]});
  const c = calc(c0);
  const of = (name: string) => livingPayments(c0, c, livingItems(c0, c).find(x => x.name === name)!);
  expect(of("Phone")).toEqual([filed]);
  expect(of("Rent")).toEqual([byCat]);
  expect(of("Groceries")).toEqual([]);
});
