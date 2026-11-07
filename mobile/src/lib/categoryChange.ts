// A change to a category or filing that Frank or Tim proposes: nothing is saved until the user taps yes.
// All logic here is pure: the store and DB are outside. Mirrors the shape of lib/billChange.ts.
import {resolveSubCat, subCatSlug} from "./categories";
import {money} from "./money";
import type {Category, CategoryProposal, Ctx, IsoDate, MerchantRule} from "./types";

/** Refused for a reason Frank can act on. */
export class Refused extends Error {}

// strip legal suffixes, .com / .co.uk, leading "the ", collapse whitespace
const NOISE_SUFFIX = /\b(ltd|limited|plc|llp|inc|corp|co|com|co\.uk|uk)\b\.?/gi;
export function normalizePayee(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(NOISE_SUFFIX, " ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Category and optional subcat if a rule matches the transaction's note, else null. First full-word match wins. */
export function matchMerchantRule(rules: MerchantRule[], note: string): {cat: string; subCat?: string} | null {
  const norm = normalizePayee(note);
  const r = rules.find(r => norm === r.payee || norm.includes(r.payee) && new RegExp(`\\b${r.payee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(norm));
  if (!r) return null;
  return {cat: r.cat, ...(r.subCat ? {subCat: r.subCat} : {})};
}

function catName(cats: Category[], id: string): string {
  return cats.find(x => x.id === id)?.name ?? id;
}

/** Propose filing one specific payment under a different category.
 *  `payee`, `date` and `amount` together identify the transaction (from the payments tool); the phone resolves it. */
export function proposeRefile(
  ctx: Ctx,
  args: {payee: string; date: IsoDate; amount: number; cat: string},
): CategoryProposal {
  const {payee, date, amount, cat} = args;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Refused("date must be a date like 2026-11-05.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Refused("amount must be more than 0, in pounds.");
  const toCat = ctx.state.categories.find(x => x.id === cat || x.name.trim().toLowerCase() === cat.trim().toLowerCase());
  if (!toCat) throw new Refused(`There's no category called "${cat}". Check the name with the everyday tool.`);
  // find the matching transaction: date + amount (to nearest penny) + payee name match
  const amountP = Math.round(amount * 100);
  const matches = ctx.txs.filter(t =>
    t.date === date &&
    Math.round(t.amount * 100) === amountP &&
    normalizePayee(t.note).includes(normalizePayee(payee)),
  );
  if (matches.length === 0) throw new Refused(`No payment to "${payee}" for ${money(amount)} on ${date} found. Call payments to find the right date and amount.`);
  if (matches.length > 1) throw new Refused(`${matches.length} payments match. Give a more specific payee name, or the exact amount.`);
  const tx = matches[0];
  if (tx.billId) throw new Refused("That payment is filed against a bill: use change_bill to change the bill instead.");
  if (tx.cat === toCat.id) throw new Refused(`It's already filed as ${toCat.name}: nothing to change.`);
  return {kind: "refile", txId: tx.id, note: tx.note, date, amount, fromCat: tx.cat, toCat: toCat.id};
}

/** Propose a rule: always file this merchant as a category (and optional subcategory) from now on. */
export function proposeTeachMerchant(
  ctx: Ctx,
  rules: MerchantRule[],
  payee: string,
  cat: string,
  subCat?: string,
): CategoryProposal {
  const norm = normalizePayee(payee);
  if (!norm) throw new Refused("payee must be a merchant name.");
  const toCat = ctx.state.categories.find(x => x.id === cat || x.name.trim().toLowerCase() === cat.trim().toLowerCase());
  if (!toCat) throw new Refused(`There's no category called "${cat}". Check the name with the everyday tool.`);
  if (subCat) {
    const sub = resolveSubCat(ctx.state.categories, toCat.id, subCat);
    if (!sub) throw new Refused(`"${subCat}" is not a subcategory of ${toCat.name}.`);
  }
  const existing = rules.find(r => r.payee === norm);
  if (existing && existing.cat === toCat.id && existing.subCat === subCat)
    throw new Refused(`There's already a rule filing ${payee} as ${catName(ctx.state.categories, existing.cat)}: nothing to change.`);
  return {kind: "merchant_rule", payee: norm, cat: toCat.id, ...(subCat ? {subCat} : {})};
}

/** Propose adding a subcategory under an existing category. */
export function proposeAddSubcat(cats: Category[], parentId: string, name: string): CategoryProposal {
  const parent = cats.find(c => c.id === parentId);
  if (!parent) throw new Refused(`There's no category with id "${parentId}".`);
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) throw new Refused("Ask what the subcategory should be called.");
  const id = subCatSlug(parentId, trimmed);
  if (parent.subcategories?.some(sc => sc.id === id || sc.name.trim().toLowerCase() === trimmed.toLowerCase()))
    throw new Refused(`There's already a subcategory called "${trimmed}" under ${parent.name}.`);
  return {kind: "add_subcat", parentId, name: trimmed};
}

/** Propose renaming a subcategory. */
export function proposeRenameSubcat(cats: Category[], parentId: string, subId: string, newName: string): CategoryProposal {
  const parent = cats.find(c => c.id === parentId);
  const sub = parent?.subcategories?.find(sc => sc.id === subId);
  if (!sub) throw new Refused(`No subcategory "${subId}" found.`);
  const trimmed = newName.trim().slice(0, 40);
  if (!trimmed) throw new Refused("Ask what the new name should be.");
  if (sub.name === trimmed) throw new Refused(`It's already called "${trimmed}": nothing to change.`);
  if (parent!.subcategories!.some(sc => sc.id !== subId && sc.name.trim().toLowerCase() === trimmed.toLowerCase()))
    throw new Refused(`There's already a subcategory called "${trimmed}": choose a different name.`);
  return {kind: "rename_subcat", parentId, subId, oldName: sub.name, newName: trimmed};
}

/** Propose removing a subcategory (transactions keep their subCat, UI shows a fallback). */
export function proposeRemoveSubcat(cats: Category[], parentId: string, subId: string): CategoryProposal {
  const sub = cats.find(c => c.id === parentId)?.subcategories?.find(sc => sc.id === subId);
  if (!sub) throw new Refused(`No subcategory "${subId}" found.`);
  return {kind: "remove_subcat", parentId, subId, oldName: sub.name};
}

/** Propose adding a new spending category. */
export function proposeAddCategory(cats: Category[], name: string): CategoryProposal {
  const trim = name.trim().slice(0, 40);
  if (!trim) throw new Refused("Ask what the category should be called.");
  const dup = cats.find(x => x.name.trim().toLowerCase() === trim.toLowerCase());
  if (dup) throw new Refused(`There's already a category called "${dup.name}": no need to add it.`);
  return {kind: "add_cat", name: trim};
}

/** Propose renaming a category (by id or current name). */
export function proposeRenameCategory(cats: Category[], id: string, newName: string): CategoryProposal {
  const trim = newName.trim().slice(0, 40);
  if (!trim) throw new Refused("Ask what the new name should be.");
  const cat = cats.find(x => x.id === id) ?? cats.find(x => x.name.trim().toLowerCase() === id.trim().toLowerCase());
  if (!cat) throw new Refused(`There's no category with id "${id}". Check the name with the everyday tool.`);
  if (cat.fixed) throw new Refused(`${cat.name} is a fixed category and can't be renamed.`);
  if (cat.name === trim) throw new Refused(`It's already called "${trim}": nothing to change.`);
  const dup = cats.find(x => x.id !== cat.id && x.name.trim().toLowerCase() === trim.toLowerCase());
  if (dup) throw new Refused(`There's already a category called "${dup.name}": choose a different name.`);
  return {kind: "rename_cat", id: cat.id, oldName: cat.name, newName: trim};
}

/** One sentence for the AI: what the card shows. */
export function catCardLine(cats: Category[], p: CategoryProposal): string {
  if (p.kind === "refile") return `Move ${money(p.amount)} to ${catName(cats, p.toCat)}: the ${money(p.amount)} to "${p.note}" on ${p.date}, currently in ${catName(cats, p.fromCat)}.`;
  if (p.kind === "merchant_rule") return `Always file "${p.payee}" as ${catName(cats, p.cat)}: future payments from them will go there.`;
  if (p.kind === "add_cat") return `Add a new category called "${p.name}".`;
  if (p.kind === "add_subcat") return `Add subcategory "${p.name}" under ${catName(cats, p.parentId)}.`;
  if (p.kind === "rename_subcat") return `Rename subcategory "${p.oldName}" to "${p.newName}".`;
  if (p.kind === "remove_subcat") return `Remove subcategory "${p.oldName}" from ${catName(cats, p.parentId)}.`;
  return `Rename "${p.oldName}" to "${p.newName}".`;
}

/** Is the proposal no longer applicable? Returns a reason string, or null if it's still valid. */
export function staleCat(cats: Category[], txs: Ctx["txs"], p: CategoryProposal): string | null {
  if (p.kind === "refile") {
    const tx = txs.find(t => t.id === p.txId);
    if (!tx) return "That payment's gone.";
    if (tx.cat !== p.fromCat) return "That payment's already been moved.";
    if (!cats.find(x => x.id === p.toCat)) return "That category's gone.";
    return null;
  }
  if (p.kind === "merchant_rule") {
    if (!cats.find(x => x.id === p.cat)) return "That category's gone.";
    return null;
  }
  if (p.kind === "add_cat") {
    if (cats.find(x => x.name.trim().toLowerCase() === p.name.toLowerCase())) return `A category called "${p.name}" already exists.`;
    return null;
  }
  if (p.kind === "add_subcat") {
    if (!cats.find(c => c.id === p.parentId)) return "That category's gone.";
    return null;
  }
  if (p.kind === "rename_subcat") {
    const sub = cats.find(c => c.id === p.parentId)?.subcategories?.find(sc => sc.id === p.subId);
    if (!sub) return "That subcategory's gone.";
    if (sub.name !== p.oldName) return "That subcategory's already been renamed.";
    return null;
  }
  if (p.kind === "remove_subcat") {
    if (!cats.find(c => c.id === p.parentId)?.subcategories?.some(sc => sc.id === p.subId)) return "That subcategory's already gone.";
    return null;
  }
  // rename_cat
  const cat = cats.find(x => x.id === p.id);
  if (!cat) return "That category's gone.";
  if (cat.name !== p.oldName) return "That category's already been renamed.";
  if (cats.find(x => x.id !== p.id && x.name.trim().toLowerCase() === p.newName.toLowerCase())) return `A category called "${p.newName}" now exists.`;
  return null;
}

/** What Frank says once a proposal is applied. */
export function catDoneLine(cats: Category[], p: CategoryProposal, who: "tim" | "frank"): string {
  const isFrank = who === "frank";
  if (p.kind === "refile") {
    const name = catName(cats, p.toCat);
    return isFrank ? `Done. That payment's now in ${name}.` : `Done. I've moved it to ${name}.`;
  }
  if (p.kind === "merchant_rule") {
    const catN = catName(cats, p.cat);
    const payeeN = p.payee.replace(/\b\w/g, c => c.toUpperCase());
    return isFrank ? `Done. ${payeeN} goes to ${catN} from now on.` : `Done. I'll file ${payeeN} as ${catN} from now on.`;
  }
  if (p.kind === "add_cat") return isFrank ? `Done. ${p.name}'s in your categories.` : `Done. I've added ${p.name} to your categories.`;
  if (p.kind === "add_subcat") return isFrank ? `Done. ${p.name}'s added.` : `Done. I've added ${p.name}.`;
  if (p.kind === "rename_subcat") return isFrank ? `Done. It's now called ${p.newName}.` : `Done. I've renamed it to ${p.newName}.`;
  if (p.kind === "remove_subcat") return isFrank ? `Done. ${p.oldName}'s removed.` : `Done. I've removed ${p.oldName}.`;
  return isFrank ? `Done. It's now called ${p.newName}.` : `Done. I've renamed it to ${p.newName}.`;
}

export const catLeftLine = (who: "tim" | "frank"): string =>
  who === "frank" ? "Fine. Left it as it was." : "No problem. I've left it as it was.";

/** What you decided, for him on your next message. */
export function catOutcomeLine(cats: Category[], p: CategoryProposal, how: "done" | "declined" | "unanswered" | "undone"): string {
  const what = catCardLine(cats, p);
  return how === "done" ? `They tapped yes on your card: ${what} It's saved.`
    : how === "declined" ? `They said no to your card: ${what} Nothing changed.`
    : how === "undone" ? `They said yes to your card, then undid it: ${what} Nothing changed.`
    : `They didn't answer your card: ${what} Nothing changed.`;
}
