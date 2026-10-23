import {router} from "expo-router";
import {useCallback, useEffect, useState} from "react";
import {Animated, Easing, Pressable, StyleSheet, View} from "react-native";
import {BigMoney, useReducedMotion} from "@/components/BigMoney";
import {AddBubble, Bubble} from "@/components/Bubble";
import {Icon} from "@/components/Icon";
import {LivingList} from "@/components/LivingList";
import {LivingSheet} from "@/components/LivingSheet";
import {FigureLabels, REASON_LINE} from "@/components/FigureLabels";
import {Floater, usePitSim} from "@/components/PitSim";
import {T} from "@/components/ui";
import {answerHint, budgetHint} from "@/lib/budget";
import type {Calc} from "@/lib/calc";
import {addMonths, monthName} from "@/lib/dates";
import {uid} from "@/lib/defaults";
import {livingMonth, livingMonthDue, livingMonthPayments, livingWhen, monthByDate, MONTHS_EACH_WAY} from "@/lib/livingMonth";
import {bubbleRadii, livingAction, livingByDue, livingDraft, livingDue, livingItems, livingLabel, livingMarked, livingPayment, livingPayments, livingTotals, pack, pileOrder, R_ADD, saveLiving, type LivingDraft, type LivingItem} from "@/lib/living";
import {money} from "@/lib/money";
import type {Bill, Ctx} from "@/lib/types";
import {useCalc} from "@/store/useCalc";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";
import {HomeLook, useTheme} from "@/theme/useTheme";

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
 * The button at the top right swaps the pit for a list of the same things with their figures (kept as `livingView`); a row opens the same sheet.
 */
export default function LivingScreen() {
  const r = useCalc();
  if (!r) return null;
  return <HomeLook value><Living ctx={r.ctx} c={r.c} /></HomeLook>;
}

