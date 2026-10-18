import {router} from "expo-router";
import {useCallback, useEffect, useState} from "react";
import {Animated, Easing, Pressable, StyleSheet, View} from "react-native";
import {BigMoney, useReducedMotion} from "@/components/BigMoney";
import {AddBubble, Bubble} from "@/components/Bubble";
import {LivingSheet} from "@/components/LivingSheet";
import {Floater, usePitSim} from "@/components/PitSim";
import {T} from "@/components/ui";
import type {Calc} from "@/lib/calc";
import {bubbleRadii, livingAction, livingDraft, livingDue, livingItems, livingMarked, livingPayment, livingPayments, livingTotals, pack, pileOrder, R_ADD, saveLiving, type LivingDraft, type LivingItem} from "@/lib/living";
import {money} from "@/lib/money";
import type {Ctx} from "@/lib/types";
import {useCalc} from "@/store/useCalc";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";
import {HomeLook} from "@/theme/useTheme";

// the sheet slides up (and the pile lifts) in .32s, easing out
const SLIDE = 320, EASE = Easing.bezier(0.2, 0.9, 0.25, 1);
// the pile rests this far above the sheet's top
const REST = 12;

/**
 * Living: your cost of living as a ball pit (design/LIVING_SPEC.md). Each bill or everyday amount is a bubble, bigger the more it
 * costs a month, settled at the bottom of the page. Kept in Today's look (<HomeLook>). Every figure is lib/living.ts's; this only draws.
 * Tap a bubble for its details in a sheet, short (name, amount, when it's due), and the pile lifts to rest on top of it; swipe it up
 * or tap it for the rest. Tap the bubble again, empty space, the handle, or swipe the
 * sheet down to close it. From the sheet: mark a bill paid (or unpaid), log spending from an everyday amount, edit it, or delete it (with Undo).
 */
export default function LivingScreen() {
  const r = useCalc();
  if (!r) return null;
  return <HomeLook value><Living ctx={r.ctx} c={r.c} /></HomeLook>;
}

function Living({ctx, c}: {ctx: Ctx; c: Calc}) {
  const items = livingItems(ctx, c);
  const {total, left} = livingTotals(items, c);
  // the bubble whose sheet is open, and the last one tapped (it stays highlighted once the sheet's closed)
  const [sel, setSel] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  // a tap on empty space lets go of the highlight too, until the next bubble's tapped
  const [none, setNone] = useState(false);
  const [sheetH, setSheetH] = useState(400);
  const reduced = useReducedMotion();
  const find = (id: string | null) => items.find(x => x.id === id) ?? null;
  const isOpen = !!find(sel);
  // before any tap, the biggest is highlighted
  const lit = find(sel) ?? find(last) ?? items[0] ?? null;
  const [open] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(open, {toValue: isOpen ? 1 : 0, duration: reduced ? 0 : SLIDE, easing: EASE, useNativeDriver: true}).start();
  }, [isOpen, reduced, open]);
  const tap = (id: string) => { if (sel === id) setSel(null); else { setSel(id); setLast(id); setNone(false); } };
  const close = useCallback(() => setSel(null), []);
  const clear = useCallback(() => { setSel(null); setNone(true); }, []);
  // the sheet's height eases to each new one (short to tall), so the pile rides up and down with it rather than jumping
  const [height] = useState(() => new Animated.Value(sheetH));
  useEffect(() => {
    Animated.timing(height, {toValue: sheetH, duration: reduced ? 0 : SLIDE, easing: EASE, useNativeDriver: true}).start();
  }, [sheetH, reduced, height]);
  const lift = Animated.multiply(open, Animated.multiply(Animated.add(height, REST), -1));
  // the sheet's main button: log the bill's payment (or remove the ones logged here), or log spending from an everyday amount
  const act = async (x: LivingItem) => {
    const st = useMoney.getState();
    const what = livingAction(ctx, c, x);
    if (what === "log") return router.push({pathname: "/add-payment", params: {cat: x.ref}});
    if (what === "unpay") {
      for (const id of livingMarked(ctx, c, x)) await st.removeTx(id);
      return st.notify(`${x.name} marked unpaid. It's held back again`);
    }
    const tx = livingPayment(ctx, c, x);
    if (tx && await st.addTx(tx)) st.notify(`${x.name} marked paid. It's no longer held back`, true);
  };
  // Delete: gone straight away, no "are you sure?". A bill is removed (its payments stay); an everyday amount drops to nothing,
  // so its category and payments stay too. Undo puts it back as it was, highlighted.
  const remove = (x: LivingItem) => {
    const st = useMoney.getState(), s0 = ctx.state;
    const back = () => setLast(x.id);
    if (x.estimate) {
      const was = s0.categories.find(k => k.id === x.ref)?.budget ?? 0;
      const to = (budget: number) => (useMoney.getState().state?.categories ?? []).map(k => k.id === x.ref ? {...k, budget} : k);
      st.saveCategories(to(0));
      st.notify(`${x.name} removed`, false, () => { useMoney.getState().saveCategories(to(was)); back(); });
    } else {
      const at = s0.bills.findIndex(b => b.id === x.ref), bill = s0.bills[at];
      if (!bill) return;
      st.removeBill(bill.id);
      st.notify(`${x.name} removed`, false, () => { useMoney.getState().restoreBill(bill, at); back(); });
    }
    setSel(null);
    setLast(null);
  };
  // Save on the edit form: the bill or everyday amount changes in place, and the pile re-packs around its new size
  const edit = (x: LivingItem, d: LivingDraft) => {
    const r = saveLiving(ctx.state, x, d);
    if ("error" in r) return r.error;
    const st = useMoney.getState();
    if ("bill" in r) st.saveBill(r.bill); else st.saveCategories(r.categories);
    return null;
  };
  return (
    // the header starts a little below where an iOS large title would (a navigation bar's 44pt under the status bar), on the grid
    <View style={{flex: 1, paddingTop: 64, gap: 14}}>
      {/* in Today's styles: its margins, the amount in its face, its bold uppercase label with a muted line, and its small uppercase line */}
      <View style={{paddingHorizontal: s[6]}} accessible accessibilityLabel={`Cost of living, ${money(Math.round(total))} a month. ${money(Math.round(left))} to pay before payday`}>
        <BigMoney value={Math.round(total)} size="display" wholePounds />
        <T size="figureLabel" weight="bold" lines={1} style={{textTransform: "uppercase", letterSpacing: 0.24, lineHeight: 28, marginTop: 3}}>Cost of living</T>
        <T size="figureLabel" muted lines={1} style={{lineHeight: 28}}>a month</T>
        <T size="homeSmall" weight="medium" muted style={{marginTop: s[3], textTransform: "uppercase", letterSpacing: 1.82, fontVariant: ["tabular-nums"]}}>
          {money(Math.round(left))} to pay before payday
        </T>
      </View>
      <Animated.View style={{flex: 1, paddingHorizontal: s[4], transform: [{translateY: lift}]}}>
        <Pit items={items} lit={none ? null : lit?.id ?? null} sel={sel} tap={tap} close={clear} />
      </Animated.View>
      <LivingSheet ctx={ctx} item={lit} due={lit ? livingDue(ctx, c, lit) : {line: "", bold: ""}} payments={lit ? livingPayments(ctx, c, lit) : []}
        open={open} isOpen={isOpen} onHeight={h => setSheetH(was => Math.abs(was - h) < 0.5 ? was : h)} close={close}
        action={lit ? livingAction(ctx, c, lit) : null} onAction={() => lit && act(lit)} onDelete={() => lit && remove(lit)}
        draftOf={() => livingDraft(ctx.state, lit!)} save={d => edit(lit!, d)} />
    </View>
  );
}

