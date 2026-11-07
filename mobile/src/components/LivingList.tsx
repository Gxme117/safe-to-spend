import {useState} from "react";
import {Pressable, ScrollView, StyleSheet, View} from "react-native";
import {livingLabel, type LivingItem, type SubcatGroup} from "@/lib/living";
import {money} from "@/lib/money";
import {living, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {BubbleIcon, Glow} from "./Bubble";
import {Icon} from "./Icon";
import {T} from "./ui";

// each row's bubble, and the shortest a row can be (a 44pt tap target, with room)
const DOT = 36, ROW = 56;

type Due = (x: LivingItem) => {line: string; bold: string; paid?: true};

/** The Living tab as a list (design/LIVING_SPEC.md §10): the same bills and everyday amounts as the pit, for reading the figures
 *  rather than the shapes. Bills in the order they're due (`byDue`), then Everyday biggest first, with what each costs and its line
 *  from the sheet (`due`). A tap opens the same sheet as a bubble's; `pad` keeps the last rows clear of it. No `add` (another
 *  month), no "Add a bill", and `empty` says why there's nothing. `subcatMap` supplies per-item subcategory breakdowns. */
export function LivingList({items, sel, tap, add, pad, due, byDue, empty, subcatMap}: {
  items: LivingItem[]; sel: string | null; tap: (id: string) => void; add?: () => void; pad: number;
  due: Due; byDue: (bills: LivingItem[]) => LivingItem[]; empty: {title: string; body: string};
  subcatMap?: Record<string, SubcatGroup[]>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // bills in the order they're due, so the list reads as what's to come; everyday amounts have no dates, so biggest first
  const bills = byDue(items.filter(x => !x.estimate)), everyday = items.filter(x => x.estimate);
  return (
    <ScrollView testID="living-list" style={{flex: 1}} contentContainerStyle={{paddingHorizontal: s[6], paddingBottom: s[6] + pad, gap: s[5]}}>
      {items.length ? null : (
        <View style={{gap: s[2], paddingTop: s[5]}}>
          <T size="livingTitle" weight="bold" style={{letterSpacing: -0.24}}>{empty.title}</T>
          <T size="livingBody" muted style={{lineHeight: 21}}>{empty.body}</T>
        </View>
      )}
      {bills.length ? <Section title="Bills" items={bills} due={due} sel={sel} tap={tap} /> : null}
      {everyday.length ? <Section title="Everyday" items={everyday} due={due} sel={sel} tap={tap} subcatMap={subcatMap} expanded={expanded} onToggle={toggle} /> : null}
      {add ? <AddRow onPress={add} /> : null}
    </ScrollView>
  );
}

// A heading in Today's small uppercase style, with what the section comes to, then its rows
function Section({title, items, due, sel, tap, subcatMap, expanded, onToggle}: {
  title: string; items: LivingItem[]; due: Due; sel: string | null; tap: (id: string) => void;
  subcatMap?: Record<string, SubcatGroup[]>; expanded?: Set<string>; onToggle?: (id: string) => void;
}) {
  const total = items.reduce((a, x) => a + x.amount, 0);
  return (
    <View>
      <View accessible accessibilityRole="header" accessibilityLabel={`${title}, ${money(Math.round(total))} a month`}
        style={{flexDirection: "row", justifyContent: "space-between", paddingBottom: s[2]}}>
        <T size="homeSmall" weight="medium" muted style={{textTransform: "uppercase", letterSpacing: 1.82}}>{title}</T>
        <T size="homeSmall" weight="medium" muted style={{letterSpacing: 1.82, fontVariant: ["tabular-nums"]}}>{money(Math.round(total))}</T>
      </View>
      {items.map(x => {
        const subcats = subcatMap?.[x.id];
        return (
          <Row key={x.id} x={x} due={due(x)} on={x.id === sel} onPress={() => tap(x.id)}
            subcats={subcats && subcats.length >= 2 ? subcats : undefined}
            isExpanded={expanded?.has(x.id) ?? false}
            onToggle={onToggle ? () => onToggle(x.id) : undefined} />
        );
      })}
    </View>
  );
}

// One bill or everyday amount: its bubble, its name and due line, and what it costs a month (greyed once paid, as in the sheet).
// Everyday items with 2+ subcategories show a chevron to expand/collapse their breakdown below the row.
function Row({x, due, on, onPress, subcats, isExpanded, onToggle}: {
  x: LivingItem; due: ReturnType<Due>; on: boolean; onPress: () => void;
  subcats?: SubcatGroup[]; isExpanded?: boolean; onToggle?: () => void;
}) {
  const {c: k, dark} = useTheme();
  const l = living[dark ? "dark" : "light"];
  const fill = on ? "transparent" : x.paid ? l.paid : l.bubble;
  const ink = on ? living.hlInk : x.paid ? l.paidInk : l.bubbleInk;
  return (
    <View>
      <View style={{flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: k.line}}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={livingLabel(x)} accessibilityState={{selected: on}}
          style={{flex: 1, flexDirection: "row", alignItems: "center", gap: s[3], minHeight: ROW}}>
          <View style={{width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: fill, alignItems: "center", justifyContent: "center", overflow: "hidden"}}>
            {on ? <Glow d={DOT} paid={x.paid} /> : null}
            <BubbleIcon name={x.icon} color={ink} size={18} />
          </View>
          <View style={{flex: 1, paddingVertical: s[2]}}>
            <T weight="bold" lines={1}>{x.name}</T>
            {/* paid is said in words, not only by the greyed amount */}
            <T size="sm" muted lines={1}>
              {due.paid ? <T size="sm" weight="bold" style={{color: l.paidWord}}>Paid </T> : null}
              {due.bold ? `${due.line} ${due.bold}` : due.line}
            </T>
          </View>
          <T weight="bold" lines={1} style={{color: x.paid ? k.muted : k.ink, fontVariant: ["tabular-nums"]}}>
            {money(Math.round(x.amount))}
          </T>
        </Pressable>
        {/* chevron to expand/collapse the subcategory breakdown; a placeholder keeps spacing when there's none */}
        {subcats ? (
          <Pressable onPress={onToggle} accessibilityRole="button"
            accessibilityLabel={isExpanded ? `Collapse ${x.name}` : `Expand ${x.name}`}
            style={{width: 36, height: ROW, alignItems: "center", justifyContent: "center"}}>
            <View style={{transform: [{rotate: isExpanded ? "270deg" : "90deg"}]}}>
              <Icon name="forward" color={k.muted} size={16} />
            </View>
          </Pressable>
        ) : <View style={{width: 36}} />}
      </View>
      {/* subcategory rows, indented to align with the category name */}
      {subcats && isExpanded ? (
        <View style={{paddingLeft: DOT + s[3], paddingBottom: s[2]}}>
          {subcats.map(g => (
            <View key={g.subcatId ?? "_other"} style={{flexDirection: "row", justifyContent: "space-between", minHeight: 32, alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: k.line}}>
              <T size="sm" muted style={{flex: 1}} lines={1}>{g.name}</T>
              <T size="sm" weight="medium" style={{fontVariant: ["tabular-nums"]}}>{money(Math.round(g.spent))}</T>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// The list's "+": a small dashed bubble, as in the pit
function AddRow({onPress}: {onPress: () => void}) {
  const {c: k, dark} = useTheme();
  const ink = living[dark ? "dark" : "light"].add;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Add a bill"
      style={{flexDirection: "row", alignItems: "center", gap: s[3], minHeight: ROW, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: k.line}}>
      <View style={{width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, borderStyle: "dashed", borderColor: ink, alignItems: "center", justifyContent: "center"}}>
        <Icon name="plus" color={ink} size={16} />
      </View>
      <T weight="bold">Add a bill</T>
    </Pressable>
  );
}
