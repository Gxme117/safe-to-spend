import {useState, type ReactNode} from "react";
import {Animated, Keyboard, LayoutAnimation, Modal, Pressable, ScrollView, StyleSheet, View} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {BILL_FREQ, billMonthly, billWhenLong, datePickRange, draftBill, draftReady, itemsTotal, SUBSCRIPTIONS, withItems, type BillDraft, type SubItem} from "@/lib/bills";
import {SPEND_FREQ, spendMonthly, type SpendDraft} from "@/lib/everyday";
import {money} from "@/lib/money";
import type {BillFreq, IsoDate, SpendFreq} from "@/lib/types";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {useReducedMotion} from "./BigMoney";
import {DateField} from "./DateField";
import {Choice, DayGrid, Picks} from "./Form";
import {Icon} from "./Icon";
import {AmountInput, AmountRow, Question, TextLink, useKeyboardLift} from "./Setup";
import {Button, Chip, Input, T} from "./ui";

// Shortest first, so the list reads in order.
const FREQS = (["weekly", "fortnightly", "fourweekly", "monthly", "quarterly", "yearly"] as BillFreq[]).map(k => ({key: k, label: BILL_FREQ[k]}));
const SPEND_FREQS = (Object.keys(SPEND_FREQ) as SpendFreq[]).map(k => ({key: k, label: SPEND_FREQ[k]}));

/**
 * One bill's figures, in the native sheet: how much (the number pad opens straight away), how often, and the day it goes out.
 * Every change is kept as it's made, so swiping the sheet away never loses anything.
 * Nothing is required: an amount you don't know yet can stay blank. With an amount, the first Done without a payment date
 * opens the date, with a quiet way to leave it for later.
 */
