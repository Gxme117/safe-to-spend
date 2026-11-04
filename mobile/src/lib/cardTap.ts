import {calc, catGroup, hero} from "./calc";
import {parseD} from "./dates";
import {money, newestFirst} from "./money";
import type {Ctx, Tx} from "./types";

/**
 * What the card island (Live Activity, `widgets/CardTap.tsx`) says about a payment. All of it is ready-made text: the island's
 * layout runs on its own and can't work anything out. `pot`: the payment was in an everyday budget, so it shows what's left of
 * that this pay; otherwise what's safe to spend today.
 */
export interface CardTapProps {
  pot: boolean;
  face: string;      // Frank's face as a file:// path in the shared folder, or "" for a symbol
  peek: string;      // Frank peeking over the compact island's edge, the same way, or "" for his face
  icon: string;      // SF Symbol for the budget's category
  where: string;     // "Tesco"
  paid: string;      // "£14.20"
  when: string;      // "just now" or "at 09:12"
  compact: string;   // "£38": just the amount, so the pill stays narrow and both sides balance
  minimal: string;   // "£13"
  headline: string;  // words only, the amount's beside Frank: "Left for groceries until payday" / "Safe to spend today"
  title: string;     // Lock Screen: "Left for groceries" / "Safe to spend today"
  big: string;       // Lock Screen: "£38" / "£13"
  fill: number;      // what's left, 0 to 1 of the budget or today's amount
  spent: string;     // "£21.70 spent"
  of: string;        // "£200 this pay" / "£25 today"
  from: string;      // under the bar, left: "Wed 30 Sep" / "Today"
  until: string;     // under the bar, right: "Lasts until payday" / "Resets at midnight"
}

/** A symbol for each category the app knows; one of your own gets a card. */
const ICONS: Record<string, string> = {
  groceries: "cart.fill",eating: "fork.knife", takeaways: "takeoutbag.and.cup.and.straw", coffee: "cup.and.saucer",
  transport: "tram", fuel: "fuelpump", shopping: "bag", home: "house", pets: "pawprint", entertainment: "ticket",
  personal: "sparkles", health: "cross.case", family: "figure.2.and.child.holdinghands", gifts: "gift", charity: "heart",
  holidays: "airplane", cash: "banknote",
};

const floorMoney = (n: number) => money(Math.floor(Math.max(0, n)));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const shortDay = (s: string) => { const d = parseD(s); return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${d.getDate()}`; };

/** The newest bank payment out today that wasn't there before (`seen`, the ids before a sync) and didn't pay a bill. */
export function newCardPayment(ctx: Ctx, seen: ReadonlySet<string>): Tx | null {
  return ctx.txs.filter(t => t.monzoId && !seen.has(t.id) && t.type === "expense" && !t.billId && t.date === ctx.today)
    .sort(newestFirst)[0] ?? null;
}

/** What the island says about payment `t`, from the same engine as Today. Null when there's no figure to show. */
export function cardTapFor(ctx: Ctx, t: Tx, now: number): CardTapProps | null {
  const c = calc(ctx);
  const at = t.paidAt ?? t.created;
  const base = {face: "", peek: "", where: t.note.trim() || "A payment", paid: money(t.amount), when: now - at < 10 * 60e3 ? "just now" : `at ${hhmm(at)}`};
  const cat = ctx.state.categories.find(x => x.id === t.cat);
  const e = cat && catGroup(cat) === "everyday" && cat.budget > 0 ? c.everyday.find(x => x.x.id === cat.id) : undefined;
  if (cat && e) {
    const name = cat.name.toLowerCase();
    return {...base, pot: true, icon: ICONS[cat.id] ?? "creditcard",
      compact: floorMoney(e.left), minimal: floorMoney(e.left),
      headline: `Left for ${name} until payday`,
      title: `Left for ${name}`, big: floorMoney(e.left), fill: clamp01(e.left / cat.budget),
      spent: `${money(e.spent)} spent`, of: `${money(cat.budget)} this pay`,
      from: shortDay(c.cycleFrom), until: "Lasts until payday"};
  }
  const h = hero(ctx, c);
  if (h.kind !== "number") return null;
  return {...base, pot: false, icon: "",
    compact: floorMoney(h.left), minimal: floorMoney(h.left),
    headline: "Safe to spend today",
    title: "Safe to spend today", big: floorMoney(h.left), fill: h.perDay ? clamp01(h.left / h.perDay) : 0,
    spent: `${money(h.spentToday)} spent`, of: `${money(h.perDay)} today`,
    from: "Today", until: "Resets at midnight"};
}

/** The island for the newest new card payment, or null. */
export function cardTapOf(ctx: Ctx, seen: ReadonlySet<string>, now: number): CardTapProps | null {
  const t = newCardPayment(ctx, seen);
  return t ? cardTapFor(ctx, t, now) : null;
}
