import {router} from "expo-router";
import {StatusBar} from "expo-status-bar";
import {useEffect, useRef, useState} from "react";
import {Keyboard, StyleSheet, View} from "react-native";
import {syncNow} from "@/components/Bank";
import {BillSheet, SpendSheet, SubscriptionsSheet} from "@/components/BillSheet";
import {DateField} from "@/components/DateField";
import {Icon} from "@/components/Icon";
import {Choice, Picks} from "@/components/Form";
import {AmountInput, AmountRow, StepShell, TextLink} from "@/components/Setup";
import {Button, Chip, Field, Input, Row, T} from "@/components/ui";
import {BILL_FREQ, billMonthly, billWhen, draftBill, draftReady, newDraft, type BillDraft} from "@/lib/bills";
import {DEFAULT_CATEGORIES, uid} from "@/lib/defaults";
import {niceDate} from "@/lib/dates";
import {budgetOf, budgetText, EVERYDAY, everydayCats, newSpend, perWeek, SPEND_FREQ, spendMonthly, spendReady, type SpendDraft} from "@/lib/everyday";
import {payRuleText, type FoundBill, type FoundIncome, type FoundPayee} from "@/lib/found";
import {buildIncome, FREQ, needsDate} from "@/lib/income";
import {money, parseAmount, r2} from "@/lib/money";
import {perPayday, yearlyTakeHome, type PayBasis} from "@/lib/pay";
import type {Bill, Category, Income, IncomeFreq} from "@/lib/types";
import {fetchSetupBank, loggedIn} from "@/services/monzo";
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
// (with a bank: 3 first offers to connect one, and 8 is the review, shown as the last step)
const TOTAL = 8;

/** "+ Add more": a usual one typed out ("council tax") is just picked, not added twice. `name`: the one it's kept as. */
function addName(typed: string, usual: string[], own: string[], picked: string[]) {
  const name = typed.trim(), same = [...usual, ...own].find(n => n.toLowerCase() === name.toLowerCase()) ?? name;
  return {own: [...usual, ...own].includes(same) ? own : [...own, same], picked: picked.includes(same) ? picked : [...picked, same], name: same};
}

// "Monthly, last working day", or when it last landed if how often isn't clear
const payMeta = (p: FoundIncome) => p.rule ? FREQ[p.rule.freq] : `Last paid ${niceDate(p.date)}`;

// a bill the bank found, or one you picked from your payments, as its figures in setup: still yours to change
const foundDraft = (f: FoundBill): BillDraft =>
  ({amount: String(f.amount), freq: f.freq, day: f.day ?? null, date: f.date ?? null, payee: f.payee, method: f.method, ...(f.varies ? {varies: true} : {})});
const payeeMeta = (x: FoundPayee) => x.n > 1 ? `${x.n} payments, the last on ${niceDate(x.last)}` : `Paid ${niceDate(x.last)}`;

