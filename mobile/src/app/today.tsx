import {useState} from "react";
import {ScrollView, View} from "react-native";
import {Card, CardHead, Input, Row, T} from "@/components/ui";
import {money, parseAmount} from "@/lib/money";
import {todayBreakdown, whatIf, type BreakdownRow} from "@/lib/today";
import {useCalc} from "@/store/useCalc";
import {s} from "@/theme/tokens";

/** Tap today's number: try a spend before you make it, and see where the number comes from. Every figure here is the engine's; this only draws them. */
export default function TodayScreen() {
  const r = useCalc();
  const [amt, setAmt] = useState("");
  if (!r) return null;
  const b = todayBreakdown(r.ctx, r.c);
  if (!b) return <ScrollView contentContainerStyle={{padding: s[4]}}><T muted>{"There's no daily number yet. Add your pay and it'll show here."}</T></ScrollView>;
  const a = parseAmount(amt), w = a > 0 ? whatIf(r.ctx, a) : null;
  return (
    <ScrollView contentContainerStyle={{padding: s[4], gap: s[4], paddingBottom: s[7]}} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Card>
        <CardHead title="What if I spend…" />
        <Input prefix="£" value={amt} onChangeText={setAmt} keyboardType="decimal-pad" placeholder="0" accessibilityLabel="What if I spend" />
        {/* one sentence, read out as it changes */}
        <View accessibilityLiveRegion="polite"><T muted={!w}>{w ? w.line : "Type an amount to see what it does to today and the days after."}</T></View>
      </Card>
      <Card>
        <CardHead title="Until payday" />
        {b.now.map(x => <Line key={x.label} x={x} />)}
      </Card>
      <Card>
        <CardHead title="Today" />
        {b.today.map(x => <Line key={x.label} x={x} />)}
      </Card>
    </ScrollView>
  );
}

/** A result line (`total`) shows money that's yours to use in green, like money coming in. */
function Line({x}: {x: BreakdownRow}) {
  return <Row name={x.label} meta={x.note} amount={money(x.amount)} good={x.total && x.amount > 0} />;
}
