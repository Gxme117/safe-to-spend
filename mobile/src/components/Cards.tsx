import {router} from "expo-router";
import {useState} from "react";
import {Alert, View} from "react-native";
import type {Calc} from "@/lib/calc";
import {niceDate} from "@/lib/dates";
import {lowAmt, pendingCheckins, usualAmt} from "@/lib/income";
import {money, parseAmount} from "@/lib/money";
import type {Ctx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {Button, Card, Input, T} from "./ui";

function TodoDot() {
  const {c} = useTheme();
  return <View style={{width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink}} />;
}

type Pending = ReturnType<typeof pendingCheckins>[number];

/** "Did your pay arrive?" Money only counts once it lands. */
export function CheckinCard({ctx}: {ctx: Ctx}) {
  const pend = pendingCheckins(ctx);
  if (!pend.length) return null;
  // keyed by payday, so the amount field starts fresh for each one
  return <Checkin key={pend[0].key} p={pend[0]} more={pend.length - 1} today={ctx.today} />;
}

function Checkin({p, more, today}: {p: Pending; more: number; today: string}) {
  const src = p.src, isToday = p.date === today;
  const [amt, setAmt] = useState(!src.varies && src.amount ? String(src.amount) : "");
  const {confirmPay, snooze, skip, notify} = useMoney.getState();
  const expect = src.varies ? `Usually ${money(usualAmt(src))}, at least ${money(lowAmt(src))}.` : `Expected ${money(src.amount || 0)}.`;

  const arrived = async () => {
    const a = parseAmount(amt || String(usualAmt(src)));
    if (!(a > 0)) return notify("Enter the amount that arrived, e.g. 1850");
    if (await confirmPay(src, p.date, a)) notify(`${money(a)} from ${src.name} landed. Your balance just went up`, true);
  };
  const notComing = () => Alert.alert(`Mark this ${src.name} payment as not coming?`, undefined, [
    {text: "Cancel", style: "cancel"},
    {text: "It's not coming", style: "destructive", onPress: () => skip(p.key)},
  ]);

  return (
    <Card>
      <View style={{flexDirection: "row", alignItems: "center", gap: s[2]}}>
        <TodoDot />
        <T weight="semibold" size={14}>{isToday ? "Payday check" : "Missed payday check"}</T>
      </View>
      <T weight="bold" size={18}>Did your {src.name} {src.type === "work" ? "pay" : "money"} arrive?</T>
      <T muted>Due {isToday ? "today" : niceDate(p.date)}. {expect} Confirm the amount that actually landed so your balance stays real.</T>
      <Input prefix="£" value={amt} onChangeText={setAmt} keyboardType="decimal-pad" placeholder={String(usualAmt(src))} accessibilityLabel="Amount that arrived" />
      <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
        <Button kind="good" label="It arrived" onPress={arrived} />
        <Button kind="ghost" label="Not yet" onPress={() => snooze(p.key)} />
        <Button kind="ghost" label="It's not coming" onPress={notComing} />
      </View>
      {more ? <T muted size={13}>{more} more to check after this.</T> : null}
    </Card>
  );
}

/** Short for bills and everyday: say by how much, and how to fix it. Never scolds. */
export function ShortCard({c}: {c: Calc}) {
  if (!c.short) return null;
  return (
    <Card>
      <View style={{flexDirection: "row", alignItems: "center", gap: s[2]}}>
        <TodoDot />
        <T weight="semibold" size={14}>Short for bills and everyday</T>
      </View>
      <T weight="bold" size={18}>You need {money(c.short)} more</T>
      <T muted>
        You have {money(c.balance)} to spend, but {c.everydayLeft ? `bills (${money(c.billsLeft)}) and everyday (${money(c.everydayLeft)}) need` : "bills need"} {money(c.need)} before payday.
      </T>
      <T>Bills and everyday come first. If you have savings, move <T weight="bold">{money(c.short)}</T>{" into your spending account and you're covered. Or lower an everyday amount until payday."}</T>
      <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
        <Button label="I've moved it" onPress={() => router.push("/settings")} accessibilityLabel="I've moved it. Update your balance" />
        <Button kind="ghost" label="Change everyday" onPress={() => router.push("/everyday")} />
      </View>
    </Card>
  );
}