export function BillSheet({name, draft, visible, today, onChange, onClose}: {
  name: string; draft: BillDraft; visible: boolean; today: IsoDate; onChange: (d: BillDraft) => void; onClose: () => void;
}) {
  const {c} = useTheme();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState<"freq" | "date" | null>(null);
  const [asked, setAsked] = useState(false);   // the payment date has been offered once

  const bill = draftBill(name, draft, "");
  const when = billWhenLong(bill, today);
  const range = datePickRange(draft.freq, today);
  const caption = draft.freq !== "monthly" && draftReady(draft)
    ? `${BILL_FREQ[draft.freq].toLowerCase()}, so ${money(billMonthly(bill))} a month`
    : BILL_FREQ[draft.freq].toLowerCase();

  // only the row that opens or closes moves
  const show = (o: typeof open) => {
    if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.create(200, "easeInEaseOut", "opacity"));
    if (o) Keyboard.dismiss();
    if (o === "date") setAsked(true);
    setOpen(o);
  };
  // monthly bills go out on a day of the month, the rest on a date: switching between them needs a new one
  const setFreq = (freq: BillFreq) => {
    const same = (freq === "monthly") === (draft.freq === "monthly");
    onChange(same ? {...draft, freq} : {...draft, freq, day: null, date: null});
    show(null);
  };
  const setWhen = (p: Partial<BillDraft>) => { onChange({...draft, ...p, later: false}); show(null); };
  const later = () => { onChange({...draft, day: null, date: null, later: true}); show(null); };
  const done = () => {
    if (draftReady(draft) && !when && !draft.later && !asked) return show("date");
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} onDone={done}>
      <Question title={name} />
      <AmountInput value={draft.amount} onChangeText={amount => onChange({...draft, amount})} onFocus={() => open && show(null)}
        caption={caption} accessibilityLabel={`How much ${name} is`} />
      <View style={{borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line}}>
        <SheetRow label="Frequency" value={BILL_FREQ[draft.freq]} open={open === "freq"} onPress={() => show(open === "freq" ? null : "freq")} />
        {open === "freq" ? (
          <View style={{paddingBottom: s[4]}}><Choice options={FREQS} value={draft.freq} onChange={setFreq} /></View>
        ) : null}
        <SheetRow label="Payment date" value={when ?? (draft.later ? "Later" : "Choose")} quiet={!when && !!draft.later}
          open={open === "date"} onPress={() => show(open === "date" ? null : "date")} />
        {open === "date" ? (
          <View style={{paddingBottom: s[4], gap: s[3]}}>
            {draft.freq === "monthly"
              ? <DayGrid value={draft.day} onChange={day => setWhen({day})} />
              : <DateField inline label="Payment date" value={draft.date ?? today} onChange={date => setWhen({date})} {...range} />}
            <TextLink label="I'll add this later" onPress={later} />
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

/**
 * Subscriptions, added up: tap the ones you have and each comes in at its usual UK price, ready to change.
 * Your own are named under "+ Add more". The total is the Subscriptions bill: monthly, with no single payment date,
 * since they go out on different days (so a month's share is held back each pay cycle).
 */
export function SubscriptionsSheet({draft, visible, onChange, onClose}: {draft: BillDraft; visible: boolean; onChange: (d: BillDraft) => void; onClose: () => void}) {
  const {c} = useTheme();
  const items = draft.items ?? [], extra = draft.extra ?? [];
  const [naming, setNaming] = useState<string | null>(null);   // "Add more" is open, with what's typed so far
  const [added, setAdded] = useState<string | null>(null);     // one you just named: its amount is typed next
  const names = [...SUBSCRIPTIONS.map(x => x.name), ...extra];
  const usual = (n: string) => SUBSCRIPTIONS.find(x => x.name === n)?.price;
  // in the list's order; a usual one comes in at its usual price, one you named blank, and an amount you changed is kept
  const lines = (picked: string[], ns = names): SubItem[] =>
    ns.filter(n => picked.includes(n)).map(n => items.find(x => x.name === n) ?? {name: n, amount: usual(n)?.toFixed(2) ?? ""});
  const setAmount = (name: string, amount: string) => onChange(withItems(draft, items.map(x => x.name === name ? {...x, amount} : x)));
  // a usual one typed out ("netflix") is just picked, not added twice
  const addOwn = () => {
    const name = (naming ?? "").trim().slice(0, 40);
    setNaming(null);
    if (!name) return;
    const same = names.find(n => n.toLowerCase() === name.toLowerCase()) ?? name;
    const ex = names.includes(same) ? extra : [...extra, same];
    onChange({...withItems(draft, lines([...items.map(x => x.name), same], [...SUBSCRIPTIONS.map(x => x.name), ...ex])), extra: ex});
    setAdded(usual(same) ? null : same);
  };
  const done = () => { if (naming?.trim()) addOwn(); Keyboard.dismiss(); onClose(); };

  return (
    <Sheet visible={visible} onClose={onClose} onDone={done}>
      <Question title="Subscriptions" why="Tap the ones you have." />
      <View style={{gap: s[3]}}>
        <Picks options={names} value={items.map(x => x.name)} onChange={v => onChange(withItems(draft, lines(v)))}>
          <Chip label="+ Add more" accessibilityLabel="Add more" onPress={() => setNaming("")} />
        </Picks>
        {naming !== null ? (
          <Input autoFocus value={naming} onChangeText={setNaming} onSubmitEditing={addOwn} returnKeyType="done" placeholder="e.g. Audible" maxLength={40}
            autoCapitalize="words" autoCorrect={false} accessibilityLabel="Another subscription" />
        ) : null}
      </View>
      {items.length ? (
        <View>
          {items.map(x => <AmountRow key={x.name} name={x.name} value={x.amount} autoFocus={x.name === added} onChange={a => setAmount(x.name, a)} accessibilityLabel={`${x.name} a month`} />)}
          <View style={{flexDirection: "row", alignItems: "center", gap: s[3], paddingTop: s[4], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line}}>
            <T weight="semibold" style={{flex: 1}}>Total each month</T>
            <T weight="heavy" size="lg" style={{fontVariant: ["tabular-nums"]}}>{money(itemsTotal(items))}</T>
          </View>
          {items.some(x => usual(x.name) !== undefined)
            ? <T size="sm" muted lines={1} style={{marginTop: s[1]}}>Usual UK prices. Change any that&apos;s different.</T> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

/**
 * What you usually spend on one everyday thing: how much (the number pad opens straight away, and a guess is fine), then how often.
 * The amount is each time, so "£15, 2–3 times a week" works as well as "£60 every week". No dates: it isn't one payment.
 * Every change is kept as it's made, so swiping the sheet away never loses anything.
 */
export function SpendSheet({name, draft, visible, onChange, onClose}: {name: string; draft: SpendDraft; visible: boolean; onChange: (d: SpendDraft) => void; onClose: () => void}) {
  const {c} = useTheme();
  const monthly = spendMonthly(draft);
  // picking how often drops the number pad, so the month it comes to (and Done) are in view
  const setFreq = (freq: SpendFreq) => { Keyboard.dismiss(); onChange({...draft, freq}); };
  return (
    <Sheet visible={visible} onClose={onClose} onDone={() => { Keyboard.dismiss(); onClose(); }}>
      <Question title={name} why="How much do you usually spend?" />
      <AmountInput value={draft.amount} onChangeText={amount => onChange({...draft, amount})} caption="Not sure? An estimate is fine."
        accessibilityLabel={`How much you usually spend on ${name}`} />
      <View style={{gap: s[3]}}>
        <View accessible accessibilityRole="header"><T weight="bold">How often?</T></View>
        <Choice options={SPEND_FREQS} value={draft.freq} onChange={setFreq} />
        {monthly > 0 && draft.freq !== "monthly" ? (
          <T size="sm" muted lines={1}>{"That's "}<T size="sm" weight="bold" style={{color: c.good}}>about {money(Math.round(monthly))}</T> a month.</T>
        ) : null}
      </View>
    </Sheet>
  );
}

/** The native sheet all three use: it scrolls clear of the keyboard, and Done rides up with it, like Continue on every setup page. */
function Sheet({visible, onClose, onDone, children}: {visible: boolean; onClose: () => void; onDone: () => void; children: ReactNode}) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const lift = useKeyboardLift(insets.bottom, useReducedMotion());
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onClose}>
      <View style={{flex: 1, backgroundColor: c.bg}}>
        <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
          contentContainerStyle={{paddingHorizontal: s[5], paddingTop: s[6], paddingBottom: 96 + insets.bottom, gap: s[6]}}>
          {children}
        </ScrollView>
        <Animated.View style={{position: "absolute", left: 0, right: 0, bottom: 0, transform: [{translateY: lift}],
          paddingHorizontal: s[5], paddingTop: s[3], paddingBottom: insets.bottom + s[4], backgroundColor: c.bg}}>
          <Button label="Done" onPress={onDone} />
        </Animated.View>
      </View>
    </Modal>
  );
}

/** A settings-style row: what it is on the left, the answer on the right. Tap to open its picker underneath. */
function SheetRow({label, value, quiet, open, onPress}: {label: string; value: string; quiet?: boolean; open: boolean; onPress: () => void}) {
  const {c} = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}, ${value}`} accessibilityState={{expanded: open}}
      style={({pressed}) => ({flexDirection: "row", alignItems: "center", gap: s[3], minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, opacity: pressed ? 0.6 : 1})}>
      <T weight="semibold" style={{flex: 1}}>{label}</T>
      <T muted={quiet} lines={1} style={{flexShrink: 1}}>{value}</T>
      <View style={{transform: [{rotate: open ? "-90deg" : "180deg"}]}}><Icon name="back" color={c.muted} size={16} /></View>
    </Pressable>
  );
}
