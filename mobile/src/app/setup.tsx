import {useState} from "react";
import {Keyboard, View} from "react-native";
import {DateField} from "@/components/DateField";
import {Choice} from "@/components/Form";
import {AmountInput, StepShell, TextLink} from "@/components/Setup";
import {Field, T} from "@/components/ui";
import {uid} from "@/lib/defaults";
import {buildIncome, FREQ, needsDate} from "@/lib/income";
import {money, parseAmount} from "@/lib/money";
import {perPayday, yearlyTakeHome, type PayBasis} from "@/lib/pay";
import type {IncomeFreq} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

// Regular pay only: a one-off isn't a payday.
const FREQS = (Object.keys(FREQ) as IncomeFreq[]).filter(k => k !== "oneoff").map(k => ({key: k, label: FREQ[k]}));

// However they know their pay. Hour and year are before tax, so we estimate what lands.
const BASES: {key: PayBasis; label: string}[] = [{key: "hour", label: "An hour"}, {key: "week", label: "A week"}, {key: "month", label: "A month"}, {key: "year", label: "A year"}];
const CAPTION: Record<PayBasis, string> = {hour: "an hour", week: "a week, after tax", month: "a month, after tax", year: "a year, before tax"};

/**
 * First run: three questions, one per page. Balance, pay, payday: enough for a real daily number.
 * Nothing is saved until the end, so going back never loses an answer.
 */
export default function SetupScreen() {
  const {c} = useTheme();
  const today = useMoney(st => st.today);
  const [step, setStep] = useState(0);
  const [bal, setBal] = useState("");
  const [basis, setBasis] = useState<PayBasis>("month");
  const [pay, setPay] = useState<Record<PayBasis, string>>({hour: "", week: "", month: "", year: ""});
  const [hours, setHours] = useState("");
  const [freq, setFreq] = useState<IncomeFreq>("monthly-lastworking");
  const [date, setDate] = useState(today);
  const [error, setError] = useState("");

  const b = parseAmount(bal), p = parseAmount(pay[basis]), h = parseAmount(hours);
  const payOk = p > 0 && (basis !== "hour" || (h > 0 && h <= 100));
  const yearly = payOk ? yearlyTakeHome(basis, p, h) : 0;
  const estimated = basis === "hour" || basis === "year";
  const go = (n: number) => { setError(""); if (n === 2) Keyboard.dismiss(); setStep(n); };   // the payday page has no typing
  const back = step > 0 ? () => go(step - 1) : undefined;

  const finish = () => {
    const r = buildIncome({name: "Pay", type: "work", freq, date, varies: false, amount: perPayday(yearly, freq), low: NaN, typical: NaN, main: true}, undefined, "i" + uid(), today);
    if ("error" in r) return setError(r.error);
    useMoney.getState().setup(b, r.src);   // the protected route then opens the app
  };

  if (step === 0) return (
    <StepShell step={0} total={3} title="How much is in your account?" why="The balance your bank app shows. Your daily number starts here."
      cta="Continue" canNext={!Number.isNaN(b)} onNext={() => go(1)}>
      <AmountInput key="bal" value={bal} onChangeText={setBal} accessibilityLabel="Your balance" />
    </StepShell>
  );

  if (step === 1) return (
    <StepShell step={1} total={3} title="How much are you paid?" why="Pick the way you know it. We'll work out the rest."
      onBack={back} cta="Continue" canNext={payOk} onNext={() => go(2)}
      footer={<TextLink label="I'm not paid regularly" onPress={() => useMoney.getState().setup(b)} />}>
      <View style={{gap: s[5]}}>
        <Choice options={BASES} value={basis} onChange={setBasis} />
        {basis === "hour" ? (
          <View style={{flexDirection: "row", gap: s[5]}}>
            <View style={{flex: 1}}>
              <AmountInput key="hour" size="xl" caption={CAPTION.hour} value={pay.hour} onChangeText={v => setPay({...pay, hour: v})} accessibilityLabel="Your pay an hour, before tax" />
            </View>
            <View style={{flex: 1}}>
              <AmountInput prefix="" isMoney={false} size="xl" caption="hours a week" autoFocus={false} value={hours} onChangeText={setHours} accessibilityLabel="Hours you work a week" />
            </View>
          </View>
        ) : (
          <AmountInput key={basis} caption={CAPTION[basis]} value={pay[basis]} onChangeText={v => setPay({...pay, [basis]: v})} accessibilityLabel={`Your pay ${CAPTION[basis]}`} />
        )}
        {estimated && payOk ? (
          <T size="sm" muted><T size="sm" weight="bold" style={{color: c.good}}>About {money(Math.round(yearly / 12))} a month</T> after tax and National Insurance</T>
        ) : null}
      </View>
    </StepShell>
  );

  return (
    <StepShell step={2} total={3} title="When are you paid?" why="So your money is spread evenly until payday."
      onBack={back} keyboard={false} cta="Show my number" ctaKind="good" canNext onNext={finish} error={error}>
      <View style={{gap: s[5]}}>
        <Choice options={FREQS} value={freq} onChange={f => { setFreq(f); setError(""); }} />
        <T size="sm" muted>{"That's "}<T size="sm" weight="bold" style={{color: c.good}}>{estimated ? "about " : ""}{money(perPayday(yearly, freq))}</T> each payday{estimated ? ". You'll confirm it when it lands." : "."}</T>
        {needsDate(freq) ? <Field label="Next payday"><DateField label="Next payday" value={date} onChange={setDate} min={today} /></Field> : null}
      </View>
    </StepShell>
  );
}
