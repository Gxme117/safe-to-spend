import {useMemo, useRef, useState, type ComponentProps, type ReactNode} from "react";
import {Animated, Dimensions, Keyboard, LayoutAnimation, PanResponder, Pressable, TextInput, View} from "react-native";
import {ADD_ICONS, addBill, addIcon, addNote, DUE_HINT, newAddDraft, parseDue, type AddDraft, type AddFreq, type LivingDraft, type LivingItem} from "@/lib/living";
import {billLook} from "@/lib/looks";
import {money} from "@/lib/money";
import type {Bill, Ctx, IsoDate, Tx} from "@/lib/types";
import {home, living, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {BigMoney, useReducedMotion} from "./BigMoney";
import {BubbleIcon, Glow} from "./Bubble";
import {DateField} from "./DateField";
import {useKeyboardLift} from "./Setup";
import {TxRow} from "./TxRow";
import {T} from "./ui";

// a swipe further than this changes the sheet's height (or, down from short, closes it)
const SWIPE = 40;
// short to tall (and back) in .32s, as the sheet slides
const GROW = 320;

const ACTION = {pay: "Mark as paid", unpay: "Mark as unpaid", log: "Log spending"} as const;

/** A bubble's details, in a sheet up from the bottom of the Living tab. Short at first, one line: its icon on the yellow, its name and what it
 *  costs a month ("About" on an everyday amount), so tapping round the pile only swaps the words. Swipe it up or tap it for the rest,
 *  tall: what it costs, big, when it's due, the payments that paid it this pay cycle, then Mark as paid (Mark as unpaid, or Log spending on an everyday amount) and Edit.
 *  Edit turns the sheet into a form (name, amount, when it goes out) with Cancel and Save, lifted above the keyboard.
 *  It slides with `open` (0 to 1, from the screen), and reports its height so the pile can lift to rest on top of it. Close it from
 *  its handle or by swiping it down (tall, a swipe down makes it short first; not while editing). Delete removes it straight away (the toast has Undo). */
export function LivingSheet({ctx, item, due, payments, open, isOpen, onHeight, close, action, onAction, onDelete, draftOf, save, adding, onAdd}: {
  ctx: Ctx; item: LivingItem | null; due: {line: string; bold: string; paid?: true}; payments: Tx[]; open: Animated.Value; isOpen: boolean; onHeight: (h: number) => void;
  close: () => void; action: keyof typeof ACTION | null; onAction: () => void; onDelete: () => void; draftOf: () => LivingDraft; save: (d: LivingDraft) => string | null;
  // the "+" form instead of a bubble's details (Cancel and the handle close it)
  adding: boolean; onAdd: (bill: Bill) => void;
}) {
  const today = ctx.today;
  const {c, dark} = useTheme();
  const reduced = useReducedMotion();
  // its height, measured: closed, it waits just under the screen's edge
  const [h, setH] = useState(400);
  const [edit, setEdit] = useState<{id: string; d: LivingDraft; error: string} | null>(null);
  const editing = isOpen && !!item && edit?.id === item.id;
  // closed, the form's let go of: it opens on the details next time
  const [wasOpen, setWasOpen] = useState(isOpen);
  const [tall, setTall] = useState(false);
  if (wasOpen !== isOpen) { setWasOpen(isOpen); if (!isOpen) { setEdit(null); setTall(false); } }
  const size = (to: boolean) => {
    if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.create(GROW, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
    setTall(to);
  };
  // the keyboard covers the tab bar first: the sheet only rises by what it covers above that
  const ref = useRef<View>(null);
  const [inset, setInset] = useState(0);
  const kb = useKeyboardLift(inset, reduced);
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => !editing && !adding && Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_, g) => {
      if (g.dy < -SWIPE && !tall) size(true);
      else if (g.dy > SWIPE) { if (tall) size(false); else close(); }
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- size only reads `reduced`, listed
  }), [close, editing, adding, tall, reduced]);
  const y = Animated.add(open.interpolate({inputRange: [0, 1], outputRange: [h + 40, 0]}), kb);
  const measure = () => ref.current?.measureInWindow((_x, top, _w, height) => setInset(Math.max(0, Dimensions.get("window").height - top - height)));
  const startEdit = () => {
    if (!item) return;
    measure();
    setEdit({id: item.id, d: draftOf(), error: ""});
  };
  const set = (p: Partial<LivingDraft>) => setEdit(e => e && {...e, d: {...e.d, ...p}, error: ""});
  const done = () => {
    if (!edit) return;
    const error = save(edit.d);
    if (error) return setEdit({...edit, error});
    Keyboard.dismiss();
    setEdit(null);
  };
  const cancel = () => { Keyboard.dismiss(); setEdit(null); };
  return (
    <Animated.View ref={ref} {...swipe.panHandlers} pointerEvents={isOpen ? "auto" : "none"}
      accessibilityElementsHidden={!isOpen} importantForAccessibility={isOpen ? "auto" : "no-hide-descendants"}
      onLayout={e => { const was = e.nativeEvent.layout.height; setH(was); onHeight(was); }}
      style={{position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 3, backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
        paddingHorizontal: s[5], paddingTop: s[2], paddingBottom: s[5], gap: 10,
        shadowColor: "#111111", shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: {width: 0, height: -10}, transform: [{translateY: y}]}}>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close details"
        style={{alignSelf: "center", width: 120, height: 28, alignItems: "center", justifyContent: "center"}}>
        <View style={{width: 40, height: 5, borderRadius: 3, backgroundColor: c.line}} />
      </Pressable>
      {adding ? (
        <AddForm today={today} onFocus={measure} onCancel={() => { Keyboard.dismiss(); close(); }} onAdd={b => { Keyboard.dismiss(); onAdd(b); }} />
      ) : item && editing ? (
        <View style={{gap: 14}}>
          <T size="lg" weight="bold" lines={1}>{`Edit ${item.name}`}</T>
          <Labelled label="Name">
            <Box value={edit.d.name} onChangeText={v => set({name: v})} maxLength={40} accessibilityLabel="Name" />
          </Labelled>
          <View style={{flexDirection: "row", gap: 10}}>
            <Labelled label={item.estimate ? "A month (£)" : "Amount (£)"}>
              <Box value={edit.d.amount} onChangeText={v => set({amount: v})} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel="Amount" />
            </Labelled>
            {edit.d.due === "day" ? (
              <Labelled label="Day it goes out">
                <Box value={edit.d.day} onChangeText={v => set({day: v.replace(/\D/g, "").slice(0, 2)})} keyboardType="number-pad" accessibilityLabel="Day of the month it goes out"
                  placeholder={edit.d.last ? "Last working day" : "e.g. 26"} />
              </Labelled>
            ) : edit.d.due === "date" ? (
              <Labelled label="Next date">
                {edit.d.date
                  ? <View style={{height: 48, justifyContent: "center"}}><DateField label="Next date it goes out" value={edit.d.date} onChange={d => set({date: d})} /></View>
                  : <SheetButton label="Add a date" kind="ghost" onPress={() => set({date: today})} />}
              </Labelled>
            ) : null}
          </View>
          {edit.error ? <T size="sm" weight="medium">{edit.error}</T> : null}
          <View style={{flexDirection: "row", gap: 10, marginTop: 4}}>
            <SheetButton label="Cancel" kind="ghost" onPress={cancel} />
            <SheetButton label="Save" onPress={done} />
          </View>
        </View>
      ) : item ? <>
        {/* short, a tap anywhere on it makes it tall */}
        <Pressable onPress={() => size(true)} disabled={tall} accessible={!tall} accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${item.estimate ? "about " : ""}${money(Math.round(item.amount))}${item.paid ? ", paid" : ""}. Show more`}
          style={{flexDirection: "row", alignItems: "center", gap: s[3]}}>
          <View style={{width: 44, height: 44, borderRadius: 22, overflow: "hidden", alignItems: "center", justifyContent: "center"}}>
            <Glow d={44} paid={item.paid} />
            <BubbleIcon name={item.icon} color={living.hlInk} size={22} />
          </View>
          <T size="lg" weight="bold" lines={1} style={{flex: 1}}>{item.name}</T>
          {/* short, one line: what it costs sits at the end of it (greyed once paid) */}
          {tall ? null : (
            <T size="lg" weight="bold" lines={1} style={{color: item.paid ? c.muted : c.ink, fontVariant: ["tabular-nums"]}}>
              {item.estimate ? <T size="lg" weight="medium" muted>About </T> : null}{money(Math.round(item.amount))}
            </T>
          )}
        </Pressable>
        {tall ? <>
        <View style={{flexDirection: "row", alignItems: "flex-end", gap: s[2]}}>
          {/* sits on the amount's baseline */}
          {item.estimate ? <T size="lg" weight="medium" muted style={{marginBottom: s[3]}}>About</T> : null}
          {/* paid, the amount is greyed: it's gone out (the line under says so in words) */}
          <BigMoney key={item.id} value={item.amount} size="display" wholePounds color={item.paid ? c.muted : undefined} />
        </View>
        <T muted>
          {due.paid ? <T weight="bold" style={{color: living[dark ? "dark" : "light"].paidWord}}>Paid </T> : null}
          {due.line}{due.bold ? <T weight="bold">{` ${due.bold}`}</T> : null}
        </T>
        {/* what paid it: tap one to change what it was for */}
        {payments.length ? <View>{payments.map(it => <TxRow key={it.id} ctx={ctx} it={it} showDate />)}</View> : null}
        {/* one line: the main button, then Edit and Delete */}
        <View style={{flexDirection: "row", gap: 10, marginTop: 6}}>
          {action ? <SheetButton label={ACTION[action]} onPress={onAction} grow={2} /> : null}
          <SheetButton label="Edit" kind="ghost" onPress={startEdit} />
          <SheetButton label="Delete" kind="ghost" danger onPress={onDelete} />
        </View>
        </> : null}
      </> : null}
    </Animated.View>
  );
}

const FREQS: {key: AddFreq; label: string}[] = [{key: "weekly", label: "Weekly"}, {key: "monthly", label: "Monthly"}, {key: "yearly", label: "Yearly"}, {key: "oneoff", label: "One-off"}];

/** "New bill" (design/LIVING_SPEC.md §8): name; amount and when it's due side by side; how often, with what it'll count as under it;
 *  the icon, picked from the name as you type until you tap one; then Cancel and Add bill (grey until there's a name and an amount). */
function AddForm({today, onFocus, onCancel, onAdd}: {today: IsoDate; onFocus: () => void; onCancel: () => void; onAdd: (bill: Bill) => void}) {
  const {c, dark} = useTheme();
  const k = living[dark ? "dark" : "light"];
  const [d, setD] = useState(newAddDraft);
  const set = (p: Partial<AddDraft>) => setD(x => ({...x, ...p}));
  const bill = addBill(d, "", today), icon = addIcon(d);
  // what you typed for Due, not made out (blank is fine)
  const unclear = !!d.due.trim() && !parseDue(d.freq, d.due, today);
  // the last circle is "other": it shows the name's guess when that isn't one of the others
  const icons = ADD_ICONS.map((x, i) => i === ADD_ICONS.length - 1 && !d.icon && !ADD_ICONS.some(y => y.icon === icon) ? {...x, icon} : x);
  const hint = d.icon ? "Your choice" : billLook(d.name).icon !== "receipt" ? "Picked from the name · tap to change" : "Picks itself as you type";
  return (
    <View style={{gap: 14}}>
      <View accessible accessibilityRole="header"><T size="lg" weight="bold" lines={1}>New bill</T></View>
      <Labelled label="Name">
        <Box value={d.name} onChangeText={v => set({name: v})} maxLength={40} placeholder="e.g. Car insurance" accessibilityLabel="Name" onFocus={onFocus} />
      </Labelled>
      <View style={{flexDirection: "row", gap: 10}}>
        <Labelled label="Amount (£)">
          <Box value={d.amount} onChangeText={v => set({amount: v})} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel="Amount" onFocus={onFocus} />
        </Labelled>
        <Labelled label="Due">
          <Box value={d.due} onChangeText={v => set({due: v})} placeholder={DUE_HINT[d.freq]} accessibilityLabel="Due" onFocus={onFocus} />
        </Labelled>
      </View>
      {unclear ? <T size="sm" muted style={{marginTop: -6}}>{`Not sure when that is. Try "${DUE_HINT[d.freq].slice(5)}"`}</T> : null}
      <Labelled label="How often">
        <View accessibilityRole="radiogroup" accessibilityLabel="How often" style={{flexDirection: "row", padding: 4, borderRadius: 16, backgroundColor: home[dark ? "dark" : "light"].badge}}>
          {FREQS.map(f => {
            const on = d.freq === f.key;
            return (
              <Pressable key={f.key} onPress={() => set({freq: f.key})} accessibilityRole="radio" accessibilityLabel={f.label} accessibilityState={{checked: on}}
                style={{flex: 1, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: on ? c.ink : "transparent"}}>
                <T weight={on ? "bold" : "medium"} lines={1} style={{color: on ? c.surface : c.ink, fontSize: 15}}>{f.label}</T>
              </Pressable>
            );
          })}
        </View>
        <T size="sm" muted lines={1}>{addNote(d)}</T>
      </Labelled>
      <View style={{gap: 10}}>
        <View style={{flexDirection: "row", justifyContent: "space-between", gap: s[2]}}>
          <T weight="bold" muted style={{fontSize: 13, lineHeight: 18}}>Icon</T>
          <T size="sm" muted lines={1}>{hint}</T>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Icon" style={{flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10}}>
          {icons.map(x => {
            const on = x.icon === icon;
            return (
              <Pressable key={x.name} onPress={() => set({icon: x.icon})} accessibilityRole="radio" accessibilityLabel={x.name} accessibilityState={{checked: on}}
                style={{width: "16.66%", alignItems: "center"}}>
                <View style={{width: 44, height: 44, borderRadius: 22, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: on ? "transparent" : k.bubble}}>
                  {on ? <Glow d={44} /> : null}
                  <BubbleIcon name={x.icon} color={on ? living.hlInk : k.bubbleInk} size={20} />
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{flexDirection: "row", gap: 10, marginTop: 4}}>
        <SheetButton label="Cancel" kind="ghost" onPress={onCancel} />
        <SheetButton label="Add bill" disabled={!bill} onPress={() => bill && onAdd(bill)} />
      </View>
    </View>
  );
}

// as in the reference: ink with white words, or an outline (Delete's words in red); disabled, a grey one. `grow`: its share of the line
function SheetButton({label, onPress, kind = "primary", grow = 1, danger, disabled}: {label: string; onPress: () => void; kind?: "primary" | "ghost"; grow?: number; danger?: boolean; disabled?: boolean}) {
  const {c, dark} = useTheme();
  const k = living[dark ? "dark" : "light"];
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled: !!disabled}}
      style={({pressed}) => ({flex: grow, height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1,
        backgroundColor: disabled ? k.paid : kind === "primary" ? c.ink : c.surface, borderWidth: kind === "ghost" ? 1.5 : 0, borderColor: c.line})}>
      <T weight="bold" style={{color: disabled ? k.paidInk : kind === "primary" ? c.surface : danger ? k.danger : c.ink, fontSize: 16}}>{label}</T>
    </Pressable>
  );
}

function Labelled({label, children}: {label: string; children: ReactNode}) {
  return (
    <View style={{flex: 1, gap: 6}}>
      <T weight="bold" muted style={{fontSize: 13, lineHeight: 18}}>{label}</T>
      {children}
    </View>
  );
}

function Box(props: ComponentProps<typeof TextInput>) {
  const {c, f} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput placeholderTextColor={c.muted} selectionColor={c.ink} returnKeyType="done" {...props}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }} onBlur={e => { setFocused(false); props.onBlur?.(e); }}
      style={{height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: focused ? c.ink : c.line, paddingHorizontal: 14, fontSize: 16, fontFamily: f.regular, color: c.ink, backgroundColor: c.surface}} />
  );
}
