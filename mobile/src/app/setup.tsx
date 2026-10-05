import {router} from "expo-router";
import {StatusBar} from "expo-status-bar";
import {useState} from "react";
import {Keyboard, StyleSheet, View} from "react-native";
import {syncNow} from "@/components/Bank";
import {BillSheet, SpendSheet, SubscriptionsSheet} from "@/components/BillSheet";
import {DateField} from "@/components/DateField";
import {Choice, Picks} from "@/components/Form";
import {AmountInput, AmountRow, StepShell, TextLink} from "@/components/Setup";
import {Button, Chip, Field, Row, T} from "@/components/ui";
import {BILL_FREQ, billMonthly, billWhen, draftBill, draftReady, newDraft, type BillDraft} from "@/lib/bills";
import {DEFAULT_CATEGORIES, uid} from "@/lib/defaults";
import {niceDate} from "@/lib/dates";
import {budgetOf, budgetText, EVERYDAY, everydayCats, newSpend, perWeek, SPEND_FREQ, spendMonthly, spendReady, type SpendDraft} from "@/lib/everyday";
import {payRuleText} from "@/lib/found";
import {buildIncome, FREQ, needsDate} from "@/lib/income";
import {money, parseAmount, r2} from "@/lib/money";
import {perPayday, yearlyTakeHome, type PayBasis} from "@/lib/pay";
import type {Bill, Category, Income, IncomeFreq} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";
import {FixedTheme, useTheme} from "@/theme/useTheme";

// Regular pay only: a one-off isn't a payday.
const FREQS = (Object.keys(FREQ) as IncomeFreq[]).filter(k => k !== "oneoff").map(k => ({key: k, label: FREQ[k]}));

// However they know their pay. Hour and year are before tax, so we estimate what lands.
const BASES: {key: PayBasis; label: string}[] = [{key: "hour", label: "An hour"}, {key: "week", label: "A week"}, {key: "month", label: "A month"}, {key: "year", label: "A year"}];
const CAPTION: Record<PayBasis, string> = {hour: "an hour", week: "a week, after tax", month: "a month, after tax", year: "a year, before tax"};

// To jog your memory, so nobody starts from a blank page. Home first, then the home's bills, phone and internet, the car, then the rest.
// Names only: no logos or brand colours.
const SUBS = "Subscriptions";   // added up from the ones you have, on its own sheet
const BILLS = ["Rent / mortgage", "Council tax", "Electricity", "Gas", "Water", "Phone", "Internet", "Car insurance", "Car finance", SUBS, "Loans", "Gym"];
const SPENDS = EVERYDAY.map(x => x.name);

// 0 balance, 1 pay, 2 payday, 3 fixed bills, 4 your bills, 5 everyday, 6 what you normally spend, 7 your limits
const TOTAL = 8;

/** "+ Add more": a usual one typed out ("council tax") is just picked, not added twice. */
function addName(typed: string, usual: string[], own: string[], picked: string[]) {
  const name = typed.trim(), same = [...usual, ...own].find(n => n.toLowerCase() === name.toLowerCase()) ?? name;
  return {own: [...usual, ...own].includes(same) ? own : [...own, same], picked: picked.includes(same) ? picked : [...picked, same]};
}

/** Setup is dark for now, whatever the theme setting (the app after it follows the setting). */
export default function SetupScreen() {
  return (
    <FixedTheme value="dark">
      <StatusBar style="light" />
      <Setup />
    </FixedTheme>
  );
}

/**
 * First run: one question per page. Balance, pay, payday: enough for a real daily number.
 * Then the fixed bills you pay, picked from a list, and how much each one is and when it goes out.
 * Then everyday spending: what you spend on, roughly how much (an estimate is fine), and what you'll allow yourself a month.
 * Nothing is saved until the end, so going back never loses an answer.
 * A bank connected on the first page fills in pay and payday from your payments, ready to check.
 */
