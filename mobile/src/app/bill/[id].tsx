import {router, Stack, useLocalSearchParams} from "expo-router";
import {useState} from "react";
import {Alert, View} from "react-native";
import {DateField} from "@/components/DateField";
import {Choice, DayGrid, Form} from "@/components/Form";
import {Chip, Field, Input} from "@/components/ui";
import {BILL_FREQ, buildBill, COMMON_BILLS, METHOD} from "@/lib/bills";
import {uid} from "@/lib/defaults";
import {parseAmount} from "@/lib/money";
import type {BillFreq, BillMethod} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";

const FREQS = (Object.keys(BILL_FREQ) as BillFreq[]).map(k => ({key: k, label: BILL_FREQ[k]}));
const METHODS = (Object.keys(METHOD) as BillMethod[]).map(k => ({key: k, label: METHOD[k]}));

export default function BillScreen() {
  const {id} = useLocalSearchParams<{id: string}>();
  const st = useMoney.getState();
  const old = st.state?.bills.find(x => x.id === id);
  const taken = new Set(st.state?.bills.map(b => b.name.toLowerCase()));
  const [name, setName] = useState(old?.name ?? "");
  const [amount, setAmount] = useState(old?.amount ? String(old.amount) : "");
  const [varies, setVaries] = useState(!!old?.varies);
  const [freq, setFreq] = useState<BillFreq>(old?.freq ?? "monthly");
  const [day, setDay] = useState<number | "last" | null>(old?.day ?? null);
  const [date, setDate] = useState(old?.date ?? st.today);
  const [method, setMethod] = useState<BillMethod | null>(old?.method ?? null);
  const [error, setError] = useState("");

  const save = () => {
    const r = buildBill({name, amount: parseAmount(amount), varies, freq, day, date, method}, old?.id ?? "b" + uid(), old);
    if ("error" in r) return setError(r.error);
    useMoney.getState().saveBill(r.bill);
    router.back();
    useMoney.getState().notify(old ? `${r.bill.name} updated` : `${r.bill.name} added. It's held back before payday`, !old);
  };
  const remove = () => Alert.alert(`Remove ${old!.name}?`, "Payments you've already logged for it stay.", [
    {text: "Cancel", style: "cancel"},
    {text: "Remove", style: "destructive", onPress: () => { useMoney.getState().removeBill(old!.id); router.back(); useMoney.getState().notify("Bill removed"); }},
  ]);

  return (
    <Form error={error} submit="Save bill" onSubmit={save} onRemove={old ? remove : undefined}>
      <Stack.Screen options={{title: old ? "Edit bill" : "Add a bill"}} />
      <Field label="What is it?">
        <Input value={name} onChangeText={v => { setName(v); setError(""); }} placeholder="e.g. Rent" maxLength={40} />
        {!old ? (
          <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
            {COMMON_BILLS.filter(n => !taken.has(n.toLowerCase())).map(n => <Chip key={n} label={n} on={name === n} onPress={() => { setName(n); setError(""); }} />)}
          </View>
        ) : null}
      </Field>
      <Field label="How much?">
        <Input prefix="£" value={amount} onChangeText={v => { setAmount(v); setError(""); }} keyboardType="decimal-pad" placeholder="0.00" />
        <Choice options={[{key: "fixed", label: "Same every time"}, {key: "varies", label: "It changes a bit"}]} value={varies ? "varies" : "fixed"} onChange={k => setVaries(k === "varies")} />
      </Field>
      <Field label="How often"><Choice options={FREQS} value={freq} onChange={setFreq} /></Field>
      {freq === "monthly" ? (
        <Field label="Which day?" hint={day === "last" ? "That's the last weekday that isn't a bank holiday." : "If it lands on a weekend or bank holiday, we'll expect it the next working day."}>
          <DayGrid value={day} onChange={d => { setDay(d); setError(""); }} />
        </Field>
      ) : (
        <Field label="Next date it goes out" hint="If it lands on a weekend or bank holiday, we'll expect it the next working day.">
          <DateField label="Next date it goes out" value={date} onChange={setDate} />
        </Field>
      )}
      <Field label="How is it paid? (optional)"><Choice options={METHODS} value={method} onChange={setMethod} /></Field>
    </Form>
  );
}
