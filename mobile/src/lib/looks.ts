import type {ComingRow} from "./calc";
import type {Ctx, Tx} from "./types";

/** A badge's colour family; the theme turns it into a colour for light and dark (`badgeTint` in theme/tokens.ts). */
export type Tint = "green" | "blue" | "peach" | "latte" | "amber" | "pink" | "lavender" | "mint" | "rose" | "sand" | "grey";
/** A line icon for what a payment probably was (drawn in components/LookIcon.tsx). */
export type LookIcon = "cart" | "train" | "eating" | "takeaway" | "coffee" | "fuel" | "bag" | "film" | "bottle" | "pill" | "family" | "coin"
  | "house" | "phone" | "globe" | "bulb" | "drop" | "landmark" | "shield" | "dumbbell" | "music" | "tv" | "repeat" | "card" | "receipt"
  | "banknote" | "coins";
/** What a payment's badge shows when there's no shop logo: an icon for what it probably was, on its colour. */
export interface Look { icon: LookIcon; tint: Tint }

// each everyday category's look (the app's ids, lib/everyday.ts)
const CATS: Record<string, Look> = {
  groceries: {icon: "cart", tint: "green"}, transport: {icon: "train", tint: "blue"}, eating: {icon: "eating", tint: "peach"},
  takeaways: {icon: "takeaway", tint: "peach"}, coffee: {icon: "coffee", tint: "latte"}, fuel: {icon: "fuel", tint: "amber"},
  shopping: {icon: "bag", tint: "pink"}, entertainment: {icon: "film", tint: "lavender"}, personal: {icon: "bottle", tint: "mint"},
  health: {icon: "pill", tint: "rose"}, family: {icon: "family", tint: "sand"},
};
const UNKNOWN: Look = {icon: "coin", tint: "grey"};

// Guesses from a name, first match wins. Whole words where a short one could be part of another ("bar" in "barber").
const NAMES: [RegExp, string][] = [
  [/coffee|costa|starbucks|\bpret\b|nero|caff[eè]|\bcafe\b|greggs/i, "coffee"],
  [/deliveroo|just ?eat|uber ?eats|domino|pizza|\bkfc\b|mcdonald|nando|burger|takeaway/i, "takeaways"],
  [/\btfl\b|\buber\b|\bbolt\b|train|rail|\bbus\b|\btube\b|\blime\b|taxi|oyster/i, "transport"],
  [/tesco|sainsbury|\baldi\b|\blidl\b|\basda\b|morrisons|waitrose|co-?op|\bm&s\b|ocado|iceland|grocer/i, "groceries"],
  [/\bshell\b|\bbp\b|\besso\b|texaco|petrol|\bfuel\b/i, "fuel"],
  [/boots|superdrug|barber|salon|\bhair\b|beauty/i, "personal"],
  [/pharmacy|chemist|\bnhs\b|dentist|doctor|optician/i, "health"],
  [/restaurant|\bbar\b|\bpub\b|grill|kitchen|wagamama|dishoom|brunch/i, "eating"],
  [/cinema|odeon|\bvue\b|steam|playstation|xbox|ticket|theatre|museum/i, "entertainment"],
  [/amazon|\basos\b|zara|primark|\bh&m\b|argos|ikea|john lewis|uniqlo|\bshop\b/i, "shopping"],
];

// bills, by name
const BILLS: [RegExp, Look][] = [
  [/rent|mortgage|landlord/i, {icon: "house", tint: "sand"}],
  [/phone|mobile|\bee\b|vodafone|\bo2\b|three|giffgaff/i, {icon: "phone", tint: "blue"}],
  [/broadband|internet|wi-?fi|fibre|virgin|\bbt\b|sky/i, {icon: "globe", tint: "lavender"}],
  [/energy|electric|\bgas\b|octopus|british gas|edf|e\.on|ovo/i, {icon: "bulb", tint: "amber"}],
  [/water|thames|severn/i, {icon: "drop", tint: "blue"}],
  [/council/i, {icon: "landmark", tint: "grey"}],
  [/insurance|cover/i, {icon: "shield", tint: "mint"}],
  [/gym|fitness|sport/i, {icon: "dumbbell", tint: "rose"}],
  [/spotify|music|apple music|tidal/i, {icon: "music", tint: "green"}],
  [/netflix|disney|prime video|\btv\b|licen[cs]e|now tv/i, {icon: "tv", tint: "lavender"}],
  [/subscription/i, {icon: "repeat", tint: "pink"}],
  [/\bcar\b|finance|loan|credit|card/i, {icon: "card", tint: "grey"}],
];
const BILL: Look = {icon: "receipt", tint: "sand"};
const PAY: Look = {icon: "banknote", tint: "green"};
const MONEY_IN: Look = {icon: "coins", tint: "green"};
const SAVINGS: Look = {icon: "coins", tint: "mint"};

/** What a name probably was, as an everyday category's look; null when nothing fits. */
function guess(name: string): Look | null {
  const hit = NAMES.find(([re]) => re.test(name));
  return hit ? CATS[hit[1]] : null;
}

/** An everyday category's look: the app's own ones by id, else a guess from its name. */
export const catLook = (id: string, name: string): Look => CATS[id] ?? guess(name) ?? UNKNOWN;

/** A bill's look, from its name. */
export function billLook(name: string): Look {
  return BILLS.find(([re]) => re.test(name))?.[1] ?? BILL;
}

/** A payment's look: its bill's, money in's, or its category's; with no category (or Other), a guess from its name. */
export function txLook(ctx: Ctx, it: Tx): Look {
  if (it.cat === "savings") return SAVINGS;
  if (it.type === "income") return it.srcId ? PAY : MONEY_IN;
  if (it.billId) return billLook(ctx.state.bills.find(b => b.id === it.billId)?.name || it.note);
  const cat = it.cat && it.cat !== "other" ? CATS[it.cat] ?? guess(ctx.state.categories.find(x => x.id === it.cat)?.name || "") : null;
  return cat ?? guess(it.note) ?? UNKNOWN;
}

/** A coming-up row's look: a bill's from its name, pay's, or money expected's. */
export function comingLook(x: ComingRow): Look {
  return x.kind === "bill" ? billLook(x.name) : x.kind === "pay" ? PAY : MONEY_IN;
}
