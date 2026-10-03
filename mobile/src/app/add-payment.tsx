import {router} from "expo-router";
import {useState} from "react";
import {View} from "react-native";
import {DateField} from "@/components/DateField";
import {Choice, Form} from "@/components/Form";
import {Chip, Field, Input, T} from "@/components/ui";
import {billFor} from "@/lib/bills";
import {niceDate} from "@/lib/dates";
import {money, parseAmount, r2} from "@/lib/money";
import type {Tx} from "@/lib/types";
import {useCalc} from "@/store/useCalc";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";

type Pick = {kind: "bill" | "cat" | "income"; id: string} | null;

export default function AddPayment() {
  const r = useCalc();
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amt, setAmt] = useState("");
  const [pick, setPick] = useState<Pick>(null);
  const [date, setDate] = useState(useMoney.getState().today);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  if (!r) return null;
  const {ctx, c} = r;
  const {bills, categories, incomes} = ctx.state;
  // once there are bills, fixed costs are picked through the bill (that's what marks it paid), not a category
  const spendCats = bills.length ? categories.filter(x => !x.fixed) : categories;
  const on = (k: NonNullable<Pick>["kind"], id: string) => pick?.kind === k && pick.id === id;
  const choose = (p: Pick) => { setPick(p); setError(""); };

  const save = async () => {
    const a = parseAmount(amt);
    if (!(a > 0)) return setError("Enter an amount, e.g. 12.50");
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
    <Form error={error} submit={kind === "expense" ? "Add payment" : "Add money in"} onSubmit={save}>
      <Choice options={[{key: "expense", label: "Money out"}, {key: "income", label: "Money in"}]} value={kind}
        onChange={k => { setKind(k); setPick(null); }} />
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
              {spendCats.map(x => <Chip key={x.id} label={x.name} on={on("cat", x.id)} onPress={() => choose({kind: "cat", id: x.id})} />)}
            </View>
          </Field>
        </>
      ) : (
        <Field label="Where did it come from?">
          <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
            {incomes.map(x => <Chip key={x.id} label={x.name} on={on("income", x.id)} onPress={() => choose({kind: "income", id: x.id})} />)}
            <Chip label="Something else" on={on("income", "other")} onPress={() => choose({kind: "income", id: "other"})} />
          </View>
        </Field>
      )}
      <Field label="When">
        <DateField label="Date" value={date} onChange={setDate} max={c.t} />
      </Field>
      <Field label="Note (optional)">
        <Input value={note} onChangeText={setNote} placeholder="e.g. Shoes, haircut, deposit" maxLength={80} />
      </Field>
      {kind === "income" ? <T muted size={13}>Pay from your main income is confirmed on the Day tab when it lands.</T> : null}
    </Form>
  );
}
