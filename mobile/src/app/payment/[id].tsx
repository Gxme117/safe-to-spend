import {router, useLocalSearchParams} from "expo-router";
import {useRef, useState} from "react";
import {Alert, ScrollView, View} from "react-native";
import {txWhat} from "@/components/TxRow";
import {Button, Chip, Field, T} from "@/components/ui";
import {niceDate} from "@/lib/dates";
import {money} from "@/lib/money";
import {fileUnder, IN_KINDS, needsRefundCat, spendCats, unsorted, type Filing, type InKind} from "@/lib/payments";
import type {Ctx, Tx} from "@/lib/types";
import {useCalc} from "@/store/useCalc";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

const chipRow = {flexDirection: "row", flexWrap: "wrap", gap: s[2]} as const;

/** One payment: tap what it was and it's filed straight away. */
export default function PaymentScreen() {
  const {id} = useLocalSearchParams<{id: string}>();
  const r = useCalc();
  const {c} = useTheme();
  const busy = useRef(false); // one tap files it: a second quick tap does nothing
  const it = r?.ctx.txs.find(x => x.id === id);
  if (!r || !it || (it.type !== "expense" && it.type !== "income")) return null;
  const {ctx} = r;
  const income = it.type === "income";

  const choose = async (pick: Filing) => {
    if (busy.current) return;
    busy.current = true;
    const {patch, msg, bill} = fileUnder(ctx, it, pick);
    const ok = await useMoney.getState().refileTx(it.id, patch);
    busy.current = false;
    if (!ok) return;
    if (bill) useMoney.getState().saveBill(bill);
    router.back();
    useMoney.getState().notify(msg, true);
  };
  const remove = () => Alert.alert(`Delete this ${money(it.amount)} ${income ? "payment in" : "payment"}?`, undefined, [
    {text: "Cancel", style: "cancel"},
    {text: "Delete", style: "destructive", onPress: async () => { await useMoney.getState().removeTx(it.id); router.back(); }},
  ]);

  return (
    <ScrollView contentContainerStyle={{padding: s[4], gap: s[5], paddingBottom: s[7]}}>
      <View style={{gap: s[1]}}>
        <T weight="bold" size="xl" style={[{fontVariant: ["tabular-nums"]}, income && {color: c.good}]}>{`${income ? "+" : "−"}${money(it.amount)}`}</T>
        <T weight="semibold">{it.note || txWhat(ctx, it)}</T>
        <T muted size="sm">{niceDate(it.date)}</T>
      </View>
      {unsorted(it) ? <T muted>{income ? "Not all money in is income. What was this?" : "Monzo didn't say what this was. Pick one."}</T> : null}
      {income ? <MoneyIn ctx={ctx} it={it} choose={choose} /> : <MoneyOut ctx={ctx} it={it} choose={choose} />}
      <View style={{alignItems: "flex-start"}}>
        <Button kind="ghost" small label="Delete payment" onPress={remove} />
      </View>
    </ScrollView>
  );
}

type Props = {ctx: Ctx; it: Tx; choose: (p: Filing) => void};

function MoneyOut({ctx, it, choose}: Props) {
  const {bills} = ctx.state;
  const cats = spendCats(ctx.state);
  const catHasSubs = (id: string) => !!(cats.find(c => c.id === id)?.subcategories?.length);

  // Start showing subcats when editing a payment already filed under a cat that has subcats
  const [pendingCat, setPendingCat] = useState<string | null>(
    () => !unsorted(it) && !it.billId && catHasSubs(it.cat) ? it.cat : null
  );

  const handleCatPress = (id: string) => {
    if (catHasSubs(id)) { setPendingCat(id); }
    else { setPendingCat(null); choose({kind: "cat", id}); }
  };

  // Which category chip is "on": if subcat row is showing, only the pending cat; otherwise the existing filing
  const catOn = (id: string) => {
    if (unsorted(it) || it.billId) return false;
    if (pendingCat !== null) return pendingCat === id;
    return it.cat === id;
  };

  const subs = pendingCat ? (cats.find(c => c.id === pendingCat)?.subcategories ?? []) : [];

  return (
    <>
      {bills.length ? (
        <Field label="A bill">
          <View style={chipRow}>
            {bills.map(b => <Chip key={b.id} label={b.name} on={!unsorted(it) && it.billId === b.id} onPress={() => choose({kind: "bill", id: b.id})} />)}
          </View>
        </Field>
      ) : null}
      <Field label={bills.length ? "Or spending" : "What was it for?"}>
        <View style={chipRow}>
          {cats.map(x => <Chip key={x.id} label={x.name} on={catOn(x.id)} onPress={() => handleCatPress(x.id)} />)}
        </View>
      </Field>
      {subs.length > 0 ? (
        <Field label="Subcategory (optional)">
          <View style={chipRow}>
            {subs.map(sc => (
              <Chip key={sc.id} label={sc.name}
                on={pendingCat === it.cat && it.subCat === sc.id}
                onPress={() => choose({kind: "cat", id: pendingCat!, subCat: sc.id})} />
            ))}
            <Chip label="None"
              on={pendingCat === it.cat && !it.subCat}
              onPress={() => choose({kind: "cat", id: pendingCat!})} />
          </View>
        </Field>
      ) : null}
    </>
  );
}

function MoneyIn({ctx, it, choose}: Props) {
  // Refund and Paid back need a category before they can be saved
  const [asking, setAsking] = useState<InKind | null>(null);
  const now = asking ?? (unsorted(it) ? null : it.cat);
  const {incomes} = ctx.state;
  return (
    <>
      {incomes.length ? (
        <Field label="Your pay">
          <View style={chipRow}>
            {incomes.map(x => <Chip key={x.id} label={x.name} on={now === x.id} onPress={() => choose({kind: "pay", id: x.id})} />)}
          </View>
        </Field>
      ) : null}
      <Field label={incomes.length ? "Or" : "What was it?"}>
        <View style={chipRow}>
          {IN_KINDS.map(k => (
            <Chip key={k.id} label={k.label} on={now === k.id}
              onPress={() => needsRefundCat(k.id) ? setAsking(k.id) : choose({kind: "in", id: k.id})} />
          ))}
        </View>
      </Field>
      {now && needsRefundCat(now) ? (
        <Field label={now === "refund" ? "What was refunded?" : "What were you paid back for?"} hint="It's taken off what you spent there">
          <View style={chipRow}>
            {spendCats(ctx.state).map(x => (
              <Chip key={x.id} label={x.name} on={it.cat === now && it.refundOf === x.id}
                onPress={() => choose({kind: "in", id: now as InKind, refundOf: x.id})} />
            ))}
          </View>
        </Field>
      ) : null}
    </>
  );
}
