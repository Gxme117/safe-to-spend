import {router} from "expo-router";
import {useState} from "react";
import {ScrollView, View} from "react-native";
import {Choice} from "@/components/Form";
import {Button, Card, CardHead, Field, Input, Row, T} from "@/components/ui";
import {niceDate} from "@/lib/dates";
import {FREQ, lowAmt} from "@/lib/income";
import {money, parseAmount} from "@/lib/money";
import {useCalc} from "@/store/useCalc";
import {useMoney, type ThemePref} from "@/store/useMoney";
import {s} from "@/theme/tokens";

export default function SettingsScreen() {
  const r = useCalc();
  const theme = useMoney(st => st.theme);
  const [bal, setBal] = useState(r ? String(r.c.balance) : "");
  const [error, setError] = useState("");
  if (!r) return null;
  const {ctx, c} = r;

  const saveBalance = () => {
    const b = parseAmount(bal);
    if (Number.isNaN(b)) return setError("Enter your balance as a number, e.g. 1250.50");
    useMoney.getState().setBalance(b);
    router.back();
    useMoney.getState().notify(`Balance set to ${money(b)}`);
  };

  return (
    <ScrollView contentContainerStyle={{padding: s[4], gap: s[4], paddingBottom: s[7]}} keyboardShouldPersistTaps="handled">
      <Card>
        <CardHead title="Your balance" />
        <Field label="How much is in your account right now?" hint={`The balance your bank app shows. Last set ${niceDate(ctx.state.balanceAsOf)}. Payments you log after this change it.`}>
          <Input prefix="£" value={bal} onChangeText={v => { setBal(v); setError(""); }} keyboardType="decimal-pad" selectTextOnFocus accessibilityLabel="Your balance" />
        </Field>
        {error ? <T weight="semibold" size={14}>{error}</T> : null}
        <Button label="Update balance" onPress={saveBalance} />
      </Card>

      <Card>
        <CardHead title="Income" right={<Button small kind="ghost" label="Add" onPress={() => router.push("/income/new")} />} />
        {ctx.state.incomes.length ? (
          <View>
            {ctx.state.incomes.map(x => (
              <Row key={x.id} name={x.name} meta={`${x.freq === "oneoff" && x.date ? niceDate(x.date) : FREQ[x.freq]}${x.main ? ". Main pay" : ""}`}
                amount={`${x.varies ? "From " : ""}${money(lowAmt(x))}`} onPress={() => router.push(`/income/${x.id}`)} accessibilityHint="Edit this income" />
            ))}
          </View>
        ) : <T muted>No income yet. Your payday is worked out from it.</T>}
        {c.payday ? <T muted size={14}>Next payday: {niceDate(c.payday)}.</T> : null}
      </Card>

      <Card>
        <CardHead title="Everyday amounts" right={<Button small kind="ghost" label="Plan" onPress={() => router.push("/everyday")} />} />
        <T muted size={14}>{c.everyday.length ? `${money(c.everyday.reduce((a, e) => a + e.x.budget, 0))} a month across ${c.everyday.map(e => e.x.name).join(", ")}.` : "None set yet."}</T>
      </Card>

      <Card>
        <CardHead title="Appearance" />
        <Choice<ThemePref> options={[{key: "system", label: "Match phone"}, {key: "light", label: "Light"}, {key: "dark", label: "Dark"}]}
          value={theme} onChange={t => useMoney.getState().setTheme(t)} />
      </Card>

      <T muted size={13} style={{textAlign: "center"}}>Your data stays on this phone.</T>
    </ScrollView>
  );
}