function Living({ctx, c}: {ctx: Ctx; c: Calc}) {
  // the calendar month on show: this one as it is today; < and > step to one gone (what was spent) or to come (what's expected)
  const thisMonth = ctx.today.slice(0, 7);
  const [ym, setYm] = useState(thisMonth);
  const when = livingWhen(ctx.today, ym), now = when === "now";
  // bills can be added this month or one to come (a month gone is only to look at)
  const canAdd = when !== "past";
  const items = now ? livingItems(ctx, c) : livingMonth(ctx, ym);
  const {total, left} = now ? livingTotals(items, c) : {total: items.reduce((a, x) => a + x.amount, 0), left: 0};
  const list = useMoney(st => st.livingView) === "list";
  const ink = useTheme().c.ink;
  // the bubble whose sheet is open, and the last one tapped (it stays highlighted once the sheet's closed)
  const [sel, setSel] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  // a tap on empty space lets go of the highlight too, until the next bubble's tapped
  const [none, setNone] = useState(false);
  const [sheetH, setSheetH] = useState(400);
  const reduced = useReducedMotion();
  const find = (id: string | null) => items.find(x => x.id === id) ?? null;
  // the "+" form: it covers the pile, which stays where it is
  const [adding, setAdding] = useState(false);
  const shown = !!find(sel);
  const isOpen = shown || adding;
  // what the sheet shows (kept while it slides away; before any tap, the biggest, though nothing's highlighted)
  const lit = find(sel) ?? find(last) ?? items[0] ?? null;
  // the highlighted bubble: the open one, or the last one tapped; none before a tap, after another month, a delete, or letting go
  const hl = none ? null : (find(sel) ?? find(last))?.id ?? null;
  const [open] = useState(() => new Animated.Value(0));
  const [up] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(open, {toValue: isOpen ? 1 : 0, duration: reduced ? 0 : SLIDE, easing: EASE, useNativeDriver: true}).start();
    // the list doesn't lift: it scrolls clear of the sheet instead
    Animated.timing(up, {toValue: shown && !list ? 1 : 0, duration: reduced ? 0 : SLIDE, easing: EASE, useNativeDriver: true}).start();
  }, [isOpen, shown, list, reduced, open, up]);
  const close = useCallback(() => { setSel(null); setAdding(false); }, []);
  const clear = useCallback(() => { setSel(null); setAdding(false); setNone(true); }, []);
  // the open bubble tapped again closes its sheet and lets go of the highlight, as a tap on empty space does
  const tap = (id: string) => { if (sel === id) return clear(); setAdding(false); setSel(id); setLast(id); setNone(false); };
  const startAdd = () => { setSel(null); setAdding(true); };
  const swap = () => { close(); useMoney.getState().setLivingView(list ? "pit" : "list"); };
  // another month: the sheet closes and nothing's highlighted
  const step = (n: number) => { close(); setLast(null); setNone(false); setYm(m => addMonths(m, n)); };
  const back = ym > addMonths(thisMonth, -MONTHS_EACH_WAY), fwd = ym < addMonths(thisMonth, MONTHS_EACH_WAY);
  const dueOf = (x: LivingItem) => now ? livingDue(ctx, c, x) : livingMonthDue(ctx, ym, x);
  // the sheet's height eases to each new one (short to tall), so the pile rides up and down with it rather than jumping
  const [height] = useState(() => new Animated.Value(sheetH));
  useEffect(() => {
    Animated.timing(height, {toValue: sheetH, duration: reduced ? 0 : SLIDE, easing: EASE, useNativeDriver: true}).start();
  }, [sheetH, reduced, height]);
  const lift = Animated.multiply(up, Animated.multiply(Animated.add(height, REST), -1));
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
  // A suggested budget, answered: changed to it, or kept. Either way it doesn't ask again until another pay cycle has finished.
  const hint = now && lit?.estimate ? budgetHint(ctx, lit.ref) : null;
  const answer = (x: LivingItem, change: boolean) => {
    if (!hint) return;
    const st = useMoney.getState();
    st.saveCategories(answerHint(ctx.state.categories, x.ref, change ? hint.to : null, ctx.today));
    st.notify(change ? `${x.name} is now ${money(hint.to)} a month` : `${x.name} stays at ${money(Math.round(x.amount))} a month`, change);
  };
  // Save on the edit form: the bill or everyday amount changes in place, and the pile re-packs around its new size
  const edit = (x: LivingItem, d: LivingDraft) => {
    const r = saveLiving(ctx.state, x, d);
    if ("error" in r) return r.error;
    const st = useMoney.getState();
    if ("bill" in r) st.saveBill(r.bill); else st.saveCategories(r.categories);
    return null;
  };
  // Add bill: it drops into the pile at its size, highlighted
  const added = (b: Bill) => {
    const bill = {...b, id: "b" + uid()};
    const st = useMoney.getState();
    st.saveBill(bill);
    st.notify(`${bill.name} added`);
    setAdding(false);
    setLast(`bill:${bill.id}`);
    setNone(false);
  };
  // what the header says: this month, its cost and what's still to go out; a month gone, what was spent; one to come, what's expected
  const label = now ? "Cost of living" : when === "past" ? "Spent" : "Expected";
  const month = monthName(ym, thisMonth.slice(0, 4)), monthLong = monthName(ym, thisMonth.slice(0, 4), true);
  const sub = now ? `${money(Math.round(left))} to pay before payday` : when === "past" ? "On bills and everyday" : "Bills and everyday budgets";
  const empty = now ? list ? EMPTY_LIST : EMPTY_NOW : when === "past"
    ? {title: `Nothing went out in ${monthLong}`, body: "No bill payments or everyday spending were logged that month."}
    : {title: `Nothing expected in ${monthLong}`, body: "Add a bill due that month, and it shows here."};
  return (
    // the header starts a little below where an iOS large title would (a navigation bar's 44pt under the status bar), on the grid.
    // It reads as Today's does: the number, its labels (FigureLabels), one plain line why; then 32pt before the pit or list.
    <View style={{flex: 1, paddingTop: 64, gap: s[6]}}>
      <View style={{paddingHorizontal: s[6]}}>
        {/* the amount, and beside it at the top right the pit or the list (the icon shows the one it swaps to) */}
        <View style={{flexDirection: "row", alignItems: "flex-start"}}>
          <View style={{flex: 1}} accessible accessibilityLabel={`${label}, ${money(Math.round(total))} in ${monthLong}. ${sub}`}>
            <BigMoney key={ym} value={Math.round(total)} size="display" wholePounds />
          </View>
          <Pressable onPress={swap} accessibilityRole="button" accessibilityLabel={list ? "Show as bubbles" : "Show as list"} hitSlop={s[2]}
            style={{width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -s[2]}}>
            <Icon name={list ? "pit" : "list"} color={ink} size={24} />
          </Pressable>
        </View>
        {/* as on Today: what it is and a muted line on the left, and where Today has the day, the month on show with < and >
            either side; the > sits on the page's edge */}
        <FigureLabels quiet title={label} line={now ? "a month" : "that month"} side={
          <View style={{flexDirection: "row", alignItems: "center", height: 28, marginRight: -s[3]}}>
            <MonthStep dir="back" on={back} label={`Show ${monthName(addMonths(ym, -1), thisMonth.slice(0, 4), true)}`} onPress={() => step(-1)} />
            <T size="figureLabel" weight="medium" lines={1} style={{lineHeight: 28}}>{month}</T>
            <MonthStep dir="forward" on={fwd} label={`Show ${monthName(addMonths(ym, 1), thisMonth.slice(0, 4), true)}`} onPress={() => step(1)} />
          </View>
        } />
        {/* as Today's reason line; this month, the figure to act on is in ink (a screen reader has it in the number's label) */}
        <View style={{marginTop: s[1]}} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <T muted lines={1} style={{lineHeight: REASON_LINE, fontVariant: ["tabular-nums"]}}>
            {now ? <><T weight="semibold" style={{color: ink, lineHeight: REASON_LINE}}>{money(Math.round(left))}</T> to pay before payday</> : sub}
          </T>
        </View>
      </View>
      {list ? (
        <LivingList items={items} sel={sel} tap={tap} add={canAdd ? startAdd : undefined} pad={shown ? sheetH + REST : 0} due={dueOf} empty={empty}
          byDue={bills => now ? livingByDue(ctx, c, bills) : monthByDate(bills)} />
      ) : (
        <Animated.View style={{flex: 1, paddingHorizontal: s[4], transform: [{translateY: lift}]}}>
          {/* a new month drops in afresh */}
          <Pit key={ym} items={items} lit={hl} sel={sel} tap={tap} close={clear} add={canAdd ? startAdd : undefined} empty={empty} />
        </Animated.View>
      )}
      <LivingSheet ctx={ctx} item={lit} due={lit ? dueOf(lit) : {line: "", bold: ""}}
        payments={lit ? now ? livingPayments(ctx, c, lit) : livingMonthPayments(ctx, ym, lit) : []}
        hint={hint} onHint={change => lit && answer(lit, change)} readOnly={!now}
        open={open} isOpen={isOpen} adding={adding} onAdd={added} month={now ? undefined : `${ym}-01`} onHeight={h => setSheetH(was => Math.abs(was - h) < 0.5 ? was : h)} close={close}
        action={lit ? livingAction(ctx, c, lit) : null} onAction={() => lit && act(lit)} onDelete={() => lit && remove(lit)}
        draftOf={() => livingDraft(ctx.state, lit!)} save={d => edit(lit!, d)} />
    </View>
  );
}

