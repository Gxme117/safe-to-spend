import {useState} from "react";
import {Modal, ScrollView, View} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {MerchantLogo} from "@/components/TxRow";
import {Button, Chip, Field, T} from "@/components/ui";
import {spendCats} from "@/lib/payments";
import type {Ctx} from "@/lib/types";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

const chipRow = {flexDirection: "row", flexWrap: "wrap", gap: s[2]} as const;

export type PickTarget = {key: string; name: string; cat: string; sub?: string; count?: number};

/**
 * Where a shop's payments should go, for a proposal that isn't saved yet (Smart Sort's Edit): a native page sheet, like the one
 * for a payment that's filed already. Nothing is written here; it hands the choice back and the card holds it until Confirm.
 */
export function CategoryPick({target, state, onPick, onClose}: {target: PickTarget | null; state: Ctx["state"] | null; onPick: (key: string, cat: string, sub?: string) => void; onClose: () => void}) {
  if (!target || !state) return <Modal visible={false} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} />;
  return <Sheet key={target.key} target={target} state={state} onPick={onPick} onClose={onClose} />;
}

function Sheet({target, state, onPick, onClose}: {target: PickTarget; state: Ctx["state"]; onPick: (key: string, cat: string, sub?: string) => void; onClose: () => void}) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const cats = spendCats(state);
  const subsOf = (id: string) => cats.find(x => x.id === id)?.subcategories ?? [];
  const [pending, setPending] = useState<string | null>(() => subsOf(target.cat).length ? target.cat : null);
  const choose = (cat: string, sub?: string) => { onPick(target.key, cat, sub); onClose(); };
  const press = (id: string) => { if (subsOf(id).length) setPending(id); else { setPending(null); choose(id); } };
  const subs = pending ? subsOf(pending) : [];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onClose}>
      <View style={{flex: 1, backgroundColor: c.bg}}>
        <ScrollView contentContainerStyle={{paddingHorizontal: s[5], paddingTop: s[6], paddingBottom: s[4], gap: s[5]}}>
          <View style={{flexDirection: "row", alignItems: "center", gap: s[3]}}>
            <MerchantLogo name={target.name} size={48} />
            <View style={{flex: 1, gap: 4}}>
              <T weight="semibold" lines={1}>{target.name}</T>
              {target.count && target.count > 1 ? <T muted size="sm">{`${target.count} payments will go where you choose`}</T> : null}
            </View>
          </View>
          <Field label="What was it for?">
            <View style={chipRow}>
              {cats.map(x => <Chip key={x.id} label={x.name} on={(pending ?? target.cat) === x.id} onPress={() => press(x.id)} />)}
            </View>
          </Field>
          {subs.length > 0 ? (
            <Field label="Subcategory (optional)">
              <View style={chipRow}>
                {subs.map(sc => <Chip key={sc.id} label={sc.name} on={pending === target.cat && target.sub === sc.id} onPress={() => choose(pending!, sc.id)} />)}
                <Chip label="None" on={pending === target.cat && !target.sub} onPress={() => choose(pending!)} />
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
