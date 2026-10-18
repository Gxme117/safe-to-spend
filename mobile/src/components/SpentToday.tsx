import {router} from "expo-router";
import {useState} from "react";
import {Pressable, StyleSheet, View} from "react-native";
import Svg, {Circle} from "react-native-svg";
import {comingUp, type Calc} from "@/lib/calc";
import {addDays, niceDate, pad, shortDate} from "@/lib/dates";
import {comingLook, txLook, type Look} from "@/lib/looks";
import {money, moneyExact} from "@/lib/money";
import type {Ctx, IsoDate, Tx} from "@/lib/types";
import {home, radius, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {Icon} from "./Icon";
import {askRemove, MerchantLogo, txWhat} from "./TxRow";
import {T} from "./ui";

// Today's list ("Today · scrolled down", measured at 440pt): a 36pt badge, rows 70pt apart, 20pt in from the card's sides.
const BADGE = 36, ROW_H = 70, PAD = 20, X = 24;
// the perforation along the top: notches this big, this far apart
const HOLE_R = 5, HOLE_GAP = 14;
// Coming up looks this many days ahead (today included)
const AHEAD = 2;

/** "8:40 am", as drawn. */
const clock = (ms: number) => {
  const d = new Date(ms), h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? "am" : "pm"}`;
};

/** Under "What if I spend" on Today: what you've spent today, each payment with what it was for and when (tap to change it, × to
 *  delete it), a way to add one, then what's coming up in the next two days (bills, money expected and pay). The engine's figures only.
 *  With a day gone picked on the pay cycle (`day`), it's that day's receipt instead: what you spent then, and adding a payment adds it
 *  to that day; what's coming up is today's, so it isn't shown. */
export function SpentToday({ctx, c, day}: {ctx: Ctx; c: Calc; day: IsoDate}) {
  const {c: k, dark} = useTheme();
  const g = home[dark ? "dark" : "light"];
  const gone = day < c.t, on = gone ? day : c.t;
  const [w, setW] = useState(0);
  const spent = ctx.txs.filter(it => it.date === on && it.type === "expense")
    .sort((a, b) => (a.paidAt ?? a.created) - (b.paidAt ?? b.created));
  const until = addDays(c.t, AHEAD);
  const coming = gone ? [] : comingUp(ctx, c).filter(x => x.d >= c.t && x.d <= until);
  const when = (d: string) => d === c.t ? "Today" : d === addDays(c.t, 1) ? "Tomorrow" : niceDate(d);
  return (
    <View style={[styles.card, {backgroundColor: g.card}]} onLayout={e => setW(e.nativeEvent.layout.width)}>
      <Perforation width={w} hole={k.bg} />
      <View style={styles.head}>
        <View style={{flex: 1}}><T size="xl" weight="heavy" lines={1} style={{lineHeight: 34}}>{gone ? `Spent on ${shortDate(day)}` : "Spent today"}</T></View>
        <Pressable onPress={() => router.push(gone ? `/add-payment?date=${day}` : "/add-payment")} accessibilityRole="button" hitSlop={s[2]} style={[styles.add, {borderColor: k.ink}]}>
          <T size="sm" weight="semibold">Add payment</T>
        </Pressable>
      </View>
      {spent.length ? spent.map((it, i) => <Spent key={it.id} ctx={ctx} it={it} rule={i > 0 ? g.rule : undefined} badge={g.badge} />)
        : <T muted style={{paddingVertical: s[4]}}>{gone ? "Nothing spent that day" : "Nothing spent yet today"}</T>}
      {coming.length ? (
        <>
          <View style={[styles.section, {borderTopColor: g.rule}]}>
            <T size="homeSmall" weight="medium" muted style={{textTransform: "uppercase", letterSpacing: 1.82}}>Coming up · Next {AHEAD} days</T>
          </View>
          {coming.map((x, i) => (
            <Line key={x.key} name={x.name} look={comingLook(x)} meta={when(x.d)} rule={i > 0 ? g.rule : undefined} badge={g.badge}
              // bills as drawn, to the penny without a sign; money coming in keeps its + and the accent
              amount={x.kind === "bill" ? moneyExact(billAmount(ctx, x.key, x.d)) : x.amt} good={x.good} />
          ))}
        </>
      ) : null}
    </View>
  );
}

/** The receipt's torn-off top: a row of half-circle notches along the edge, drawn in the page's colour so they look cut out. */
function Perforation({width, hole}: {width: number; hole: string}) {
  if (!width) return null;
  const n = Math.floor(width / HOLE_GAP), from = (width - (n - 1) * HOLE_GAP) / 2;
  return (
    <Svg width={width} height={HOLE_R} pointerEvents="none" style={styles.perforation} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({length: n}, (_, i) => <Circle key={i} cx={from + i * HOLE_GAP} cy={0} r={HOLE_R} fill={hole} />)}
    </Svg>
  );
}

/** A coming-up bill's amount, from its key (`billId_date`, as `comingUp` makes them). */
function billAmount(ctx: Ctx, key: string, d: string) {
  return ctx.state.bills.find(b => key === `${b.id}_${d}`)?.amount ?? 0;
}

/** A payment today: tap it to change what it was for, × to delete it (after asking). */
function Spent({ctx, it, rule, badge}: {ctx: Ctx; it: Tx; rule?: string; badge: string}) {
  const {c: k} = useTheme();
  const what = txWhat(ctx, it), name = it.note || what;
  return (
    <Line name={name} uri={it.logo} look={txLook(ctx, it)} meta={`${what} · ${clock(it.paidAt ?? it.created)}`} amount={`−${money(it.amount)}`} rule={rule} badge={badge}
      onPress={() => router.push(`/payment/${it.id}`)}
      end={
        <Pressable onPress={() => askRemove(it)} hitSlop={s[3]} accessibilityRole="button" accessibilityLabel={`Delete ${name}, ${money(it.amount)}`}
          style={[styles.remove, {borderColor: k.line}]}>
          <Icon name="close" color={k.muted} size={12} />
        </Pressable>
      } />
  );
}

/** One row: a badge, the name and a line under it, the amount, and room on the end (the × on a payment), so amounts line up. */
function Line({name, uri, look, meta, amount, good, rule, badge, onPress, end}: {
  name: string; uri?: string; look?: Look; meta: string; amount: string; good?: boolean; rule?: string; badge: string; onPress?: () => void; end?: React.ReactNode;
}) {
  const {c: k} = useTheme();
  return (
    <View style={[styles.row, rule && {borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rule}]}>
      <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={`${name}, ${meta}, ${amount}`} accessibilityHint={onPress ? "Change what it was for" : undefined}
        style={{flex: 1, flexDirection: "row", alignItems: "center", gap: s[3]}}>
        <MerchantLogo name={name} uri={uri} look={look} size={BADGE} bg={badge} strong />
        <View style={{flex: 1}}>
          <T weight="semibold" lines={1}>{name}</T>
          <T size="homeSmall" muted lines={1}>{meta}</T>
        </View>
        <T weight="bold" style={[{fontVariant: ["tabular-nums"]}, good && {color: k.incoming}]}>{amount}</T>
      </Pressable>
      <View style={styles.end}>{end}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  // square along the top, where it's perforated, like a receipt torn off the roll
  card: {borderRadius: radius.card, borderTopLeftRadius: 0, borderTopRightRadius: 0, paddingHorizontal: PAD, paddingTop: PAD, paddingBottom: s[2]},
  perforation: {position: "absolute", top: 0, left: 0},
  head: {flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: s[3], marginBottom: s[1]},
  add: {height: 32, paddingHorizontal: s[3], borderRadius: radius.pill, borderWidth: 1.5, justifyContent: "center"},
  row: {height: ROW_H, flexDirection: "row", alignItems: "center"},
  // the × on a payment; coming up keeps the room, so every amount ends in the same place
  end: {width: X + s[3], alignItems: "flex-end"},
  remove: {width: X, height: X, borderRadius: X / 2, borderWidth: 1, alignItems: "center", justifyContent: "center"},
  section: {borderTopWidth: StyleSheet.hairlineWidth, marginTop: s[2], paddingTop: s[5], paddingBottom: s[1]},
});
