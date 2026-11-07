// What a payment can be for, as one list: short names (much as Emma and Monzo name them), the bank's categories that file
// into each, and the narrower ones a payment's name can refine it to (Costa, inside Eating out, is Coffee & drinks).
// The ids are the app's own from before, so budgets and payments already filed under them never move. Pure.
import {catGroup} from "./calc";
import type {Category, SubCat} from "./types";

/**
 * One category. `monzo`: Monzo's categories that file into it. `parent`: the broader one it narrows (only a name refines a
 * payment into it, never the bank alone). `was`: its name before, so a starting category still called that is renamed.
 */
export interface CatalogEntry { id: string; name: string; monzo?: string[]; parent?: string; was?: string }

export const CATALOG: CatalogEntry[] = [
  {id: "groceries", name: "Groceries", monzo: ["groceries"]},
  {id: "eating", name: "Eating out", monzo: ["eating_out"]},
  {id: "takeaways", name: "Takeaways", parent: "eating"},
  {id: "coffee", name: "Coffee & drinks", parent: "eating"},
  {id: "transport", name: "Transport", monzo: ["transport"]},
  {id: "fuel", name: "Fuel", parent: "transport"},
  {id: "shopping", name: "Shopping", monzo: ["shopping"]},
  {id: "home", name: "Home", parent: "shopping"},
  {id: "pets", name: "Pets", parent: "shopping"},
  {id: "entertainment", name: "Fun", monzo: ["entertainment"], was: "Entertainment"},
  {id: "personal", name: "Self-care", monzo: ["personal_care"], was: "Personal care"},
  {id: "health", name: "Health", parent: "personal"},
  {id: "family", name: "Family", monzo: ["family"]},
  {id: "gifts", name: "Gifts", monzo: ["gifts"]},
  {id: "charity", name: "Charity", monzo: ["charity"]},
  {id: "holidays", name: "Holidays", monzo: ["holidays"]},
  {id: "cash", name: "Cash", monzo: ["cash"]},
  // what nothing else fits. Monzo's general, finances, expenses and bills (one that isn't a bill of yours) aren't mapped:
  // they come in here and are asked about
  {id: "other", name: "General", was: "Other"},
];

/** The category for what nothing else fits. */
export const GENERAL = "other";

// Guesses from a name, first match wins. Whole words where a short one could be part of another ("bar" in "barber").
// Pets before Home: "Pets at Home" is pets.
export const NAME_HINTS: [RegExp, string][] = [
  [/coffee|costa|starbucks|\bpret\b|nero|caff[eè]|\bcafe\b|greggs/i, "coffee"],
  [/deliveroo|just ?eat|uber ?eats|domino|pizza|\bkfc\b|mcdonald|nando|burger|takeaway/i, "takeaways"],
  [/\btfl\b|\buber\b|\bbolt\b|train|rail|\bbus\b|\btube\b|\blime\b|taxi|oyster/i, "transport"],
  [/tesco|sainsbury|\baldi\b|\blidl\b|\basda\b|morrisons|waitrose|co-?op|\bm&s\b|ocado|iceland|grocer/i, "groceries"],
  [/\bshell\b|\bbp\b|\besso\b|texaco|petrol|\bfuel\b/i, "fuel"],
  [/boots|superdrug|barber|salon|\bhair\b|beauty/i, "personal"],
  [/pharmacy|chemist|\bnhs\b|dentist|doctor|optician/i, "health"],
  [/restaurant|\bbar\b|\bpub\b|grill|kitchen|wagamama|dishoom|brunch/i, "eating"],
  [/cinema|odeon|\bvue\b|steam|playstation|xbox|ticket|theatre|museum/i, "entertainment"],
  [/pets at home|\bvets?\b|veterinary|zooplus|jollyes|\bpet\b/i, "pets"],
  [/ikea|\bb ?& ?q\b|dunelm|homebase|screwfix|toolstation|wilko|the range|habitat|furniture/i, "home"],
  [/amazon|\basos\b|zara|primark|\bh&m\b|argos|john lewis|uniqlo|\bshop\b/i, "shopping"],
];

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Your category for one in the list: the one with its id, else one of your own with its name (now or before). Never a fixed one. */
export function resolve(cats: Category[], id: string): Category | null {
  const e = CATALOG.find(x => x.id === id);
  return cats.find(x => x.id === id && !x.fixed)
    ?? (e ? cats.find(x => !x.fixed && (same(x.name, e.name) || (!!e.was && same(x.name, e.was)))) : undefined)
    ?? null;
}

/**
 * Every category in the list, kept with yours. A starting one still called what it was is renamed (Other is General); one you
 * renamed keeps your name, and so does any whose new name you already use. Missing ones are added at the end, free (no budget),
 * so nothing is held back by them. Budgets, groups and everything else you set stay as they were. Safe to run again.
 */
export function withCatalog(cats: Category[]): Category[] {
  const out = cats.map(x => {
    const e = CATALOG.find(k => k.id === x.id);
    if (!e?.was || x.fixed || x.name !== e.was || cats.some(y => y !== x && same(y.name, e.name))) return x;
    return {...x, name: e.name};
  });
  for (const e of CATALOG) if (!out.some(x => x.id === e.id) && !resolve(out, e.id)) out.push({id: e.id, name: e.name, budget: 0, fixed: false});
  return out;
}

/** The order to offer categories in: fixed ones (only offered with no bills), the ones you budget, the rest as they are, General last. */
export const catOrder = (cats: Category[]): Category[] => {
  const rank = (x: Category) => x.id === GENERAL ? 3 : x.fixed ? 0 : catGroup(x) === "everyday" ? 1 : 2;
  return [0, 1, 2, 3].flatMap(r => cats.filter(x => rank(x) === r));
};

/** A name's best guess in the list, if any (first match wins). */
export const nameHint = (name: string): string | null => NAME_HINTS.find(([re]) => re.test(name))?.[1] ?? null;

/** Deterministic id from parent + name. Same slug = same id, so undo for remove_subcat always recreates the same id. */
export const subCatSlug = (parentId: string, name: string): string =>
  `${parentId}/${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/** Look up a SubCat; null if the parent or sub is not found. */
export const resolveSubCat = (cats: Category[], catId: string, subId: string): SubCat | null =>
  cats.find(c => c.id === catId)?.subcategories?.find(sc => sc.id === subId) ?? null;

/**
 * Where a payment from the bank goes, from the bank's category and who it was with: the bank's category decides the broad one
 * (Eating out), the name can narrow it (Costa: Coffee & drinks). Never out of a budget: if you budget the broad one and not the
 * narrow one, it stays on the broad one, so it comes off the amount you set. Null: a category that isn't mapped, or one you don't have.
 */
export function bankCat(cats: Category[], bank: string | undefined, name: string): string | null {
  const e = bank ? CATALOG.find(x => x.monzo?.includes(bank)) : undefined;
  const parent = e && resolve(cats, e.id);
  if (!e || !parent) return null;
  const kids = CATALOG.filter(x => x.parent === e.id).map(x => x.id);
  const hint = NAME_HINTS.find(([re, id]) => kids.includes(id) && re.test(name))?.[1];
  const child = hint ? resolve(cats, hint) : null;
  if (!child || (catGroup(parent) === "everyday" && catGroup(child) !== "everyday")) return parent.id;
  return child.id;
}
