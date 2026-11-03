// Something to buy that Tim or Frank looked up (lib/ai/research.ts), as a card leading his answer: what it is and what he
// assumed, the price he went by, each shop's price (a tap opens its page), what buying it today would do in the engine's own
// words, and when the prices were read. Every price on it is one the app read on that shop's own page; with only one, it says so
// rather than padding it out. His words under it are the advice. Prices aren't money that's yours, so no accent here.
import {Pressable, StyleSheet, Text, View} from "react-native";
import type {ResearchView} from "@/lib/ai/research";
import {hanken, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {Icon} from "./Icon";
import {MerchantLogo} from "./TxRow";

export function ResearchCard({view, box, edge, onOpen}: {view: ResearchView; box: string; edge: string; onOpen: (url: string) => void}) {
  const {c} = useTheme();
  const body = {fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.ink};
  const quiet = {fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted};
  const rule = {borderTopWidth: StyleSheet.hairlineWidth, borderColor: edge};
  const best = view.best;
  return (
    <View testID="research-card" style={{alignSelf: "stretch", padding: s[4], gap: s[4], borderRadius: 20, borderWidth: 1, borderColor: edge, backgroundColor: box}}>
      <View style={{gap: s[1]}}>
        <Text accessibilityRole="header" style={{fontFamily: hanken.semibold, fontSize: 17, lineHeight: 22, color: c.ink}}>{view.product}</Text>
        {view.note ? <Text style={quiet}>{view.note}</Text> : null}
      </View>
      {best ? (
        <View accessible accessibilityLabel={[`${best.label}: ${best.price}, ${best.by}`, best.spec].filter(Boolean).join(". ")}>
          <Text style={quiet}>{best.label}</Text>
          <Text style={{fontFamily: hanken.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: c.ink, fontVariant: ["tabular-nums"]}}
            adjustsFontSizeToFit numberOfLines={1}>{best.price}</Text>
          <Text style={{...body, color: c.muted}}>{best.by}</Text>
          {best.spec ? <Text style={{...quiet, marginTop: s[1]}}>{best.spec}</Text> : null}
        </View>
      ) : null}
      {/* each shop, the one he went by first; a tap opens the page the price is on */}
      <View>
        {view.rows.map(r => (
          <Pressable key={`${r.url} ${r.price}`} onPress={() => onOpen(r.url)} accessibilityRole="link" accessibilityLabel={r.label} hitSlop={4}
            style={{flexDirection: "row", alignItems: "center", gap: s[3], paddingVertical: s[3], ...rule}}>
            <MerchantLogo name={r.seller} />
            <View style={{flex: 1, gap: 2}}>
              <Text style={{...body, fontFamily: r.pick ? hanken.semibold : hanken.medium}} numberOfLines={1}>{r.seller}</Text>
              {r.meta ? <Text style={quiet} numberOfLines={2}>{r.meta}</Text> : null}
            </View>
            {r.pick ? <Icon name="check" color={c.ink} size={16} /> : null}
            <Text style={{...body, fontFamily: hanken.semibold, fontVariant: ["tabular-nums"]}}>{r.price}</Text>
            <Icon name="forward" color={c.muted} size={16} />
          </Pressable>
        ))}
      </View>
      {view.limited ? <Text style={{...quiet, marginTop: -s[2]}}>{view.limited}</Text> : null}
      {view.ifToday ? (
        <View style={{gap: s[1], marginTop: -s[4], paddingTop: s[3], ...rule}}>
          <Text style={quiet}>{view.ifLabel}</Text>
          <Text style={body}>{view.ifToday}</Text>
        </View>
      ) : null}
      <Text style={quiet}>{view.checked}</Text>
    </View>
  );
}
