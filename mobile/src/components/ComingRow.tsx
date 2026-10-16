import {router} from "expo-router";
import type {ComingRow} from "@/lib/calc";
import {Row} from "./ui";

/** A bill or money still to come. Money you said is coming opens again to change or remove it; pay opens your income, to change its amount or where it's from. */
export function ComingRowView({x, meta = x.meta}: {x: ComingRow; meta?: string}) {
  const open = !x.incomeId ? null : x.kind === "pay"
    ? {onPress: () => router.push(`/income/${x.incomeId}`), accessibilityHint: "Edit your pay"}
    : {onPress: () => router.push(`/expect?id=${x.incomeId}`), accessibilityHint: "Edit or remove this money"};
  return <Row name={x.name} meta={meta} amount={x.amt} good={x.good} {...open} />;
}
