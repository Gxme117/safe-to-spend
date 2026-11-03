// Something to buy that Tim or Frank looked up (lib/ai/research.ts), as a card leading his answer: what it is and what he
// assumed, the price he went by, each shop as a tile to swipe through and compare (its own photo of it, its price, a tap opens its
// page), what buying it today would do in the engine's own words, and when the prices were read. Every price on it is one the app
// read on that shop's own page; with only one, it says so rather than padding it out. His words under it are the advice. Prices
// aren't money that's yours, so no accent here. A tile whose shop page had no photo of it shows one looked up by its name
// (services/accountant.ts `photo`).
import {useEffect, useState} from "react";
import {Image, Pressable, ScrollView, StyleSheet, Text, View} from "react-native";
import {photoQuery, type OfferRow, type ResearchView} from "@/lib/ai/research";
import {photo} from "@/services/accountant";
import {hanken, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {Icon} from "./Icon";
import {MerchantLogo} from "./TxRow";

const TILE = 160;

// a photo looked up by its name, only when a tile needs one: undefined while it comes (or isn't asked for), null when there's none
function usePhoto(product: string, wanted: boolean) {
  const [got, setGot] = useState<{product: string; uri: string | null} | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    photo(photoQuery(product)).then(uri => { if (live) setGot({product, uri}); });
    return () => { live = false; };
  }, [product, wanted]);
  return got?.product === product ? got.uri : undefined;
}

export function ResearchCard({view, box, edge, onOpen}: {view: ResearchView; box: string; edge: string; onOpen: (url: string) => void}) {
  const {c} = useTheme();
  const [broken, setBroken] = useState<string[]>([]);
  const lose = (uri: string) => setBroken(b => b.includes(uri) ? b : [...b, uri]);
  const own = (r: OfferRow) => r.photo && !broken.includes(r.photo) ? r.photo : null;
  const found = usePhoto(view.product, view.rows.some(r => !own(r)));
  const stand = found && broken.includes(found) ? null : found;
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
      {/* each shop a tile, the one he went by first, running to the card's edges; a tap opens the page the price is on */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginHorizontal: -s[4]}} contentContainerStyle={{paddingHorizontal: s[4], gap: s[3]}}>
        {view.rows.map(r => {
          const uri = own(r) ?? stand;
          return (
            <Pressable key={`${r.url} ${r.price}`} onPress={() => onOpen(r.url)} accessibilityRole="link" accessibilityLabel={r.label}
              style={{width: TILE, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: edge}}>
              {/* white, as shops show their photos; grey while one's being looked up; the shop's letter when there's none */}
              <View style={{height: TILE, padding: s[3], alignItems: "center", justifyContent: "center", backgroundColor: uri ? "#FFFFFF" : c.soft}}>
                {uri ? <Image testID="research-photo" source={{uri}} resizeMode="contain" onError={() => lose(uri)} style={{width: "100%", height: "100%"}} />
                  : uri === null ? <MerchantLogo name={r.seller} size={48} bg={box} /> : null}
              </View>
              <View style={{padding: s[3], gap: 2}}>
                <Text style={{...body, fontFamily: r.pick ? hanken.semibold : hanken.medium}} numberOfLines={1}>{r.seller}</Text>
                <View style={{flexDirection: "row", alignItems: "center", gap: s[1]}}>
                  <Text style={{...body, fontFamily: hanken.semibold, fontVariant: ["tabular-nums"], flexShrink: 1}} adjustsFontSizeToFit numberOfLines={1}>{r.price}</Text>
                  {r.pick ? <Icon name="check" color={c.ink} size={14} /> : null}
                </View>
                {r.meta ? <Text style={quiet} numberOfLines={2}>{r.meta}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {view.limited ? <Text style={{...quiet, marginTop: -s[2]}}>{view.limited}</Text> : null}
      {view.ifToday ? (
        <View style={{gap: s[1], paddingTop: s[3], ...rule}}>
          <Text style={quiet}>{view.ifLabel}</Text>
          <Text style={body}>{view.ifToday}</Text>
        </View>
      ) : null}
      <Text style={quiet}>{view.checked}</Text>
    </View>
  );
}