// The pile, filling the page down to the tab bar. Positions are worked out once the pit's size is known.
// The month on show steps back or on; at the end of the range it's greyed and does nothing
function MonthStep({dir, on, label, onPress}: {dir: "back" | "forward"; on: boolean; label: string; onPress: () => void}) {
  const {c: k} = useTheme();
  return (
    <Pressable testID={`month-${dir}`} onPress={onPress} disabled={!on} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled: !on}} hitSlop={s[2]}
      style={{width: 32, height: 28, alignItems: "center", justifyContent: "center"}}>
      <Icon name={dir} color={on ? k.muted : k.line} size={20} />
    </Pressable>
  );
}

// No bills yet (this month); in another month, that nothing went out or is expected
const EMPTY_NOW = {title: "Add your first bill", body: "Each one becomes a bubble, sized by what it costs. Together they show your cost of living."};
const EMPTY_LIST = {...EMPTY_NOW, body: "Each one shows here with what it costs. Together they show your cost of living."};

// The pile, filling the page down to the tab bar. Positions are worked out once the pit's size is known. No `add`: a month gone.
function Pit({items, lit, sel, tap, close, add, empty}: {
  items: LivingItem[]; lit: string | null; sel: string | null; tap: (id: string) => void; close: () => void; add?: () => void; empty: {title: string; body: string};
}) {
  const [box, setBox] = useState<{w: number; h: number} | null>(null);
  return (
    // dropping in, the bubbles come out from under its top edge
    <View testID="pit" style={{flex: 1, overflow: "hidden"}} onLayout={e => { const {width: w, height: h} = e.nativeEvent.layout; setBox(b => b && b.w === w && b.h === h ? b : {w, h}); }}>
      {/* a tap on empty space closes the sheet and lets go of the highlight */}
      <Pressable testID="pit-space" onPress={close} accessible={false} style={StyleSheet.absoluteFill} />
      {box ? (items.length ? <Pile items={items} w={box.w} h={box.h} lit={lit} sel={sel} tap={tap} add={add} /> : <Empty w={box.w} add={add} empty={empty} />) : null}
    </View>
  );
}

