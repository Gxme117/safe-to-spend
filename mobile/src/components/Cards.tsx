import {useState} from "react";
import {Alert, View} from "react-native";
import {niceDate, niceTime, nowHM} from "@/lib/dates";
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
  const pend = pendingCheckins(ctx, nowHM());
  if (!pend.length) return null;
  // keyed by payday, so the amount field starts fresh for each one
  return <Checkin key={pend[0].key} p={pend[0]} more={pend.length - 1} today={ctx.today} />;
}

function Checkin({p, more, today}: {p: Pending; more: number; today: string}) {
  const src = p.src, isToday = p.date === today, one = src.freq === "oneoff";
  const [amt, setAmt] = useState(!src.varies && src.amount ? String(src.amount) : "");
  // the same every time: one tap says it arrived. The field is for when it didn't land as expected (or it varies)
  const usual = !src.varies && src.amount ? src.amount : 0;
  const [typing, setTyping] = useState(!usual);
  const {confirmPay, snooze, skip, notify} = useMoney.getState();
  const expect = src.varies ? `Usually ${money(usualAmt(src))}, at least ${money(lowAmt(src))}.` : `Expected ${money(src.amount || 0)}.`;

  const arrived = async (exact?: number) => {
    const a = exact ?? parseAmount(amt || String(usualAmt(src)));
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
        <T weight="semibold" size="sm">{one ? (isToday ? "Money check" : "Missed money check") : isToday ? "Payday check" : "Missed payday check"}</T>
      </View>
      <T weight="bold" size="lg">Did your {src.name} {src.type === "work" ? "pay" : "money"} arrive?</T>
      <T muted>Due {isToday ? "today" : niceDate(p.date)}{one && src.time ? ` around ${niceTime(src.time)}` : ""}. {expect} It only counts once it lands, so your balance stays real.</T>
      {typing ? <Input prefix="£" value={amt} onChangeText={setAmt} keyboardType="decimal-pad" placeholder={String(usualAmt(src))} accessibilityLabel="Amount that arrived" /> : null}
      <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
        {typing
          ? <Button kind="good" label="It arrived" onPress={() => arrived()} />
          : <Button kind="good" label={`Yes, ${money(usual)} arrived`} onPress={() => arrived(usual)} />}
        {typing ? null : <Button kind="ghost" label="A different amount" onPress={() => setTyping(true)} />}
        <Button kind="ghost" label="Not yet" onPress={() => snooze(p.key)} />
        <Button kind="ghost" label="It's not coming" onPress={notComing} />
      </View>
      {more ? <T muted size="sm">{more} more to check after this.</T> : null}
    </Card>
  );
}
