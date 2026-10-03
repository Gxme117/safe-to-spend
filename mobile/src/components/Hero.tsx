import {router} from "expo-router";
import {View} from "react-native";
import {hero, type Calc} from "@/lib/calc";
import {money} from "@/lib/money";
import type {Ctx} from "@/lib/types";
import {s} from "@/theme/tokens";
import {BigMoney} from "./BigMoney";
import {Button, Card, T} from "./ui";

/** Today's number and why, in one line. */
export function Hero({ctx, c}: {ctx: Ctx; c: Calc}) {
  const h = hero(ctx, c);
  if (h.kind === "no-income") return (
    <Card>
      <T weight="heavy" size={22}>Start with your income</T>
      <T muted>You can only spend what comes in, so add where your money comes from first: your job, Student Finance, family, anything. Your payday and daily spending figure are worked out from it.</T>
      <Button label="Add your income" onPress={() => router.push("/income/new")} />
    </Card>
  );
  if (h.kind === "payday-today") return (
    <Card>
      <T weight="heavy" size={22}>Payday is today</T>
      <T muted>Confirm your pay below and the daily figure will count down to your next payday.</T>
    </Card>
  );
  if (h.kind === "no-payday") return (
    <Card>
      <T weight="heavy" size={22}>No payday coming up</T>
      <T muted>{"Add a regular income source so there's a payday to count down to."}</T>
      <Button label="Add income" onPress={() => router.push("/income/new")} />
    </Card>
  );
  return (
    <Card style={{gap: s[2], paddingVertical: s[6]}}>
      <T muted size={14} weight="semibold">Spending money {money(c.balance)}</T>
      <View style={{height: s[4]}} />
      <T weight="bold" size={17}>Safe to spend today</T>
      <BigMoney value={h.perDay} />
      <T muted lines={1} fit>{h.reason}</T>
    </Card>
  );
}