/** A tick for a list you pick from: ink, not the accent, since picking isn't money arriving. */
function Tick({on}: {on: boolean}) {
  const {c} = useTheme();
  return (
    <View style={{width: 24, height: 24, borderRadius: 12, borderCurve: "continuous", borderWidth: on ? 0 : 1.5, borderColor: c.muted, backgroundColor: on ? c.ink : "transparent", alignItems: "center", justifyContent: "center"}}>
      {on ? <Icon name="check" color={c.bg} size={16} /> : null}
    </View>
  );
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
 * A bank connected on the first page offers your pay to confirm and fills in payday. Connected then or just before the bills,
 * it fills in the regular payments and what you usually spend, ready to check, and setup ends with a short review.
 * The bank says what's happening; you say what you want; nothing it found counts until you've seen it.
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
  const [own, setOwn] = useState<string[]>([]);       // ones you named yourself (or the bank found), after the usual ones
  const [naming, setNaming] = useState<string | null>(null);   // "Add more" is open, with what's typed so far
  const [amounts, setAmounts] = useState<Record<string, BillDraft>>({});   // each bill's figures, by name: unpicking one and picking it again keeps them
  const [sheet, setSheet] = useState<{name: string; n: number; shown: boolean} | null>(null);   // the bill being filled in (kept while its sheet slides away)
  const [spends, setSpends] = useState<string[]>([]);   // what you spend on: the next page asks roughly how much
  const [spendOwn, setSpendOwn] = useState<string[]>([]);
  const [spendNaming, setSpendNaming] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SpendDraft>>({});   // each one's estimate and budget, by name: kept like the bills'
  const [spendSheet, setSpendSheet] = useState<{name: string; n: number; shown: boolean} | null>(null);
  const [error, setError] = useState("");
  const fromBank = useMoney(st => st.setupBank);   // set once Monzo is connected, from the first question or before the bills
  const found = useMoney(st => st.setupFound);    // what your payments say, from the same connection
  const pays = found?.pays ?? [];
  const [ownPay, setOwnPay] = useState(false);     // "I'll enter it myself" (or typed before a bank was connected): the pay page asks
  const [choosing, setChoosing] = useState(false);  // "Choose another" is open
  const [which, setWhich] = useState(0);            // the pay the bank found that's on show
  const [payFrom, setPayFrom] = useState<number | null>(null);    // the one you said is your pay: what lands each payday
  const [ruleFor, setRuleFor] = useState<number | null>(null);    // payday has been filled in from that one's pays
  const [manual, setManual] = useState(false);      // "I'll enter them myself": no bank for the bills
  const [seeded, setSeeded] = useState(false);      // the bills and spending the bank found are in the lists
  const [lastBank, setLastBank] = useState(fromBank);
  const [picking, setPicking] = useState<string[] | null>(null);   // "Pick from your payments" is open, with the ones ticked so far
  const [search, setSearch] = useState("");
  const payees = found?.payees ?? [];
  const [reading, setReading] = useState(false);    // reading from a Monzo login saved before

  // Start over keeps your Monzo login: read from it straight away, as if you'd just connected (only while you're on the first page)
  const at = useRef(step);
  useEffect(() => { at.current = step; }, [step]);
  useEffect(() => {
    if (useMoney.getState().setupBank !== null) return;
    let live = true;
    loggedIn().then(async yes => {
      if (!yes || !live) return;
      setReading(true);
      const r = await fetchSetupBank();
      if (live && at.current === 0) useMoney.getState().setSetupBank(r.totalPence / 100, r.found);
    }).catch(() => {}).finally(() => { if (live) setReading(false); });
    return () => { live = false; };
  }, []);
  const pay: Record<PayBasis, string> = {hour: "", week: "", month: "", year: "", ...typed};
  const confirmed = payFrom !== null ? pays[payFrom] ?? null : null;
  const askPay = pays.length > 0 && !ownPay;

  const b = fromBank ?? parseAmount(bal), p = parseAmount(pay[basis]), h = parseAmount(hours);
  const payOk = p > 0 && (basis !== "hour" || (h > 0 && h <= 100));
  const yearly = payOk ? yearlyTakeHome(basis, p, h) : 0;
  const estimated = !confirmed && (basis === "hour" || basis === "year");
  const each = confirmed ? confirmed.amount : perPayday(yearly, freq);   // what lands each payday
  const go = (n: number) => { setError(""); if (n >= 2) Keyboard.dismiss(); setStep(n); };   // from payday on, nothing is typed straight away
  const back = step > 0 ? () => go(step - 1) : undefined;

  // "Yes, that's right": the pay the bank found is yours, and once, its payday becomes the starting answer (still yours to change)
  const yes = () => {
    const r = pays[which].rule;
    setPayFrom(which);
    if (r && ruleFor !== which) { setFreq(r.freq); setDate(r.date); }
    setRuleFor(which);
    go(2);
  };
  const mine = () => { Keyboard.dismiss(); setOwnPay(true); setChoosing(false); setPayFrom(null); };

  // the protected route then opens the app; a bank connected here brings in pots and payments straight away
  const done = (src?: Income, list?: Bill[], cats?: Category[]) => {
    useMoney.getState().setup(b, src, list, cats);
    if (fromBank !== null) syncNow();
  };
  const income = () => {
    const r = buildIncome({name: "Pay", type: "work", freq, date, varies: false, amount: each, low: NaN, typical: NaN, main: true}, undefined, "i" + uid(), today);
    // who pays you, so a synced pay counts as payday arriving: only when you said it's your pay
    return "src" in r && confirmed ? {src: {...r.src, payer: confirmed.from}} : r;
  };

  // the bills and spending the bank found, once, into the lists as if you'd picked and filled them in (each still yours to change or remove)
  const seedFound = () => {
    if (!found || seeded) return;
    setSeeded(true);
    let o = own, p = bills;
    const a = {...amounts};
    for (const f of found.bills) {
      const r = addName(f.name, BILLS, o, p);
      o = r.own; p = r.picked;
      a[r.name] ??= foundDraft(f);
    }
    setOwn(o); setBills(p); setAmounts(a);
    const d = {...drafts};
    for (const f of found.spending) d[f.name] ??= {amount: String(Math.round(perWeek(f.monthly))), freq: "weekly", budget: null, source: "bank"};
    setSpends(x => [...x, ...found.spending.map(f => f.name).filter(n => !x.includes(n))]);
    setDrafts(d);
  };
  // connected from the page before the bills: what the bank found fills them in, and the bills it found are next
  if (fromBank !== lastBank) {
    setLastBank(fromBank);
    if (step === 3 && fromBank !== null && found && !seeded) { seedFound(); if (found.bills.length) setStep(4); }
  }
  const foundBills = seeded && !!found?.bills.length;     // the bills page shows what the bank found
  const foundSpend = seeded && !!found?.spending.length;  // and so does what you normally spend
  const toEveryday = () => go(foundSpend ? 6 : 5);

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

  // the payments you ticked join your bills, filled in from what they've been (each still yours to change)
  const inBills = (x: FoundPayee) => { const n = [...BILLS, ...own].find(b => b.toLowerCase() === x.name.toLowerCase()); return !!n && bills.includes(n); };
  const addPicked = () => {
    let o = own, p = bills;
    const a = {...amounts};
    for (const f of payees.filter(x => picking?.includes(x.name))) {
      const r = addName(f.name, BILLS, o, p);
      o = r.own; p = r.picked;
      a[r.name] ??= foundDraft(f);
    }
    setOwn(o); setBills(p); setAmounts(a);
    Keyboard.dismiss(); setPicking(null); setSearch("");
    go(4);
  };
  const pickLink = payees.length ? <TextLink label="Pick from your payments" onPress={() => setPicking([])} /> : null;

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
      cta="Continue" canNext={!Number.isNaN(b)} onNext={() => go(1)}>
      {fromBank === null ? (
        <View style={{gap: s[6]}}>
          <View style={{gap: s[3]}}>
            <Button label={reading ? "Reading your Monzo…" : "Connect your bank"} kind="good" disabled={reading}
              onPress={() => { Keyboard.dismiss(); router.push("/connect-bank?from=setup"); }} />
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

  // the pays the bank found, to pick yours from
  if (step === 1 && askPay && choosing) return (
    <StepShell key="pays" step={1} total={TOTAL} scroll keyboard={false} title="Which one is your pay?" why="Money in that repeats, from your last 3 months."
      onBack={() => setChoosing(false)} cta="None of these" canNext onNext={mine}>
      <View style={{borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line}}>
        {pays.map((x, i) => <Row key={i} name={x.from} meta={payMeta(x)} amount={money(x.amount)} onPress={() => { setWhich(i); setChoosing(false); }} />)}
      </View>
    </StepShell>
  );

  // what the bank found, to confirm: never taken as your pay until you say so
  if (step === 1 && askPay) {
    const x = pays[which];
    return (
      <StepShell key="pay-found" step={1} total={TOTAL} keyboard={false} title={x.rule ? "We found a regular payment" : "We found a payment"} why="Is this your income?"
        onBack={back} cta="Yes, that's right" ctaKind="good" canNext onNext={yes}
        footer={(
          <View style={{flexDirection: "row", justifyContent: "center", gap: s[4]}}>
            {pays.length > 1 ? <TextLink label="Choose another" onPress={() => setChoosing(true)} /> : null}
            <TextLink label="I'll enter it myself" onPress={mine} />
          </View>
        )}>
        <AmountInput key={`found-${which}`} autoFocus={false} editable={false} value={x.amount.toFixed(2)} caption={`From ${x.from}. ${payMeta(x)}.`}
          accessibilityLabel="Your pay, from your bank" />
      </StepShell>
    );
  }

  // typed: once past here it stays typed, even if a bank is connected later
  if (step === 1) return (
    <StepShell step={1} total={TOTAL} title="How much are you paid?" why="Pick the way you know it. We'll work out the rest."
      onBack={pays.length ? () => { Keyboard.dismiss(); setOwnPay(false); } : back} cta="Continue" canNext={payOk}
      onNext={() => { setOwnPay(true); setPayFrom(null); go(2); }}
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
        {estimated && payOk ? (
          <T size="sm" muted><T size="sm" weight="bold" style={{color: c.good}}>About {money(Math.round(yearly / 12))} a month</T> after tax and National Insurance</T>
        ) : null}
      </View>
    </StepShell>
  );

  if (step === 2) return (
    <StepShell step={2} total={TOTAL} title="When are you paid?" why="So your money is spread evenly until payday."
      onBack={back} keyboard={false} cta="Continue" canNext error={error}
      onNext={() => { const r = income(); if ("error" in r) return setError(r.error); seedFound(); go(found?.bills.length ? 4 : 3); }}>
      <View style={{gap: s[5]}}>
        <Choice options={FREQS} value={freq} onChange={f => { setFreq(f); setError(""); }} />
        {confirmed?.rule && freq === confirmed.rule.freq ? <T size="sm" muted lines={1}>{payRuleText(confirmed.rule)}</T> : null}
        <T size="sm" muted>{"That's "}<T size="sm" weight="bold" style={{color: c.good}}>{estimated ? "about " : ""}{money(each)}</T> each payday{estimated ? ". You'll confirm it when it lands." : "."}</T>
        {needsDate(freq) ? <Field label="Next payday"><DateField label="Next payday" value={date} onChange={setDate} min={today} /></Field> : null}
      </View>
    </StepShell>
  );

  // everyone you've paid lately, to tick the ones that are bills: paid more than once first, and a search when there are many
  if (picking !== null) {
    const q = search.trim().toLowerCase();
    const shown = payees.filter(x => !q || x.name.toLowerCase().includes(q) || x.payee.toLowerCase().includes(q));
    const row = (x: FoundPayee) => {
      const had = inBills(x), on = had || picking.includes(x.name);
      return <Row key={x.name} name={x.name} meta={had ? "Already in your bills" : payeeMeta(x)} amount={money(x.amount)} leading={<Tick on={on} />} selected={on}
        onPress={had ? undefined : () => setPicking(on ? picking.filter(n => n !== x.name) : [...picking, x.name])} />;
    };
    const group = (label: string, list: FoundPayee[]) => list.length ? (
      <View style={{gap: s[2]}}>
        <T size="sm" muted weight="semibold">{label}</T>
        <View style={{borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line}}>{list.map(row)}</View>
      </View>
    ) : null;
    const n = picking.length;
    return (
      <StepShell key="payees" step={4} total={TOTAL} scroll keyboard={false} title="Pick from your payments" why="Everyone you've paid in the last 3 months. Tick the regular ones."
        onBack={() => { Keyboard.dismiss(); setPicking(null); setSearch(""); }} cta={n ? `Add ${n} ${n === 1 ? "bill" : "bills"}` : "Add bills"} canNext={n > 0} onNext={addPicked}>
        <View style={{gap: s[5]}}>
          {payees.length > 8 ? (
            <Input value={search} onChangeText={setSearch} placeholder="Search" autoCorrect={false} autoCapitalize="none" returnKeyType="search"
              clearButtonMode="while-editing" accessibilityLabel="Search your payments" />
          ) : null}
          {group("Paid more than once", shown.filter(x => x.n > 1))}
          {group("Paid once", shown.filter(x => x.n === 1))}
          {!shown.length ? <T muted>{`Nothing matches “${search.trim()}”.`}</T> : null}
        </View>
      </StepShell>
    );
  }

  // with what the bank found, this is "Does this look right?": change any, remove what isn't a bill, add what's missing
  if (step === 4) return (
    <StepShell key="amounts" step={4} total={TOTAL} scroll keyboard={false}
      title={foundBills ? "We found some regular payments" : "Your bills"} why={foundBills ? "From your last 3 months. Tap one to change it." : "How much do you pay?"}
      onBack={() => go(foundBills ? 2 : 3)} cta="Continue" ctaKind={allIn ? "good" : "primary"} canNext onNext={toEveryday} error={error}
      footer={foundBills || pickLink ? (
        <View style={{flexDirection: "row", justifyContent: "center", gap: s[4]}}>
          {pickLink}
          {foundBills ? <TextLink label="+ Add a bill" onPress={() => go(3)} /> : null}
        </View>
      ) : undefined}>
      <View>
        {picked.map(n => {
          const d = draftOf(n), bill = draftBill(n, d, ""), ready = draftReady(d);
          // subscriptions say which ones they are
          const meta = !ready ? "Add amount" : d.items?.length ? d.items.map(x => x.name).join(", ") : [billWhen(bill), BILL_FREQ[d.freq], d.varies ? "varies" : null].filter(Boolean).join(" · ");
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
          onChange={d => setAmounts(a => ({...a, [SUBS]: d}))} onClose={() => setSheet({...sheet, shown: false})}
          onRemove={foundBills ? () => { setBills(x => x.filter(n => n !== SUBS)); setSheet({...sheet, shown: false}); } : undefined} />
      ) : sheet ? (
        <BillSheet key={sheet.n} name={sheet.name} draft={draftOf(sheet.name)} visible={sheet.shown} today={today}
          onChange={d => setAmounts(a => ({...a, [sheet.name]: d}))} onClose={() => setSheet({...sheet, shown: false})}
          onRemove={foundBills ? () => { setBills(x => x.filter(n => n !== sheet.name)); setSheet({...sheet, shown: false}); } : undefined} />
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

  // no amounts here: just what you spend on (with no bills, back goes to the bills you can pick; with what the bank found, back to that)
  if (step === 5) return (
    <StepShell key="spend" step={5} total={TOTAL} title="What do you spend on regularly?" why="Pick anything that applies. We'll help you work out the rest."
      onBack={() => go(foundSpend ? 6 : picked.length ? 4 : 3)} keyboard={false} cta="Continue" canNext={spends.length > 0} onNext={() => go(6)} error={error}
      footer={<TextLink label="Skip for now" onPress={() => finish([])} />}>
      <Picks options={[...SPENDS, ...spendOwn]} value={spends} onChange={setSpends}>
        <Chip label="+ Add more" accessibilityLabel="Add more" onPress={() => setSpendNaming("")} />
      </Picks>
    </StepShell>
  );

  if (step === 6) return (
    <StepShell key="usual" step={6} total={TOTAL} scroll keyboard={false}
      title={foundSpend ? "Here's what we found" : "What do you normally spend?"}
      why={foundSpend ? "Based on your recent spending. These are estimates: tap one to change it." : "An estimate is fine. We'll turn it into a realistic budget."}
      onBack={foundSpend ? () => go(picked.length || foundBills ? 4 : 3) : back} cta="Continue" ctaKind={spendAllIn ? "good" : "primary"} canNext onNext={() => go(7)}
      footer={foundSpend ? <TextLink label="+ Add more" onPress={() => go(5)} /> : undefined}>
      <View style={{borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line}}>
        {spendPicked.map(n => {
          const d = spendOf(n), ready = spendReady(d);
          return <Row key={n} name={n} meta={ready ? SPEND_FREQ[d.freq] : "Add amount"} amount={ready ? money(parseAmount(d.amount)) : undefined}
            onPress={() => setSpendSheet({name: n, n: (spendSheet?.n ?? 0) + 1, shown: true})} />;
        })}
      </View>
      {spendSheet ? (
        <SpendSheet key={spendSheet.n} name={spendSheet.name} draft={spendOf(spendSheet.name)} visible={spendSheet.shown}
          onChange={d => setDrafts(a => ({...a, [spendSheet.name]: d}))} onClose={() => setSpendSheet({...spendSheet, shown: false})}
          onRemove={foundSpend ? () => { setSpends(x => x.filter(n => n !== spendSheet.name)); setSpendSheet({...spendSheet, shown: false}); } : undefined} />
      ) : null}
    </StepShell>
  );

  // each budget starts at what you usually spend: lower it or not, it's your call
  if (step === 7) return (
    <StepShell key="limits" step={7} total={TOTAL} scroll keyboard={false} title="Set your limits" why="Based on what you normally spend, choose what you want to allow yourself."
      onBack={back} cta="Continue" ctaKind="good" canNext onNext={() => foundBills || foundSpend ? go(8) : finish()} error={error}>
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

  // with a bank: what it all comes to, not every payment. Tap one to go back to it.
  if (step === 8) return (
    <StepShell key="review" step={7} total={TOTAL} keyboard={false} title="We've done the boring part." why="What we found, each month. Tap one to change it."
      onBack={() => go(7)} cta="Continue" ctaKind="good" canNext onNext={() => finish()} error={error}>
      <View style={{borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line}}>
        <Row name="Regular payments" meta={picked.length ? picked.join(", ") : "None"} amount={money(monthly)} onPress={() => go(4)} />
        <Row name="Everyday spending" meta={spendPicked.length ? spendPicked.join(", ") : "None"} amount={money(everyday)} onPress={() => go(7)} />
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

  // no bank yet: a shortcut, not a demand
  if (fromBank === null && !manual) return (
    <StepShell key="boring" step={3} total={TOTAL} keyboard={false} title="Want us to do the boring part?"
      why="Connect your bank and we'll find your regular payments and spending for you."
      onBack={back} cta="Connect bank" canNext onNext={() => router.push("/connect-bank?from=setup")}
      footer={<TextLink label="I'll enter them myself" onPress={() => setManual(true)} />}>
      <T size="sm" muted>We&apos;ll never move money without your permission.</T>
    </StepShell>
  );

  return (
    <StepShell key="bills" step={3} total={TOTAL} title="Fixed bills" why="Which of these do you pay regularly?"
      onBack={foundBills ? () => go(4) : back} keyboard={false} cta="Continue" canNext={bills.length > 0} onNext={() => go(4)} error={error}
      footer={(
        <View style={{flexDirection: "row", justifyContent: "center", gap: s[4]}}>
          {pickLink}
          <TextLink label="I don't have any bills" onPress={() => { setBills([]); toEveryday(); }} />
        </View>
      )}>
      <Picks options={[...BILLS, ...own]} value={bills} onChange={setBills}>
        <Chip label="+ Add more" accessibilityLabel="Add more" onPress={() => setNaming("")} />
      </Picks>
    </StepShell>
  );
}