// The bubbles drop in, then sit at their places (lib/pit.ts): drag one and it shoves the rest, let go and they all drift home
function Pile({items, w, h, lit, sel, tap, add}: {items: LivingItem[]; w: number; h: number; lit: string | null; sel: string | null; tap: (id: string) => void; add?: () => void}) {
  const reduced = useReducedMotion();
  const radii = bubbleRadii(items.map(x => x.amount));
  // paid ones are packed last, so they settle on top
  const order = [...pileOrder(items.map((x, i) => ({id: x.id, r: radii[i], paid: x.paid}))), ...(add ? [{id: "add", r: R_ADD}] : [])];
  const pos = pack(order, w, h);
  const sim = usePitSim(order.map(x => pos[x.id]), w, h, reduced);
  // not while a sheet's open
  const drag = sel === null;
  return (
    <>
      {items.map(x => (
        <Floater key={x.id} sim={sim} id={x.id} drag={drag}>
          <Bubble d={pos[x.id].r * 2} icon={x.icon} look={x.id === lit ? "lit" : x.paid ? "paid" : "plain"} paid={x.paid} open={x.id === sel} onPress={() => tap(x.id)}
            label={livingLabel(x)} />
        </Floater>
      ))}
      {add ? <Floater sim={sim} id="add" drag={drag}><AddBubble d={R_ADD * 2} onPress={add} /></Floater> : null}
    </>
  );
}

// No bills yet: a bigger "+" in the middle, and what the page is for above it. A month gone has no "+", just why it's empty.
function Empty({w, add, empty}: {w: number; add?: () => void; empty: {title: string; body: string}}) {
  return (
    <>
      <View style={{position: "absolute", left: s[5], right: s[5], bottom: 236, alignItems: "center", gap: s[2]}}>
        <T size="livingTitle" weight="bold" style={{letterSpacing: -0.24, textAlign: "center"}}>{empty.title}</T>
        <T size="livingBody" muted style={{textAlign: "center", lineHeight: 21}}>{empty.body}</T>
      </View>
      {add ? <View style={{position: "absolute", left: w / 2 - 44, bottom: 120}}><AddBubble d={88} onPress={add} /></View> : null}
    </>
  );
}