// The pile, filling the page down to the tab bar. Positions are worked out once the pit's size is known.
function Pit({items, lit, sel, tap, close}: {items: LivingItem[]; lit: string | null; sel: string | null; tap: (id: string) => void; close: () => void}) {
  const [box, setBox] = useState<{w: number; h: number} | null>(null);
  return (
    // dropping in, the bubbles come out from under its top edge
    <View testID="pit" style={{flex: 1, overflow: "hidden"}} onLayout={e => { const {width: w, height: h} = e.nativeEvent.layout; setBox(b => b && b.w === w && b.h === h ? b : {w, h}); }}>
      {/* a tap on empty space closes the sheet and lets go of the highlight */}
      <Pressable testID="pit-space" onPress={close} accessible={false} style={StyleSheet.absoluteFill} />
      {box ? (items.length ? <Pile items={items} w={box.w} h={box.h} lit={lit} sel={sel} tap={tap} /> : <Empty w={box.w} />) : null}
    </View>
  );
}

// The bubbles drop in, then sit at their places (lib/pit.ts): drag one and it shoves the rest, let go and they all drift home
function Pile({items, w, h, lit, sel, tap}: {items: LivingItem[]; w: number; h: number; lit: string | null; sel: string | null; tap: (id: string) => void}) {
  const reduced = useReducedMotion();
  const radii = bubbleRadii(items.map(x => x.amount));
  // paid ones are packed last, so they settle on top
  const order = [...pileOrder(items.map((x, i) => ({id: x.id, r: radii[i], paid: x.paid}))), {id: "add", r: R_ADD}];
  const pos = pack(order, w, h);
  const sim = usePitSim(order.map(x => pos[x.id]), w, h, reduced);
  // not while a sheet's open
  const drag = sel === null;
  return (
    <>
      {items.map(x => (
        <Floater key={x.id} sim={sim} id={x.id} drag={drag}>
          <Bubble d={pos[x.id].r * 2} icon={x.icon} look={x.id === lit ? "lit" : x.paid ? "paid" : "plain"} paid={x.paid} open={x.id === sel} onPress={() => tap(x.id)}
            amount={`${x.estimate ? "~" : ""}${money(Math.round(x.amount))}`}
            label={`${x.name}, ${x.estimate ? "about " : ""}${money(Math.round(x.amount))}${x.paid ? ", paid" : ""}`} />
        </Floater>
      ))}
      <Floater sim={sim} id="add" drag={drag}><AddBubble d={R_ADD * 2} /></Floater>
    </>
  );
}

// No bills yet: a bigger "+" in the middle, and what the page is for above it
function Empty({w}: {w: number}) {
  return (
    <>
      <View style={{position: "absolute", left: s[5], right: s[5], bottom: 236, alignItems: "center", gap: s[2]}}>
        <T size="livingTitle" weight="bold" style={{letterSpacing: -0.24, textAlign: "center"}}>Add your first bill</T>
        <T size="livingBody" muted style={{textAlign: "center", lineHeight: 21}}>Each one becomes a bubble, sized by what it costs. Together they show your cost of living.</T>
      </View>
      <View style={{position: "absolute", left: w / 2 - 44, bottom: 120}}><AddBubble d={88} /></View>
    </>
  );
}
