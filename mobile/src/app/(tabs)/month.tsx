import {router} from "expo-router";
import {ScrollView, View} from "react-native";
import {BigMoney} from "@/components/BigMoney";
import {PaydayCalendar} from "@/components/PaydayCalendar";
import {SplitBar} from "@/components/SplitBar";
import {TxRow} from "@/components/TxRow";
import {Button, Card, CardHead, PageTitle, Row, T} from "@/components/ui";
import {billMeta, billMonthly, nextBill} from "@/lib/bills";
import {billsLine, comingUp, freeSummary} from "@/lib/calc";
import {niceDate} from "@/lib/dates";
import {money, newestFirst} from "@/lib/money";
import {useCalc} from "@/store/useCalc";
import {s} from "@/theme/tokens";

export default function MonthScreen() {
  const r = useCalc();
  if (!r) return null;
  const {ctx, c} = r;
  const {bills} = ctx.state;
  const sum = freeSummary(c);
  const coming = comingUp(ctx, c);
  const sorted = [...bills].sort((x, y) => (nextBill(x, c.t) || "9") < (nextBill(y, c.t) || "9") ? -1 : 1);
  const thisMonth = ctx.txs.filter(it => it.date.slice(0, 7) === c.cur).sort(newestFirst);

  return (
    <ScrollView contentContainerStyle={{padding: s[4], paddingTop: s[2], gap: s[4], paddingBottom: s[7]}}>
      <PageTitle>Month</PageTitle>
      {c.payday ? (
        <Card>
          <T weight="bold">{sum.lead}</T>
          <BigMoney value={sum.free} size="xl" animate={false} />
          <T muted size="sm">{sum.sub}</T>
          <SplitBar c={c} />
        </Card>
      ) : null}

      <PaydayCalendar ctx={ctx} c={c} />

      {c.payday ? (
        <Card>
          <CardHead title="Coming up" />
          <View>{coming.map(x => <Row key={x.key} name={x.name} meta={`${niceDate(x.d)}. ${x.meta}`} amount={x.amt} good={x.good} />)}</View>
          {!c.billsDue.length ? <T muted size="sm">{bills.length ? "No bills due before payday." : "Add your bills to see when each one goes out."}</T> : null}
        </Card>
      ) : null}

      <Card>
        <CardHead title="Bills" right={bills.length ? <Button small kind="ghost" label="Add bill" onPress={() => router.push("/bill/new")} /> : undefined} />
        {!bills.length ? (
          <>
            <T muted>Tell the tracker what goes out regularly, like rent or your phone. It holds that money back before showing what you can spend.</T>
            <Button label="Set up your bills" onPress={() => router.push("/bill/new")} />
          </>
        ) : (
          <>
            <T muted size="sm">{money(bills.reduce((a, b) => a + billMonthly(b), 0))} a month</T>
            <View>
              {sorted.map(b => {
                const n = nextBill(b, c.t);
                return <Row key={b.id} name={b.name} meta={billMeta(b, n ? niceDate(n) : null)} amount={`${b.varies ? "About " : ""}${money(b.amount)}`}
                  onPress={() => router.push(`/bill/${b.id}`)} accessibilityHint="Edit this bill" />;
              })}
            </View>
            <T muted size="sm">{billsLine(c)}</T>
          </>
        )}
      </Card>

      <Card>
        <CardHead title="Everyday" right={<Button small kind="ghost" label="Plan" onPress={() => router.push("/everyday")} />} />
        {c.everyday.length ? (
          <View>
            {c.everyday.map(e => <Row key={e.x.id} name={e.x.name} meta={`${money(e.spent)} of ${money(e.x.budget)} since payday`}
              amount={e.left < 0 ? `${money(-e.left)} over` : `${money(e.left)} left`} />)}
          </View>
        ) : <T muted>Nothing set as everyday yet.</T>}
      </Card>

      <Card>
        <CardHead title="Payments this month" />
        {thisMonth.length ? <View>{thisMonth.map(it => <TxRow key={it.id} ctx={ctx} it={it} showDate />)}</View> : <T muted>No payments logged this month.</T>}
        {thisMonth.length ? <T muted size="sm">Hold a payment to delete it.</T> : null}
      </Card>
    </ScrollView>
  );
}
