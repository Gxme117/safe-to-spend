import {router} from "expo-router";
import {useState} from "react";
import {ScrollView, View} from "react-native";
import {Choice} from "@/components/Form";
import {BankSettings, DataCard, YouCard} from "@/components/Profile";
import {Button, Card, CardHead, Field, Input, PageTitle, Row, T} from "@/components/ui";
import {niceDate} from "@/lib/dates";
import {FREQ, lowAmt} from "@/lib/income";
import {money, parseAmount} from "@/lib/money";
import {useCalc} from "@/store/useCalc";
import {useMoney, type CardStyle, type ThemePref} from "@/store/useMoney";
import {parseHex} from "@/theme/color";
import {GLASS} from "@/theme/glass";
import {palettes, radius, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

export default function SettingsScreen() {
  const r = useCalc();
  const theme = useMoney(st => st.theme), cardStyle = useMoney(st => st.cardStyle);
  const [bal, setBal] = useState(r ? String(r.c.balance) : "");
  const [error, setError] = useState("");
  if (!r) return null;
  const {ctx, c} = r;

  const saveBalance = () => {
    const b = parseAmount(bal);
    if (Number.isNaN(b)) return setError("Enter your balance as a number, e.g. 1250.50");
    useMoney.getState().setBalance(b);
    useMoney.getState().notify(`Balance set to ${money(b)}`);
  };

  return (
    <ScrollView contentContainerStyle={{padding: s[4], paddingTop: s[2], gap: s[4], paddingBottom: s[7]}} keyboardShouldPersistTaps="handled">
      <PageTitle>Settings</PageTitle>
      <YouCard />
      <Card>
        <CardHead title="Your balance" />
        <Field label="How much is in your account right now?" hint={`The balance your bank app shows. Last set ${niceDate(ctx.state.balanceAsOf)}. Payments you log after this change it.${ctx.state.bank ? " Your next Monzo sync replaces it." : ""}`}>
          <Input prefix="£" value={bal} onChangeText={v => { setBal(v); setError(""); }} keyboardType="decimal-pad" selectTextOnFocus accessibilityLabel="Your balance" />
        </Field>
        {error ? <T weight="semibold" size="sm">{error}</T> : null}
        <Button label="Update balance" onPress={saveBalance} />
      </Card>

      <BankSettings />

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
        {c.payday ? <T muted size="sm">Next payday: {niceDate(c.payday)}.</T> : null}
      </Card>

      <Card>
        <CardHead title="Everyday amounts" right={<Button small kind="ghost" label="Plan" onPress={() => router.push("/everyday")} />} />
        <T muted size="sm">{c.everyday.length ? `${money(c.everyday.reduce((a, e) => a + e.x.budget, 0))} a month across ${c.everyday.map(e => e.x.name).join(", ")}.` : "None set yet."}</T>
      </Card>

      <Card>
        <CardHead title="Appearance" />
        <Choice<ThemePref> options={[{key: "system", label: "Match phone"}, {key: "light", label: "Light"}, {key: "dark", label: "Dark"}]}
          value={theme} onChange={t => useMoney.getState().setTheme(t)} />
        {/* only phones with Liquid Glass (iOS 26) get the choice */}
        {GLASS ? (
          <Field label="Safe to Spend card" hint="Colour uses your accent colour. Glass lets the page show through.">
            <Choice<CardStyle> options={[{key: "colour", label: "Colour"}, {key: "glass", label: "Glass"}]}
              value={cardStyle} onChange={v => useMoney.getState().setCardStyle(v)} />
          </Field>
        ) : null}
        <AccentField />
      </Card>

      <DataCard />
    </ScrollView>
  );
}

/** Your own accent colour, as a hex code. The swatch shows it as you type; the default is the app's mint. */
function AccentField() {
  const {c} = useTheme();
  const saved = useMoney(st => st.accent);
  const [text, setText] = useState(saved ?? palettes.light.accent);
  const [error, setError] = useState("");
  const hex = parseHex(text);
  const apply = () => {
    if (!hex) return setError("Enter a hex colour, like #C3EADA");
    useMoney.getState().setAccent(hex === palettes.light.accent ? null : hex);
    setText(hex);
    useMoney.getState().notify(`Accent colour set to ${hex}`);
  };
  const reset = () => { useMoney.getState().setAccent(null); setText(palettes.light.accent); setError(""); };
  return (
    <>
      <Field label="Accent colour" hint="The colour of your daily number's card. A hex code, like #C3EADA.">
        <View style={{flexDirection: "row", alignItems: "center", gap: s[3]}}>
          <View accessible accessibilityRole="image" accessibilityLabel={hex ? `Preview, ${hex}` : "No preview yet"}
            style={{width: 44, height: 44, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, backgroundColor: hex ?? c.surface}} />
          <View style={{flex: 1}}>
            <Input prefix="#" value={text.replace(/^#/, "")} onChangeText={v => { setText(v); setError(""); }} autoCapitalize="characters" autoCorrect={false}
              maxLength={7} returnKeyType="done" onSubmitEditing={apply} accessibilityLabel="Accent colour hex code" />
          </View>
        </View>
      </Field>
      {error ? <T weight="semibold" size="sm">{error}</T> : null}
      <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
        <Button label="Apply colour" onPress={apply} disabled={!text.trim() || hex === (saved ?? palettes.light.accent)} />
        {saved ? <Button kind="ghost" label="Reset to default" onPress={reset} /> : null}
      </View>
    </>
  );
}
