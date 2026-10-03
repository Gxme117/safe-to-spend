import {router} from "expo-router";
import {ScrollView, View} from "react-native";
import {CheckinCard, ShortCard} from "@/components/Cards";
import {Hero} from "@/components/Hero";
import {TxRow} from "@/components/TxRow";
import {Button, Card, CardHead, T} from "@/components/ui";
import type {Calc} from "@/lib/calc";
import {money} from "@/lib/money";
import {useCalc} from "@/store/useCalc";
import {radius, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

export default function DayScreen() {
  const r = useCalc();
  if (!r) return null;
  const {ctx, c} = r;
  const spentToday = ctx.txs.filter(it => it.date === c.t).sort((a, b) => b.created - a.created);
  return (
    <ScrollView contentContainerStyle={{padding: s[4], gap: s[4], paddingBottom: s[7]}}>
      <Hero ctx={ctx} c={c} />
      <CheckinCard ctx={ctx} />
      <ShortCard c={c} />
      <EverydayChips c={c} />
      <Card>
        <CardHead title="Spent today" right={<Button small label="Add payment" onPress={() => router.push("/add-payment")} />} />
        {spentToday.length
          ? <View>{spentToday.map(it => <TxRow key={it.id} ctx={ctx} it={it} />)}</View>
          : <T muted>Nothing logged today.</T>}
      </Card>
    </ScrollView>
  );
}

function EverydayChips({c: calc}: {c: Calc}) {
  const {c} = useTheme();
  return (
    <Card>
      <CardHead title="Everyday" right={<Button small kind="ghost" label="Plan" onPress={() => router.push("/everyday")} />} />
      {!calc.everyday.length
        ? <T muted>{"Set what you spend on every month, like groceries or coffee, and your daily number shows what's truly free."}</T>
        : <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
            {calc.everyday.map(e => (
              <View key={e.x.id} style={{flexDirection: "row", gap: s[2], borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingVertical: s[2], paddingHorizontal: s[3]}}>
                <T size={14}>{e.x.name}</T>
                <T size={14} weight="bold">{e.left < 0 ? `${money(-e.left)} over` : `${money(e.left)} left`}</T>
              </View>
            ))}
          </View>}
    </Card>
  );
}