function Setup() {
  const {c} = useTheme();
  const today = useMoney(st => st.today);
  const [step, setStep] = useState(0);
  const [bal, setBal] = useState("");
  const [basis, setBasis] = useState<PayBasis>("month");
  const [typed, setPay] = useState<Partial<Record<PayBasis, string>>>({});   // only what you typed
  const [hours, setHours] = useState("");
  const [freq, setFreq] = useState<IncomeFreq>("monthly-lastworking");
  const [date, setDate] = useState(today);
  const [bills, setBills] = useState<string[]>([]);   // the fixed bills you pay: the next page asks how much each one is
  const [own, setOwn] = useState<string[]>([]);       // ones you named yourself, after the usual ones
  const [naming, setNaming] = useState<string | null>(null);   // "Add more" is open, with what's typed so far
  const [amounts, setAmounts] = useState<Record<string, BillDraft>>({});   // each bill's figures, by name: unpicking one and picking it again keeps them
  const [sheet, setSheet] = useState<{name: string; n: number; shown: boolean} | null>(null);   // the bill being filled in (kept while its sheet slides away)
  const [spends, setSpends] = useState<string[]>([]);   // what you spend on: the next page asks roughly how much
  const [spendOwn, setSpendOwn] = useState<string[]>([]);
  const [spendNaming, setSpendNaming] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SpendDraft>>({});   // each one's estimate and budget, by name: kept like the bills'
  const [spendSheet, setSpendSheet] = useState<{name: string; n: number; shown: boolean} | null>(null);
  const [error, setError] = useState("");
  const fromBank = useMoney(st => st.setupBank);   // set once Monzo is connected from the first question
  const found = useMoney(st => st.setupFound);    // what your payments say, from the same connection
  const seen = found?.pay ?? null;                // your last pay
  const seenPay = seen ? seen.amount.toFixed(2) : "";
  const [seeded, setSeeded] = useState(false);
  // the monthly box shows your last pay until you type in it
  const pay: Record<PayBasis, string> = {hour: "", week: "", year: "", ...typed, month: typed.month ?? seenPay};
  const keptPay = !!seen && basis === "month" && pay.month === seenPay;

  const b = fromBank ?? parseAmount(bal), p = parseAmount(pay[basis]), h = parseAmount(hours);
  const payOk = p > 0 && (basis !== "hour" || (h > 0 && h <= 100));
  const yearly = payOk ? yearlyTakeHome(basis, p, h) : 0;
  const estimated = basis === "hour" || basis === "year";
  const go = (n: number) => { setError(""); if (n >= 2) Keyboard.dismiss(); setStep(n); };   // from payday on, nothing is typed straight away
  const back = step > 0 ? () => go(step - 1) : undefined;
  // once, leaving the first page: the payday Monzo found becomes the starting answer (still yours to change)
  const seed = () => {
    if (!found || seeded) return;
    setSeeded(true);
    if (found.rule) { setFreq(found.rule.freq); setDate(found.rule.date); }
  };

  // the protected route then opens the app; a bank connected here brings in pots and payments straight away
  const done = (src?: Income, list?: Bill[], cats?: Category[]) => {
    useMoney.getState().setup(b, src, list, cats);
    if (fromBank !== null) syncNow();
  };
  const income = () => {
    const r = buildIncome({name: "Pay", type: "work", freq, date, varies: false, amount: perPayday(yearly, freq), low: NaN, typical: NaN, main: true}, undefined, "i" + uid(), today);
    // who pays you, so a synced pay counts as payday arriving: only when it's clearly your pay (it repeats, or you kept it)
    return "src" in r && seen && (found?.rule || keptPay) ? {src: {...r.src, payer: seen.from}} : r;
  };

  // the bills you picked, in the list's order (home first), each with what's been filled in so far
  const picked = [...BILLS, ...own].filter(n => bills.includes(n));
  const draftOf = (n: string) => amounts[n] ?? newDraft();
  const monthly = r2(picked.reduce((a, n) => a + (draftReady(draftOf(n)) ? billMonthly(draftBill(n, draftOf(n), "")) : 0), 0));
  const shares = picked.some(n => draftReady(draftOf(n)) && draftOf(n).freq !== "monthly");
  const allIn = picked.every(n => draftReady(draftOf(n)));   // every amount is in: Continue lights up in the accent, the way to your number

  // what you spend on, in the list's order, each with its estimate and budget so far
  const spendPicked = [...SPENDS, ...spendOwn].filter(n => spends.includes(n));
  const spendOf = (n: string) => drafts[n] ?? newSpend(n);
  const setSpend = (n: string, p: Partial<SpendDraft>) => setDrafts(a => ({...a, [n]: {...(a[n] ?? newSpend(n)), ...p}}));
  const spendAllIn = spendPicked.every(n => spendReady(spendOf(n)));
  const everyday = r2(spendPicked.reduce((a, n) => a + budgetOf(spendOf(n)), 0));

  // the end: pay, the bills, and everyday as categories (none picked: the starting ones, as they were)
  const finish = (spendList = spendPicked) => {
    const r = income();
    if ("error" in r) return setError(r.error);
    const cats = spendList.length ? everydayCats(DEFAULT_CATEGORIES, spendList.map(name => ({name, draft: spendOf(name)})), uid) : undefined;
    done(r.src, picked.map(n => draftBill(n, draftOf(n), "b" + uid())), cats);
  };

  const addOwn = () => {
    if (!(naming ?? "").trim()) return;
    const r = addName(naming ?? "", BILLS, own, bills);
    setOwn(r.own); setBills(r.picked);
    Keyboard.dismiss();
    setNaming(null);
  };
  const addSpend = () => {
    if (!(spendNaming ?? "").trim()) return;
    const r = addName((spendNaming ?? "").slice(0, 30), SPENDS, spendOwn, spends);
    setSpendOwn(r.own); setSpends(r.picked);
    Keyboard.dismiss();
    setSpendNaming(null);
  };

  if (step === 0) return (
    <StepShell step={0} total={TOTAL} title="How much is in your account right now?"
      cta="Continue" canNext={!Number.isNaN(b)} onNext={() => { seed(); go(1); }}>
      {fromBank === null ? (
        <View style={{gap: s[6]}}>
          <View style={{gap: s[3]}}>
            <Button label="Connect your bank" kind="good" onPress={() => { Keyboard.dismiss(); router.push("/connect-bank?from=setup"); }} />
            <T size="sm" muted style={{textAlign: "center"}}>or enter it below</T>
          </View>
          <AmountInput key="bal" autoFocus={false} value={bal} onChangeText={setBal} caption={<>...pots and all. <T size="sm" muted weight="bold">“EVERYTHING”</T>.</>}
            accessibilityLabel="Your balance" />
        </View>
      ) : (
        <AmountInput key="bank" autoFocus={false} editable={false} value={fromBank.toFixed(2)} caption="Your Monzo account and all its pots, just now."
          accessibilityLabel="Your balance, from Monzo" />
      )}
    </StepShell>
  );

  if (step === 1) return (
    <StepShell step={1} total={TOTAL} title="How much are you paid?" why="Pick the way you know it. We'll work out the rest."
      onBack={back} cta="Continue" canNext={payOk} onNext={() => go(2)}
      footer={<TextLink label="I'm not paid regularly" onPress={() => done()} />}>
      <View style={{gap: s[5]}}>
        <Choice options={BASES} value={basis} onChange={setBasis} />
        {basis === "hour" ? (
          <View style={{flexDirection: "row", gap: s[5]}}>
            <View style={{flex: 1}}>
              <AmountInput key="hour" size="xl" caption={CAPTION.hour} value={pay.hour} onChangeText={v => setPay({...typed, hour: v})} accessibilityLabel="Your pay an hour, before tax" />
            </View>
            <View style={{flex: 1}}>
              <AmountInput prefix="" isMoney={false} size="xl" caption="hours a week" autoFocus={false} value={hours} onChangeText={setHours} accessibilityLabel="Hours you work a week" />
            </View>
          </View>
        ) : (
          <AmountInput key={basis} caption={CAPTION[basis]} value={pay[basis]} onChangeText={v => setPay({...typed, [basis]: v})} accessibilityLabel={`Your pay ${CAPTION[basis]}`} />
        )}
        {keptPay && seen ? (
          <T size="sm" muted lines={1}>Your last pay from {seen.from}, {niceDate(seen.date)}.</T>
        ) : null}
        {estimated && payOk ? (
          <T size="sm" muted><T size="sm" weight="bold" style={{color: c.good}}>About {money(Math.round(yearly / 12))} a month</T> after tax and National Insurance</T>
        ) : null}
      </View>
    </StepShell>
  );

  if (step === 2) return (
    <StepShell step={2} total={TOTAL} title="When are you paid?" why="So your money is spread evenly until payday."
      onBack={back} keyboard={false} cta="Continue" canNext onNext={() => { const r = income(); if ("error" in r) setError(r.error); else go(3); }} error={error}>
      <View style={{gap: s[5]}}>
        <Choice options={FREQS} value={freq} onChange={f => { setFreq(f); setError(""); }} />
        {found?.rule && freq === found.rule.freq ? <T size="sm" muted lines={1}>{payRuleText(found.rule)}</T> : null}
        <T size="sm" muted>{"That's "}<T size="sm" weight="bold" style={{color: c.good}}>{estimated ? "about " : ""}{money(perPayday(yearly, freq))}</T> each payday{estimated ? ". You'll confirm it when it lands." : "."}</T>
        {needsDate(freq) ? <Field label="Next payday"><DateField label="Next payday" value={date} onChange={setDate} min={today} /></Field> : null}
      </View>
    </StepShell>
  );

  if (step === 4) return (
    <StepShell key="amounts" step={4} total={TOTAL} scroll keyboard={false} title="Your bills" why="How much do you pay?"
      onBack={back} cta="Continue" ctaKind={allIn ? "good" : "primary"} canNext onNext={() => go(5)} error={error}>
      <View>
        {picked.map(n => {
          const d = draftOf(n), bill = draftBill(n, d, ""), ready = draftReady(d);
          // subscriptions say which ones they are
          const meta = !ready ? "Add amount" : d.items?.length ? d.items.map(x => x.name).join(", ") : [billWhen(bill), BILL_FREQ[d.freq]].filter(Boolean).join(" · ");
          return <Row key={n} name={n} meta={meta}
            amount={ready ? money(bill.amount) : undefined} onPress={() => setSheet({name: n, n: (sheet?.n ?? 0) + 1, shown: true})} />;
        })}
        <View style={{flexDirection: "row", alignItems: "center", gap: s[3], paddingTop: s[4], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line}}>
          <T weight="semibold" style={{flex: 1}}>Total each month</T>
          <T weight="heavy" size="lg" style={{fontVariant: ["tabular-nums"]}}>{money(monthly)}</T>
        </View>
        {shares ? <T size="sm" muted lines={1} style={{marginTop: s[1]}}>Bills that aren&apos;t monthly count as a month&apos;s share.</T> : null}
      </View>
      {sheet?.name === SUBS ? (
        <SubscriptionsSheet key={sheet.n} draft={draftOf(SUBS)} visible={sheet.shown}
          onChange={d => setAmounts(a => ({...a, [SUBS]: d}))} onClose={() => setSheet({...sheet, shown: false})} />
      ) : sheet ? (
        <BillSheet key={sheet.n} name={sheet.name} draft={draftOf(sheet.name)} visible={sheet.shown} today={today}
          onChange={d => setAmounts(a => ({...a, [sheet.name]: d}))} onClose={() => setSheet({...sheet, shown: false})} />
      ) : null}
    </StepShell>
  );

  if (step === 5 && spendNaming !== null) return (
    <StepShell key="add-spend" step={5} total={TOTAL} title="What else do you spend on?"
      onBack={() => { Keyboard.dismiss(); setSpendNaming(null); }} cta="Add" canNext={!!spendNaming.trim()} onNext={addSpend}>
      <AmountInput prefix="" isMoney={false} keyboardType="default" autoCapitalize="sentences" autoCorrect={false} placeholder="e.g. Pets" maxLength={30}
        value={spendNaming} onChangeText={setSpendNaming} onSubmitEditing={addSpend} accessibilityLabel="What else you spend on" />
    </StepShell>
  );

  // no amounts here: just what you spend on (with no bills, back goes to the bills you can pick)
  if (step === 5) return (
    <StepShell key="spend" step={5} total={TOTAL} title="What do you spend on regularly?" why="Pick anything that applies. We'll help you work out the rest."
      onBack={() => go(picked.length ? 4 : 3)} keyboard={false} cta="Continue" canNext={spends.length > 0} onNext={() => go(6)} error={error}
      footer={<TextLink label="Skip for now" onPress={() => finish([])} />}>
      <Picks options={[...SPENDS, ...spendOwn]} value={spends} onChange={setSpends}>
        <Chip label="+ Add more" accessibilityLabel="Add more" onPress={() => setSpendNaming("")} />
      </Picks>
    </StepShell>
  );

  if (step === 6) return (
    <StepShell key="usual" step={6} total={TOTAL} scroll keyboard={false} title="What do you normally spend?" why="An estimate is fine. We'll turn it into a realistic budget."
      onBack={back} cta="Continue" ctaKind={spendAllIn ? "good" : "primary"} canNext onNext={() => go(7)}>
      <View style={{borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line}}>
        {spendPicked.map(n => {
          const d = spendOf(n), ready = spendReady(d);
          return <Row key={n} name={n} meta={ready ? SPEND_FREQ[d.freq] : "Add amount"} amount={ready ? money(parseAmount(d.amount)) : undefined}
            onPress={() => setSpendSheet({name: n, n: (spendSheet?.n ?? 0) + 1, shown: true})} />;
        })}
      </View>
      {spendSheet ? (
        <SpendSheet key={spendSheet.n} name={spendSheet.name} draft={spendOf(spendSheet.name)} visible={spendSheet.shown}
          onChange={d => setDrafts(a => ({...a, [spendSheet.name]: d}))} onClose={() => setSpendSheet({...spendSheet, shown: false})} />
      ) : null}
    </StepShell>
  );

  // each budget starts at what you usually spend: lower it or not, it's your call
  if (step === 7) return (
    <StepShell key="limits" step={7} total={TOTAL} scroll keyboard={false} title="Set your limits" why="Based on what you normally spend, choose what you want to allow yourself."
      onBack={back} cta="Continue" ctaKind="good" canNext onNext={() => finish()} error={error}>
      <View>
        {spendPicked.map(n => {
          const usual = spendMonthly(spendOf(n));
          return <AmountRow key={n} name={n} meta={usual > 0 ? `Usually about ${money(Math.round(usual))} a month` : "No estimate yet"}
            value={budgetText(spendOf(n))} onChange={budget => setSpend(n, {budget})} accessibilityLabel={`Your ${n} budget a month`} />;
        })}
        <View style={{flexDirection: "row", alignItems: "center", gap: s[3], paddingTop: s[4], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line}}>
          <T weight="semibold" style={{flex: 1}}>Everyday spending</T>
          <T weight="heavy" size="lg" style={{fontVariant: ["tabular-nums"]}}>{money(everyday)}</T>
        </View>
        {everyday > 0 ? <T size="sm" muted lines={1} style={{marginTop: s[1]}}>Each month, about {money(Math.round(perWeek(everyday)))} a week.</T> : null}
      </View>
    </StepShell>
  );

  if (naming !== null) return (
    <StepShell key="add" step={3} total={TOTAL} title="What else do you pay regularly?"
      onBack={() => { Keyboard.dismiss(); setNaming(null); }} cta="Add" canNext={!!naming.trim()} onNext={addOwn}>
      <AmountInput prefix="" isMoney={false} keyboardType="default" autoCapitalize="sentences" autoCorrect={false} placeholder="e.g. Pet insurance" maxLength={40}
        value={naming} onChangeText={setNaming} onSubmitEditing={addOwn} accessibilityLabel="What else you pay regularly" />
    </StepShell>
  );

  return (
    <StepShell key="bills" step={3} total={TOTAL} title="Fixed bills" why="Which of these do you pay regularly?"
      onBack={back} keyboard={false} cta="Continue" canNext={bills.length > 0} onNext={() => go(4)} error={error}
      footer={<TextLink label="I don't have any bills" onPress={() => { setBills([]); go(5); }} />}>
      <Picks options={[...BILLS, ...own]} value={bills} onChange={setBills}>
        <Chip label="+ Add more" accessibilityLabel="Add more" onPress={() => setNaming("")} />
      </Picks>
    </StepShell>
  );
}
