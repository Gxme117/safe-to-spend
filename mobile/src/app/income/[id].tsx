import {router, Stack, useLocalSearchParams} from "expo-router";
import {useState} from "react";
import {Alert, Switch, View} from "react-native";
import {DateField} from "@/components/DateField";
import {Choice, Form} from "@/components/Form";
import {Field, Input, T} from "@/components/ui";
import {niceDate, pad} from "@/lib/dates";
import {uid} from "@/lib/defaults";
import {buildIncome, dateLabel, FREQ, needsDate} from "@/lib/income";
import {parseAmount} from "@/lib/money";
import type {IncomeFreq, IncomeType} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

const TYPES: {key: IncomeType; label: string}[] = [
  {key: "work", label: "Work"}, {key: "business", label: "Side business"}, {key: "student", label: "Student Finance"},
  {key: "benefits", label: "Benefits"}, {key: "family", label: "Family or friends"}, {key: "other", label: "Other"},
];
const FREQS = (Object.keys(FREQ) as IncomeFreq[]).map(k => ({key: k, label: FREQ[k]}));

export default function IncomeScreen() {
  const {id} = useLocalSearchParams<{id: string}>();
  const {c} = useTheme();
  const st = useMoney.getState();
  const old = st.state?.incomes.find(x => x.id === id);
  const t = st.today;
  const [name, setName] = useState(old?.name ?? "");
  const [type, setType] = useState<IncomeType>(old?.type ?? "work");
  const [freq, setFreq] = useState<IncomeFreq>(old?.freq ?? "monthly-lastworking");
  const [date, setDate] = useState(old?.date ?? (old?.day ? `${t.slice(0, 8)}${pad(old.day)}` : t));
  const [varies, setVaries] = useState(!!old?.varies);
  const [amount, setAmount] = useState(old && !old.varies ? String(old.amount ?? "") : "");
  const [low, setLow] = useState(old?.varies ? String(old.low ?? "") : "");
  const [typical, setTypical] = useState(old?.varies ? String(old.typical ?? "") : "");
  const [main, setMain] = useState(old ? !!old.main : !st.state?.incomes.some(x => x.main));
  const [error, setError] = useState("");
  const one = freq === "oneoff";

  const save = () => {
    const r = buildIncome({name, type, freq, date, varies, amount: parseAmount(amount), low: parseAmount(low), typical: parseAmount(typical), main},
      old, old?.id ?? "i" + uid(), t);
    if ("error" in r) return setError(r.error);
    useMoney.getState().saveIncome(r.src);
    router.back();
    useMoney.getState().notify(old ? "Income updated" : one ? `${r.src.name} added. We'll ask on ${niceDate(r.src.date!)} whether it arrived` : `${r.src.name} added. Your payday is worked out from it now`, !old);
  };
  const remove = () => Alert.alert("Remove this income source?", "Money you've already logged from it stays.", [
    {text: "Cancel", style: "cancel"},
    {text: "Remove", style: "destructive", onPress: () => { useMoney.getState().removeIncome(old!.id); router.back(); useMoney.getState().notify("Income removed"); }},
  ]);

  return (
    <Form error={error} submit="Save income" onSubmit={save} onRemove={old ? remove : undefined}>
      <Stack.Screen options={{title: old ? "Edit income" : "Add income"}} />
      <Field label="Name">
        <Input value={name} onChangeText={v => { setName(v); setError(""); }} placeholder={one ? "e.g. Sam paying me back" : "e.g. Pharmacy"} maxLength={40} autoFocus={!old} />
      </Field>
      <Field label="Where it comes from"><Choice options={TYPES} value={type} onChange={setType} /></Field>
      <Field label="How often"><Choice options={FREQS} value={freq} onChange={setFreq} /></Field>
      {needsDate(freq) ? <Field label={dateLabel(freq)}><DateField label={dateLabel(freq)} value={date} onChange={setDate} min={one && !old ? t : undefined} /></Field> : null}
      <Field label={one ? "Do you know the exact amount?" : "Is it the same amount every time?"}>
        <Choice options={[{key: "fixed", label: one ? "Yes, exactly" : "Same every time"}, {key: "varies", label: one ? "Roughly" : "It changes"}]}
          value={varies ? "varies" : "fixed"} onChange={k => setVaries(k === "varies")} />
      </Field>
      {varies ? (
        <>
          <View style={{flexDirection: "row", gap: s[3]}}>
            <View style={{flex: 1}}><Field label="Lowest you'd expect"><Input prefix="£" value={low} onChangeText={setLow} keyboardType="decimal-pad" placeholder="0.00" /></Field></View>
            <View style={{flex: 1}}><Field label="Usual amount"><Input prefix="£" value={typical} onChangeText={setTypical} keyboardType="decimal-pad" placeholder="0.00" /></Field></View>
          </View>
          <T muted size={13}>Your forecast uses the lowest amount, so a good month is a bonus rather than a shortfall.</T>
        </>
      ) : (
        <Field label={one ? "Amount" : "Amount after tax"}><Input prefix="£" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" /></Field>
      )}
      {!one ? (
        <View style={{flexDirection: "row", alignItems: "center", gap: s[3]}}>
          <T style={{flex: 1}}>This is my main pay. It sets your payday countdown.</T>
          <Switch value={main} onValueChange={setMain} trackColor={{true: c.ink, false: c.line}} accessibilityLabel="This is my main pay" />
        </View>
      ) : null}
    </Form>
  );
}
