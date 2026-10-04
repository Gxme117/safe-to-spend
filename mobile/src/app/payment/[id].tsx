import {router, useLocalSearchParams} from "expo-router";
import {useRef} from "react";
import {Alert, ScrollView, View} from "react-native";
import {txWhat} from "@/components/TxRow";
import {Button, Chip, Field, T} from "@/components/ui";
import {niceDate} from "@/lib/dates";
import {money} from "@/lib/money";
import {fileUnder, spendCats, type Filing} from "@/lib/payments";
import {useCalc} from "@/store/useCalc";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";

/** One payment: tap what it was for and it's filed straight away. */
export default function PaymentScreen() {
  const {id} = useLocalSearchParams<{id: string}>();
  const r = useCalc();
  const busy = useRef(false); // one tap files it: a second quick tap does nothing
  const it = r?.ctx.txs.find(x => x.id === id);
  if (!r || !it || it.type !== "expense") return null;
  const {ctx} = r;
  const {bills} = ctx.state;
  // an unsorted payment has nothing picked yet: "Other" was only a placeholder
  const on = (k: Filing["kind"], x: string) => !it.needsCat && (k === "bill" ? it.billId === x : !it.billId && it.cat === x);

  const choose = async (pick: Filing) => {
    if (busy.current) return;
    busy.current = true;
    const {patch, msg} = fileUnder(ctx, it, pick);
    const ok = await useMoney.getState().refileTx(it.id, patch);
    busy.current = false;
    if (!ok) return;
    router.back();
    useMoney.getState().notify(msg, true);
  };
  const remove = () => Alert.alert(`Delete this ${money(it.amount)} payment?`, undefined, [
    {text: "Cancel", style: "cancel"},
    {text: "Delete", style: "destructive", onPress: async () => { await useMoney.getState().removeTx(it.id); router.back(); }},
  ]);

  return (
    <ScrollView contentContainerStyle={{padding: s[4], gap: s[5], paddingBottom: s[7]}}>
      <View style={{gap: s[1]}}>
        <T weight="bold" size="xl" style={{fontVariant: ["tabular-nums"]}}>{`−${money(it.amount)}`}</T>
        <T weight="semibold">{it.note || txWhat(ctx, it)}</T>
        <T muted size="sm">{niceDate(it.date)}</T>
      </View>
      {it.needsCat ? <T muted>{"Monzo didn't say what this was. Pick one."}</T> : null}
      {bills.length ? (
        <Field label="A bill">
          <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
            {bills.map(b => <Chip key={b.id} label={b.name} on={on("bill", b.id)} onPress={() => choose({kind: "bill", id: b.id})} />)}
          </View>
        </Field>
      ) : null}
      <Field label={bills.length ? "Or spending" : "What was it for?"}>
        <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
          {spendCats(ctx.state).map(x => <Chip key={x.id} label={x.name} on={on("cat", x.id)} onPress={() => choose({kind: "cat", id: x.id})} />)}
        </View>
      </Field>
      <View style={{alignItems: "flex-start"}}>
        <Button kind="ghost" small label="Delete payment" onPress={remove} />
      </View>
    </ScrollView>
  );
}
