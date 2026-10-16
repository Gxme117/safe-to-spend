import {router, Stack, useLocalSearchParams} from "expo-router";
import {useState} from "react";
import {View} from "react-native";
import {DateField} from "@/components/DateField";
import {Choice, Form} from "@/components/Form";
import {Chip, Field, Input, T} from "@/components/ui";
import {billFor} from "@/lib/bills";
import {addDays, niceDate} from "@/lib/dates";
import {uid} from "@/lib/defaults";
import {buildIncome} from "@/lib/income";
import {money, parseAmount, r2} from "@/lib/money";
import {spendCats} from "@/lib/payments";
import type {Tx} from "@/lib/types";
import {useCalc} from "@/store/useCalc";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";

type Pick = {kind: "bill" | "cat" | "income"; id: string} | null;

export default function AddPayment() {
  const r = useCalc();
  const params = useLocalSearchParams<{date?: string; kind?: string}>();
  const today = useMoney.getState().today;
  const [kind, setKind] = useState<"expense" | "income">(params.kind === "income" ? "income" : "expense");
  const [amt, setAmt] = useState("");
  const [pick, setPick] = useState<Pick>(null);
  // money in can be on a day still to come: that's money you're expecting
  const [date, setDate] = useState(params.date && (params.date < today || params.kind === "income") ? params.date : today);
  const [note, setNote] = useState("");
  const [from, setFrom] = useState("");
  const [otherDay, setOtherDay] = useState(false);
  const [error, setError] = useState("");
  if (!r) return null;
  const {ctx, c} = r;
  const {bills, incomes} = ctx.state;
  const cats = spendCats(ctx.state);
  const on = (k: NonNullable<Pick>["kind"], id: string) => pick?.kind === k && pick.id === id;
  const choose = (p: Pick) => { setPick(p); setError(""); };
  // expecting it: it's saved as money coming in just once, and only counts once it lands
  const coming = kind === "income" && date > c.t;
  const when = date === addDays(c.t, 1) ? "tomorrow" : `on ${niceDate(date)}`;
  const bank = ctx.state.bank?.source;
  // money in: today and tomorrow are one tap; any other day opens the picker
  const tmr = addDays(c.t, 1);
  const whenPick = otherDay || (date !== c.t && date !== tmr) ? "other" : date === c.t ? "today" : "tomorrow";
  const pickWhen = (k: "today" | "tomorrow" | "other") => {
    setError("");
    if (k === "other") { setOtherDay(true); if (date === c.t || date === tmr) setDate(addDays(c.t, 2)); return; }
    setOtherDay(false); setDate(k === "today" ? c.t : tmr);
  };

  const save = async () => {
    const a = parseAmount(amt);
    if (!(a > 0)) return setError("Enter an amount, e.g. 12.50");
    if (coming) {
      const name = from.trim();
      if (!name) return setError("Say who it's from, e.g. Nando's");
      const r = buildIncome({name, type: "other", freq: "oneoff", date, varies: false, amount: a, low: NaN, typical: NaN, main: false}, undefined, "i" + uid(), c.t);
      if ("error" in r) return setError(r.error);
      useMoney.getState().saveIncome(r.src);
      router.back();
      return useMoney.getState().notify(`${money(a)} from ${r.src.name} expected ${when}. It counts once it lands`, true);
    }
    if (!pick) return setError(kind === "expense" ? "Pick what it was for" : "Pick where it came from");
    const base = {amount: r2(a), note: note.trim().slice(0, 80), date};
    let tx: Omit<Tx, "id" | "created">, msg: string, good = true;
    if (kind === "income") {
      tx = {...base, type: "income", cat: pick.id};
      msg = `${money(a)} received. Your balance just went up`;
    } else if (pick.kind === "bill") {
      const b = bills.find(x => x.id === pick.id)!, d = billFor(ctx, b, date);
      tx = {...base, type: "expense", cat: b.cat || "bills", billId: b.id, ...(d ? {forDate: d} : {})};
      msg = d ? `${b.name} marked paid for ${niceDate(d)}. It's no longer held back` : `Filed under ${b.name}`;
    } else {
      tx = {...base, type: "expense", cat: pick.id};
      const e = c.everyday.find(x => x.x.id === pick.id);
      if (e && date >= c.cycleFrom && e.left - a >= 0) msg = `Logged. Still ${money(r2(e.left - a))} left for ${e.x.name}`;
      else { msg = `Spent ${money(a)} added`; good = false; }
    }
    if (!(await useMoney.getState().addTx(tx))) return setError("That didn't save. Try again.");
    router.back();
    useMoney.getState().notify(msg, good);
  };

  return (
    <Form error={error} submit={kind === "expense" ? "Add payment" : coming ? "Add money coming in" : "Add money in"} onSubmit={save}>
      <Stack.Screen options={{title: kind === "income" ? "Money in" : "Add a payment"}} />
      <Choice options={[{key: "expense", label: "Money out"}, {key: "income", label: "Money in"}]} value={kind}
        onChange={k => { setKind(k); setPick(null); setError(""); if (k === "expense" && date > c.t) { setDate(c.t); setOtherDay(false); } }} />
      <Field label="Amount">
        <Input prefix="£" value={amt} onChangeText={t => { setAmt(t); setError(""); }} keyboardType="decimal-pad" placeholder="0.00" autoFocus accessibilityLabel="Amount" />
      </Field>
      {kind === "expense" ? (
        <>
          {bills.length ? (
            <Field label="A bill">
              <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
                {bills.map(b => <Chip key={b.id} label={b.name} on={on("bill", b.id)} onPress={() => choose({kind: "bill", id: b.id})} />)}
              </View>
            </Field>
          ) : null}
          <Field label={bills.length ? "Or spending" : "What was it for?"}>
            <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
              {cats.map(x => <Chip key={x.id} label={x.name} on={on("cat", x.id)} onPress={() => choose({kind: "cat", id: x.id})} />)}
            </View>
          </Field>
        </>
      ) : coming ? (
        <Field label="Who's it from?">
          <Input value={from} onChangeText={v => { setFrom(v); setError(""); }} placeholder="e.g. Nando's" maxLength={40} accessibilityLabel="Who it's from" />
        </Field>
      ) : (
        <Field label="Where did it come from?">
          <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
            {incomes.map(x => <Chip key={x.id} label={x.name} on={on("income", x.id)} onPress={() => choose({kind: "income", id: x.id})} />)}
            <Chip label="Something else" on={on("income", "other")} onPress={() => choose({kind: "income", id: "other"})} />
          </View>
        </Field>
      )}
      <Field label="When">
        {kind === "income" ? (
          <View style={{gap: s[3]}}>
            <Choice options={[{key: "today" as const, label: "Today"}, {key: "tomorrow" as const, label: "Tomorrow"}, {key: "other" as const, label: "Another day"}]}
              value={whenPick} onChange={pickWhen} />
            {whenPick === "other" ? <DateField label="Date" value={date} onChange={setDate} max={addDays(c.t, 90)} /> : null}
          </View>
        ) : <DateField label="Date" value={date} onChange={setDate} max={c.t} />}
      </Field>
      {!coming ? (
        <Field label="Note (optional)">
          <Input value={note} onChangeText={setNote} placeholder="e.g. Shoes, haircut, deposit" maxLength={80} />
        </Field>
      ) : null}
      {coming
        ? <T muted size="sm" lines={1} fit>{bank ? `It counts once it shows up in ${bank}` : `It counts once it lands. We'll ask ${when}`}</T>
        : kind === "income" ? <T muted size="sm">{"Expecting money? Pick the day it's coming. Your main pay is confirmed on the Day tab when it lands."}</T> : null}
    </Form>
  );
}
