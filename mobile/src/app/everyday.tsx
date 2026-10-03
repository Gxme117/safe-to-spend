import {router} from "expo-router";
import {useState} from "react";
import {View} from "react-native";
import {Choice, Form} from "@/components/Form";
import {Button, Card, Input, T} from "@/components/ui";
import {catGroup} from "@/lib/calc";
import {uid} from "@/lib/defaults";
import {money, parseAmount, r2} from "@/lib/money";
import type {Category} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";

interface Draft { cat: Category; everyday: boolean; amount: string }

/** Everyday is money you spend every month (groceries, coffee). It's kept aside, so the daily number is what's truly free. */
export default function EverydayScreen() {
  const cats = useMoney.getState().state?.categories ?? [];
  const [rows, setRows] = useState<Draft[]>(() => cats.filter(x => !x.fixed).map(x => ({cat: x, everyday: catGroup(x) === "everyday", amount: x.budget ? String(x.budget) : ""})));
  const [adding, setAdding] = useState("");
  const [error, setError] = useState("");
  const set = (i: number, p: Partial<Draft>) => { setRows(rs => rs.map((r, j) => j === i ? {...r, ...p} : r)); setError(""); };

  const add = () => {
    const name = adding.trim().slice(0, 30);
    if (!name) return setError("Type a name first, e.g. Coffee");
    if (rows.some(r => r.cat.name.toLowerCase() === name.toLowerCase())) return setError(`You already have ${name}`);
    setRows(rs => [...rs, {cat: {id: "c" + uid(), name, budget: 0, fixed: false}, everyday: true, amount: ""}]);
    setAdding(""); setError("");
  };
  const save = () => {
    const next: Category[] = [];
    for (const r of rows) {
      const a = parseAmount(r.amount);
      if (r.everyday && !(a > 0)) return setError(`Add a monthly amount for ${r.cat.name}, or set it to Free`);
      next.push({...r.cat, group: r.everyday ? "everyday" : "free", budget: r.everyday ? r2(a) : 0});
    }
    const fixed = cats.filter(x => x.fixed);
    useMoney.getState().saveCategories([...fixed, ...next]);
    router.back();
    const total = next.filter(x => x.group === "everyday").reduce((sum, x) => sum + x.budget, 0);
    useMoney.getState().notify(total ? `${money(total)} a month kept aside for everyday` : "Everyday amounts cleared", !!total);
  };

  return (
    <Form error={error} submit="Save" onSubmit={save}>
      <T muted>{"Set what you spend on every month, like groceries or coffee. What's left of each amount is kept aside until payday, so your daily number shows what's truly free."}</T>
      {rows.map((r, i) => (
        <Card key={r.cat.id} style={{gap: s[3]}}>
          <T weight="bold" size={17}>{r.cat.name}</T>
          <Choice options={[{key: "every", label: "Everyday"}, {key: "free", label: "Free"}]} value={r.everyday ? "every" : "free"} onChange={k => set(i, {everyday: k === "every"})} />
          {r.everyday ? <Input prefix="£" value={r.amount} onChangeText={v => set(i, {amount: v})} keyboardType="decimal-pad" placeholder="A month" accessibilityLabel={`${r.cat.name} a month`} /> : null}
        </Card>
      ))}
      <View style={{flexDirection: "row", gap: s[3], alignItems: "center"}}>
        <View style={{flex: 1}}><Input value={adding} onChangeText={setAdding} placeholder="Add a category, e.g. Coffee" maxLength={30} onSubmitEditing={add} returnKeyType="done" /></View>
        <Button kind="ghost" small label="Add" onPress={add} />
      </View>
    </Form>
  );
}
