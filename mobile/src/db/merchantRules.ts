import type {MerchantRule} from "@/lib/types";
import {db} from "./open";

interface Row { payee: string; cat: string; sub_cat: string | null; created: number }
const fromRow = (r: Row): MerchantRule => ({payee: r.payee, cat: r.cat, ...(r.sub_cat ? {subCat: r.sub_cat} : {}), created: r.created});

export async function getMerchantRules(): Promise<MerchantRule[]> {
  const rows = await (await db()).getAllAsync<Row>("SELECT * FROM merchant_rule ORDER BY created");
  return rows.map(fromRow);
}

export async function setMerchantRule(payee: string, cat: string, subCat?: string): Promise<void> {
  await (await db()).runAsync(
    "INSERT OR REPLACE INTO merchant_rule (payee, cat, sub_cat, created) VALUES (?, ?, ?, ?)",
    payee, cat, subCat ?? null, Date.now(),
  );
}

export async function removeMerchantRule(payee: string): Promise<void> {
  await (await db()).runAsync("DELETE FROM merchant_rule WHERE payee = ?", payee);
}
