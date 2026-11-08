import {useRef, useState} from "react";
import {Modal, ScrollView, View} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {MerchantLogo} from "@/components/TxRow";
import {Button, Chip, Field, T} from "@/components/ui";
import {niceDate} from "@/lib/dates";
import {txLook} from "@/lib/looks";
import {money} from "@/lib/money";
import {fileUnder, spendCats, type FilingPatch} from "@/lib/payments";
import type {Tx} from "@/lib/types";
import {useCalc} from "@/store/useCalc";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

const chipRow = {flexDirection: "row", flexWrap: "wrap", gap: s[2]} as const;

/** How a payment is filed now, as a patch that puts it back (for Undo). */
export function filingOf(t: Tx): FilingPatch {
  return {
    cat: t.cat,
    ...(t.subCat ? {subCat: t.subCat} : {}),
    ...(t.billId ? {billId: t.billId} : {}),
    ...(t.forDate ? {forDate: t.forDate} : {}),
    ...(t.srcId ? {srcId: t.srcId} : {}),
    ...(t.refundOf ? {refundOf: t.refundOf} : {}),
  };
}

/**
 * A wrong guess fixed without leaving the chat: tap a payment in Frank's list and say what it was. A native page sheet, so his tab
 * stays where it was underneath (a route over the tabs would make him start his hello again). It files the payment under that
 * category (and subcategory) straight away, with Undo in the toast. `onMoved` is told in words, so he knows on the next question.
 */
export function CategorySheet({txId, onClose, onMoved}: {txId: string | null; onClose: () => void; onMoved: (line: string) => void}) {
  const r = useCalc();
  const tx = txId ? r?.ctx.txs.find(x => x.id === txId) : undefined;
  if (!r || !tx) {
    // keep the Modal mounted but closed, so the slide-away still plays
    return <Modal visible={false} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} />;
  }
  return <Sheet key={tx.id} tx={tx} ctx={r.ctx} onClose={onClose} onMoved={onMoved} />;
}

function Sheet({tx, ctx, onClose, onMoved}: {tx: Tx; ctx: NonNullable<ReturnType<typeof useCalc>>["ctx"]; onClose: () => void; onMoved: (line: string) => void}) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const busy = useRef(false); // one tap files it: a second quick tap does nothing
  const cats = spendCats(ctx.state);
  const nameOf = (id: string) => ctx.state.categories.find(x => x.id === id)?.name ?? "General";
  const subsOf = (id: string) => cats.find(x => x.id === id)?.subcategories ?? [];
  // the subcategory row shows once a category that has some is picked (or is already where it sits)
  const [pending, setPending] = useState<string | null>(() => subsOf(tx.cat).length ? tx.cat : null);

  const choose = async (cat: string, subCat?: string) => {
    if (busy.current) return;
    busy.current = true;
    const before = filingOf(tx), from = nameOf(tx.cat);
    const {patch} = fileUnder(ctx, tx, {kind: "cat", id: cat, ...(subCat ? {subCat} : {})});
    const ok = await useMoney.getState().refileTx(tx.id, patch);
    busy.current = false;
    if (!ok) return;
    const to = nameOf(cat);
    onMoved(`Moved ${tx.note || "a payment"} from ${from} to ${to}.`);
    onClose();
    useMoney.getState().notify(`Moved to ${to}`, true, () => { void useMoney.getState().refileTx(tx.id, before); });
  };
  const press = (id: string) => {
    if (subsOf(id).length) setPending(id);
    else { setPending(null); void choose(id); }
  };
  const subs = pending ? subsOf(pending) : [];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onClose}>
      <View style={{flex: 1, backgroundColor: c.bg}}>
        <ScrollView contentContainerStyle={{paddingHorizontal: s[5], paddingTop: s[6], paddingBottom: s[4], gap: s[5]}}>
          <View style={{flexDirection: "row", alignItems: "center", gap: s[3]}}>
            <MerchantLogo name={tx.note} uri={tx.logo} look={txLook(ctx, tx)} size={48} />
            <View style={{flex: 1, gap: 2}}>
              <T weight="semibold" lines={1}>{tx.note || "Payment"}</T>
              <T muted size="sm">{`${niceDate(tx.date)} · −${money(tx.amount)}`}</T>
            </View>
          </View>
          <Field label="What was it for?">
            <View style={chipRow}>
              {cats.map(x => <Chip key={x.id} label={x.name} on={(pending ?? tx.cat) === x.id} onPress={() => press(x.id)} />)}
            </View>
          </Field>
          {subs.length > 0 ? (
            <Field label="Subcategory (optional)">
              <View style={chipRow}>
                {subs.map(sc => <Chip key={sc.id} label={sc.name} on={pending === tx.cat && tx.subCat === sc.id} onPress={() => void choose(pending!, sc.id)} />)}
                <Chip label="None" on={pending === tx.cat && !tx.subCat} onPress={() => void choose(pending!)} />
              </View>
            </Field>
          ) : null}
        </ScrollView>
        <View style={{paddingHorizontal: s[5], paddingTop: s[3], paddingBottom: insets.bottom + s[4]}}>
          <Button kind="ghost" label="Cancel" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
