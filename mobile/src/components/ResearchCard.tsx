// Something to buy that Tim or Frank looked up (lib/ai/research.ts), as a card leading his answer: what it is, and the products
// as tiles to swipe through, the one he tried against your money saying "Going by" in its price's place (his words say what buying it would do): each its photo,
// model and size, shop, price and how sure that price is (on the shop's page, listed in search, or an estimate; an icon and words,
// never colour alone). Best value adds what the extra buys and how much more it is, which is nowhere else. Tap a
// tile to ask whether it fits your money; the small arrow opens the shop's page. Prices aren't money that's yours, so no accent.
// A card from before (one product at a few shops, kept in a saved chat) is drawn as it was (OldResearchCard).
import {useEffect, useState} from "react";
import {Image, Pressable, ScrollView, StyleSheet, Text, View} from "react-native";
import {isNewView, nameParts, photoQuery, type OfferRow, type OldResearchView, type ResearchView, type Tile} from "@/lib/ai/research";
import {photo} from "@/services/accountant";
import {hanken, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {Icon} from "./Icon";
import {MerchantLogo} from "./TxRow";

const TILE = 168, PHOTO = 120;

type Props = {view: ResearchView | OldResearchView; box: string; edge: string; onOpen: (url: string) => void; onSelect?: (tile: Tile) => void; disabled?: boolean};

export function ResearchCard(props: Props) {
  return isNewView(props.view) ? <ProductsCard {...props} view={props.view} /> : <OldResearchCard {...props} view={props.view} />;
}

function ProductsCard({view, box, edge, onOpen, onSelect, disabled}: Props & {view: ResearchView}) {
  const {c} = useTheme();
  const [broken, setBroken] = useState<string[]>([]);
  // the row's width, card edge to card edge: its left padding, two tiles and their gaps, and half a third
  const [row, setRow] = useState(0);
  const tile = row ? Math.round((row - s[4] - 2 * s[3]) / 2.5) : TILE;
  const body = {fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.ink};
  const quiet = {fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted};
  const best = view.best, bestName = best ? nameParts(best.name) : null;
  const canPick = !!onSelect && !disabled;
  return (
    <View testID="research-card" style={{alignSelf: "stretch", padding: s[4], gap: s[4], borderRadius: 20, borderCurve: "continuous", borderWidth: 1, borderColor: edge, backgroundColor: box}}>
      {/* the title, his price for the one he went by (the headline), then the tiles. The price is said once: here, not on that tile,
          which says "Going by" in its price's place. Best value adds what the extra buys and costs */}
      <Text accessibilityRole="header" style={{fontFamily: hanken.semibold, fontSize: 17, lineHeight: 22, color: c.ink}}>{view.title}</Text>
      {best && bestName ? (
        <View accessible accessibilityLabel={[`${best.label}: ${best.name}, ${best.price}, ${best.by}`, best.why, best.more].filter(Boolean).join(". ")}>
          {best.value ? <Text style={{...quiet, fontFamily: hanken.semibold, color: c.ink}}>{best.label}</Text> : null}
          <Text style={{fontFamily: hanken.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: c.ink, fontVariant: ["tabular-nums"]}}
            adjustsFontSizeToFit numberOfLines={1}>{best.price}</Text>
          <Text style={{...quiet, color: c.ink}} numberOfLines={1}>{bestName.title}</Text>
          {bestName.specs ? <Text style={quiet} numberOfLines={1}>{bestName.specs}</Text> : null}
          <Text style={quiet} numberOfLines={1}>{best.by}</Text>
          {best.why ? <Text testID="best-why" style={{...body, marginTop: s[2]}} numberOfLines={2}>{best.why}</Text> : null}
          {best.more ? <Text testID="best-more" style={quiet} numberOfLines={1}>{best.more}</Text> : null}
        </View>
      ) : null}
      {/* each product a tile, running to the card's edges, all alike (the one he went by says "Going by" in its price's place) */}
      {/* sized so two tiles and half the next show, so it reads as something to swipe; it settles a tile at a time */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginHorizontal: -s[4]}} contentContainerStyle={{paddingHorizontal: s[4], gap: s[3]}}
        onLayout={e => setRow(e.nativeEvent.layout.width)} snapToInterval={tile + s[3]} decelerationRate="fast">
        {view.tiles.map(t => {
          const uri = t.image && !broken.includes(t.image) ? t.image : null, selectable = canPick && t.selectable, named = nameParts(t.name);
          return (
            // the tile asks him about it (the help is here, so it's the big target); the arrow in its corner opens the shop's page
            <Pressable key={t.id} testID={`tile-${t.id}`} onPress={selectable ? () => onSelect!(t) : undefined} disabled={!selectable}
              accessibilityRole={selectable ? "button" : undefined} accessibilityLabel={t.pick ? `${t.label}, the one he went by` : t.label}accessibilityHint={selectable ? "Asks whether it fits your money" : undefined}
              accessibilityActions={[{name: "open", label: `Open ${t.retailer}'s page`}]} onAccessibilityAction={e => { if (e.nativeEvent.actionName === "open") onOpen(t.url); }}
              style={{width: tile, borderRadius: 16, borderCurve: "continuous", overflow: "hidden", borderWidth: 1, borderColor: edge}}>
              {/* white, as shops show their photos; with none, the shop's letter, small, on a soft colour */}
              <View style={{height: PHOTO, padding: s[2], alignItems: "center", justifyContent: "center", backgroundColor: uri ? "#FFFFFF" : c.soft}}>
                {uri ? <Image testID="research-photo" source={{uri}} resizeMode="contain" onError={() => setBroken(b => b.includes(uri) ? b : [...b, uri])} style={{width: "100%", height: "100%"}} />
                  : <MerchantLogo name={t.retailer} size={40} bg={box} />}
                {/* the lowest price on the card: a black dot with a bright green £ in the photo's corner (its label says so for VoiceOver) */}
                {t.lowest ? (
                  <View testID={`lowest-${t.id}`} style={{position: "absolute", top: s[1], left: s[1], width: 24, height: 24, borderRadius: 12, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: "#000000"}}>
                    <Text style={{fontFamily: hanken.heavy, fontSize: 15, lineHeight: 18, color: c.incoming}}>£</Text>
                  </View>
                ) : null}
                {/* the one he went by for best value: a small tag along the photo's foot */}
                {t.value ? (
                  <View testID={`value-${t.id}`} style={{position: "absolute", bottom: s[1], left: s[1], paddingHorizontal: s[2], height: 22, borderRadius: 11, borderCurve: "continuous", justifyContent: "center", backgroundColor: "#000000"}}>
                    <Text style={{fontFamily: hanken.semibold, fontSize: 12, lineHeight: 16, color: "#FFFFFF"}}>Best value</Text>
                  </View>
                ) : null}
                {/* the shop's page: an arrow out of the app, small, since the help is here */}
                <Pressable testID={`open-${t.id}`} onPress={() => onOpen(t.url)} hitSlop={10} accessibilityRole="link" accessibilityLabel={`Open ${t.retailer}'s page for ${t.name}`}
                  style={{position: "absolute", top: s[1], right: s[1], width: 28, height: 28, borderRadius: 14, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: box, borderWidth: StyleSheet.hairlineWidth, borderColor: edge}}>
                  <Icon name="out" color={c.ink} size={14} />
                </Pressable>
              </View>
              {/* the price first, a small icon for how sure it is (an estimate already says "About"), then its model and size, and
                  the rest of the shop's listing muted under it */}
              <View style={{padding: s[3], gap: 2}}>
                <View style={{flexDirection: "row", alignItems: "center", gap: s[1]}}>
                  {/* the one he went by has its price in the headline above: here it says so instead */}
                  <Text style={{...body, fontFamily: hanken.semibold, fontVariant: ["tabular-nums"], flexShrink: 1, color: t.selectable ? c.ink : c.muted}} adjustsFontSizeToFit numberOfLines={1}>{t.pick ? "Going by" : t.price}</Text>
                </View>
                {/* whose price it is, so the same price at two shops doesn't read as the same tile twice */}
                <View testID={`shop-${t.id}`} style={{flexDirection: "row", alignItems: "center", gap: s[1]}}>
                  <Text style={{...quiet, flexShrink: 1}} numberOfLines={1}>{t.retailer}</Text>
                  {t.sureIcon === "check" || t.sureIcon === "search" ? <Icon name={t.sureIcon} color={c.muted} size={12} /> : null}
                </View>
                {/* its model and size only: the rest of the shop's listing mostly says what the title already does */}
                <Text style={{...quiet, color: c.ink}} numberOfLines={2}>{named.title}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {/* what buying it would do isn't repeated here: his words under the card say it, worked out the same way */}
      <Text style={quiet}>{view.checked}{onSelect && view.tiles.some(t => t.selectable) ? ". Tap one to ask about it" : ""}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// A card from before find_products, as a saved chat kept it: one product, each shop whose page backed a price a tile that opens it.

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

export function OldResearchCard({view, box, edge, onOpen}: Props & {view: OldResearchView}) {
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
    <View testID="research-card" style={{alignSelf: "stretch", padding: s[4], gap: s[4], borderRadius: 20, borderCurve: "continuous", borderWidth: 1, borderColor: edge, backgroundColor: box}}>
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginHorizontal: -s[4]}} contentContainerStyle={{paddingHorizontal: s[4], gap: s[3]}}>
        {view.rows.map(r => {
          const uri = own(r) ?? stand;
          return (
            <Pressable key={`${r.url} ${r.price}`} onPress={() => onOpen(r.url)} accessibilityRole="link" accessibilityLabel={r.label}
              style={{width: 160, borderRadius: 16, borderCurve: "continuous", overflow: "hidden", borderWidth: 1, borderColor: edge}}>
              <View style={{height: 160, padding: s[3], alignItems: "center", justifyContent: "center", backgroundColor: uri ? "#FFFFFF" : c.soft}}>
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
