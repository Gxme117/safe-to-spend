import {router} from "expo-router";
import {useState} from "react";
import {Alert, ScrollView, View} from "react-native";
import {Choice} from "@/components/Form";
import {AccountantCard, BankSettings, DataCard, YouCard} from "@/components/Profile";
import {Button, Card, CardHead, Field, Input, PageTitle, Row, T} from "@/components/ui";
import {catGroup, savingPerPay} from "@/lib/calc";
import {cardTapFor} from "@/lib/cardTap";
import {niceDate} from "@/lib/dates";
import {FREQ, lowAmt} from "@/lib/income";
import {money, parseAmount} from "@/lib/money";
import type {Ctx, Tx} from "@/lib/types";
import {showCardTap} from "@/services/island";
import {useCalc} from "@/store/useCalc";
import {useMoney, type CardStyle, type FrankOpening, type FrankRoom, type ThemePref} from "@/store/useMoney";
import {parseHex} from "@/theme/color";
import {GLASS} from "@/theme/glass";
import {palettes, radius, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

/** What you put away a month. Each pay's share is held back from the daily number until it's moved; blank or 0 turns it off. */
function SavingsCard({ctx}: {ctx: Ctx}) {
  const [amt, setAmt] = useState(ctx.state.saving ? String(ctx.state.saving) : "");
  const [error, setError] = useState("");
  const per = savingPerPay(ctx);
  const save = () => {
    const a = amt.trim() ? parseAmount(amt) : 0;
    if (Number.isNaN(a) || a < 0) return setError("Enter an amount, e.g. 100");
    useMoney.getState().setSaving(a);
    useMoney.getState().notify(a > 0 ? `Saving ${money(a)} a month` : "Savings turned off");
  };
  return (
    <Card>
      <CardHead title="Savings" />
      <Field label="How much do you want to put away each month?"
        hint={`Held back from your daily number each pay until it's moved to savings.${per && ctx.state.saving !== per ? ` That's ${money(per)} each pay.` : ""}`}>
        <Input prefix="£" value={amt} onChangeText={v => { setAmt(v); setError(""); }} keyboardType="decimal-pad" selectTextOnFocus placeholder="0" accessibilityLabel="Savings each month" />
      </Field>
      {error ? <T weight="semibold" size="sm">{error}</T> : null}
      <Button label="Save" onPress={save} />
    </Card>
  );
}

export default function SettingsScreen() {
  const r = useCalc();
  const theme = useMoney(st => st.theme), cardStyle = useMoney(st => st.cardStyle), frankRoom = useMoney(st => st.frankRoom), frankOpening = useMoney(st => st.frankOpening);
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

      <SavingsCard ctx={ctx} />

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
        <Field label="Frank's background" hint="In dark mode. Office puts square lights hanging behind him.">
          <Choice<FrankRoom> options={[{key: "plain", label: "Plain"}, {key: "office", label: "Office"}]}
            value={frankRoom} onChange={v => useMoney.getState().setFrankRoom(v)} />
        </Field>
        <Field label="Frank's opening" hint="In light mode. Animation is being tried out: one of his openings, fully animated.">
          <Choice<FrankOpening> options={[{key: "picture", label: "Picture"}, {key: "animation", label: "Animation"}]}
            value={frankOpening} onChange={v => useMoney.getState().setFrankOpening(v)} />
        </Field>
        <AccentField />
      </Card>

      <AccountantCard />

      <DataCard />

      {__DEV__ ? <IslandTry ctx={ctx} /> : null}
      {__DEV__ ? <OrganiseTry /> : null}
    </ScrollView>
  );
}

/** Development only: shows the card island for a made-up payment today (counted as if it happened), so both kinds can be
 *  tried without spending. Nothing is saved. */
function IslandTry({ctx}: {ctx: Ctx}) {
  const show = (budget: boolean) => {
    const cat = budget ? ctx.state.categories.find(x => catGroup(x) === "everyday" && x.budget > 0) : undefined;
    const t: Tx = {id: "island-try", type: "expense", amount: cat ? 14.2 : 11.99, cat: cat?.id ?? "other", note: cat ? "Tesco" : "Amazon",
      date: ctx.today, created: Date.now(), paidAt: Date.now(), monzoId: "island-try"};
    const p = cardTapFor({...ctx, txs: [...ctx.txs, t]}, t, Date.now());
    const {speaks, aiConsent} = useMoney.getState();
    if (p) void showCardTap(p, {speaks: speaks && aiConsent}); else useMoney.getState().notify("No daily number today, so there's nothing to show");
  };
  return (
    <Card>
      <CardHead title="Card island (development)" />
      <Button label="Show it for a budget" onPress={() => show(true)} />
      <Button kind="ghost" label="Show it for anything else" onPress={() => show(false)} />
    </Card>
  );
}

// Seed data: realistic UK payments across a range of categories, all needing organisation.
const SEED_PAYMENTS: {note: string; amount: number; daysAgo: number}[] = [
  {note: "TESCO STORES", amount: 42.17, daysAgo: 1},
  {note: "TESCO STORES", amount: 11.84, daysAgo: 4},
  {note: "SAINSBURYS", amount: 67.30, daysAgo: 7},
  {note: "MCDONALDS", amount: 8.99, daysAgo: 2},
  {note: "DELIVEROO", amount: 23.50, daysAgo: 5},
  {note: "COSTA COFFEE", amount: 4.75, daysAgo: 3},
  {note: "COSTA COFFEE", amount: 5.10, daysAgo: 10},
  {note: "SPOTIFY", amount: 11.99, daysAgo: 8},
  {note: "AMAZON.CO.UK", amount: 34.99, daysAgo: 6},
  {note: "AMAZON.CO.UK", amount: 12.49, daysAgo: 12},
  {note: "BOOTS", amount: 18.60, daysAgo: 9},
  {note: "TFL TRAVEL", amount: 35.00, daysAgo: 2},
  {note: "SHELL OIL", amount: 68.40, daysAgo: 11},
  {note: "ODEON CINEMAS", amount: 22.00, daysAgo: 14},
  {note: "PET SUPPLIES PLUS", amount: 29.99, daysAgo: 13},
];

/** Development only: run Frank's bulk classification on all needsCat payments and show the preview before applying. */
function OrganiseTry() {
  const seed = async () => {
    const st = useMoney.getState();
    const today = st.today;
    const [y, m, d] = today.split("-").map(Number);
    let added = 0;
    for (const p of SEED_PAYMENTS) {
      const date = new Date(y, m - 1, d - p.daysAgo);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const tx: Omit<Tx, "id" | "created"> = {
        type: "expense", amount: p.amount, cat: "other", note: p.note,
        date: iso as Tx["date"], needsCat: true,
      };
      const ok = await st.addTx(tx);
      if (ok) added++;
    }
    st.notify(`Added ${added} unorganised payments — ask Frank to organise them`);
  };

  const run = async () => {
    const result = await useMoney.getState().buildOrganisation();
    if (result === null) { useMoney.getState().notify("Nothing to organise right now"); return; }
    if (typeof result === "string") { useMoney.getState().notify(result); return; }
    const {preview, apply} = result;
    Alert.alert(
      "Organise payments",
      `${preview.high} high confidence · ${preview.medium} medium · ${preview.low} couldn't tell${preview.more > 0 ? ` · ${preview.more} more` : ""}`,
      [
        {text: "Cancel", style: "cancel"},
        {text: `Organise ${preview.high + preview.medium}`, onPress: () => void apply(new Set())},
      ],
    );
  };
  return (
    <Card>
      <CardHead title="Organisation (development)" />
      <Button label="Show the Smart Sort card (no AI)" onPress={() => router.push("/org-demo")} />
      <Button label="Seed 15 unorganised payments" onPress={() => void seed()} />
      <Button kind="ghost" label="Play Smart Organisation screen (no AI)" onPress={() => router.navigate({pathname: "/tim", params: {who: "frank", org: String(Date.now())}})} />
      <Button kind="ghost" label="Organise needsCat payments" onPress={() => void run()} />
    </Card>
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
            style={{width: 44, height: 44, borderRadius: radius.control, borderCurve: "continuous", borderWidth: 1, borderColor: c.line, backgroundColor: hex ?? c.surface}} />
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
