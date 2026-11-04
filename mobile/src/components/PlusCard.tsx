import {useEffect, useMemo, useState} from "react";
import {Image, PanResponder, Pressable, Text, View} from "react-native";
import type {Shown} from "@/lib/ai/attach";
import Reanimated, {Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming} from "react-native-reanimated";
import {Icon} from "@/components/Icon";
import {MODEL_CHOICES, type ModelKey} from "@/lib/ai/models";
import {GlassView} from "expo-glass-effect";
import {hanken, timPage} from "@/theme/tokens";
import {GLASS} from "@/theme/glass";

type Tone = (typeof timPage)["light"];
const SLIDE_MS = 220, CLOSE_DRAG = 60, THUMB = 56, BUBBLE = 56;
const SHUT_MS = 160, CARD_PAD = 8;

// a button's round: a soft filled circle (on the glass card, glass circles would look muddy)
function Bubble({fill, children}: {fill: string; children: React.ReactNode}) {
  return <View style={{width: BUBBLE, height: BUBBLE, borderRadius: BUBBLE / 2, alignItems: "center", justifyContent: "center", backgroundColor: fill}}>{children}</View>;
}
const Card = GLASS ? GlassView : View; // the menu's card: Liquid Glass where the phone has it

/**
 * Photos and files with a question: in the box's tray before you send (`onRemove`, a × on each), and over your bubble after.
 * A photo is its small picture; a file a chip with its name.
 */
export function Attachments({items, onRemove, tone, ink}: {items: readonly Shown[]; onRemove?: (i: number) => void; tone: Tone; ink: string}) {
  return (
    <View style={{flexDirection: "row", flexWrap: "wrap", justifyContent: onRemove ? "flex-start" : "flex-end", gap: 8}}>
      {items.map((a, i) => (
        <View key={i} accessibilityLabel={a.kind === "image" ? "Photo" : a.name}>
          {a.thumb ? <Image source={{uri: a.thumb}} style={{width: THUMB, height: THUMB, borderRadius: 12, backgroundColor: tone.mine}} />
            : (
              <View style={{height: THUMB, maxWidth: 200, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: onRemove ? 28 : 12, borderRadius: 12, backgroundColor: tone.mine}}>
                <Icon name="file" color={ink} size={20} />
                <Text numberOfLines={1} style={{flexShrink: 1, fontFamily: hanken.medium, fontSize: 13, color: ink}}>{a.name}</Text>
              </View>
            )}
          {onRemove ? (
            <Pressable onPress={() => onRemove(i)} accessibilityRole="button" accessibilityLabel={`Remove ${a.kind === "image" ? "photo" : a.name}`} hitSlop={8}
              style={{position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: tone.send, alignItems: "center", justifyContent: "center"}}>
              <Icon name="close" color={tone.sendInk} size={12} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * The "+" in Tim and Frank's question box opens this, as ChatGPT's does: Camera, Photos and Files to add to your question, and
 * which Claude he thinks with (each accountant his own, lib/ai/models.ts), on a small card as wide as its rows (Liquid Glass
 * where the phone has it). The card grows out of the "+" (`plusX`, `plusY`: its middle, from the left and the screen's
 * bottom) as iOS menus do, with a touch of overshoot, and sits just above the box (`bottom`), in line with its left edge
 * (`left`); closed, it shrinks back into the "+". Scale and position only, never opacity (glass stops drawing at 0). The
 * page dims; a tap outside or a swipe down closes it. Reduced motion: it's just there.
 */
export function PlusCard({open, onClose, name, model, onModel, onCamera, onPhotos, onFiles, tone, ink, muted, reduced, bottom, left, plusX, plusY}: {
  open: boolean; onClose: () => void; name: string; model: ModelKey; onModel: (m: ModelKey) => void;
  onCamera: () => void; onPhotos: () => void; onFiles: () => void; tone: Tone; ink: string; muted: string; reduced: boolean;
  bottom: number; left: number; plusX: number; plusY: number;
}) {
  // the page's dimming: 0 clear, 1 dimmed. Always there, as the chats panel is: closed, it can't be touched or read
  const at = useSharedValue(open ? 1 : 0);
  useEffect(() => { at.value = reduced ? (open ? 1 : 0) : withTiming(open ? 1 : 0, {duration: SLIDE_MS, easing: Easing.out(Easing.cubic)}); }, [open, reduced, at]);
  // the models are one button; tapped, their list opens under it. Shut again each time the card closes
  const [picking, setPicking] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (!open) setPicking(false); }
  const current = MODEL_CHOICES.find(m => m.key === model) ?? MODEL_CHOICES[0];
  const dim = useAnimatedStyle(() => ({opacity: at.value * .2}));
  // the card: 0 a point at the "+", 1 out. It grows from its bottom edge above the "+", moved down onto the "+" as it starts
  const out = useSharedValue(0);
  useEffect(() => {
    out.value = reduced ? (open ? 1 : 0)
      : open ? withSpring(1, {damping: 18, stiffness: 300, mass: .8})
      : withTiming(0, {duration: SHUT_MS, easing: Easing.in(Easing.cubic)});
  }, [open, reduced, out]);
  const gap = bottom - plusY;
  const grow = useAnimatedStyle(() => ({transform: [{translateY: (1 - out.value) * gap}, {scale: Math.max(0, out.value)}]}));
  // a swipe down past CLOSE_DRAG closes it, as the Living tab's sheet does
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_e, g) => { if (g.dy > CLOSE_DRAG) onClose(); },
  }), [onClose]);

  const row = ({pressed}: {pressed: boolean}) => ({flexDirection: "row" as const, alignItems: "center" as const, gap: 16, minHeight: 64, paddingHorizontal: 8, borderRadius: 20, opacity: pressed ? .7 : 1});
  const tile = (icon: "camera" | "photo" | "file", label: string, onPress: () => void) => (
    <Pressable key={label} testID={`plus-${icon}`} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={row}>
      <Bubble fill={tone.mine}>
        <Icon name={icon} color={ink} size={26} />
      </Bubble>
      <Text style={{fontFamily: hanken.medium, fontSize: 17, color: ink}}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{position: "absolute", left: 0, right: 0, top: 0, bottom: 0}} pointerEvents={open ? "auto" : "none"}
      accessibilityViewIsModal={open} accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"}>
      <Pressable testID="plus-close" onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{position: "absolute", left: 0, right: 0, top: 0, bottom: 0}}>
        <Reanimated.View style={[{flex: 1, backgroundColor: "#000000"}, dim]} />
      </Pressable>
      <Reanimated.View testID="plus-card" {...swipe.panHandlers}
        style={[{position: "absolute", left, bottom, minWidth: 240, transformOrigin: `${plusX - left}px 100%`}, grow]}>
        <Card {...GLASS ? {glassEffectStyle: "regular" as const} : {}}
          style={[{padding: CARD_PAD, borderRadius: 28}, GLASS ? null : {backgroundColor: tone.box, borderWidth: 1, borderColor: tone.edge}]}>
        {tile("camera", "Camera", onCamera)}
        {tile("photo", "Photos", onPhotos)}
        {tile("file", "Files", onFiles)}
        <View style={{height: 1, backgroundColor: tone.edge, marginVertical: 4, marginHorizontal: 8}} />
        <Pressable testID="plus-model" onPress={() => setPicking(p => !p)} accessibilityRole="button" accessibilityState={{expanded: picking}}
          accessibilityLabel={`${name} thinks with ${current.name}`} style={row}>
          <Bubble fill={tone.mine}>
            <Icon name="sliders" color={ink} size={26} />
          </Bubble>
          <View style={{flexGrow: 1}}>
            <Text style={{fontFamily: hanken.medium, fontSize: 17, color: ink}}>{current.name}</Text>
            <Text style={{fontFamily: hanken.medium, fontSize: 13, color: muted}}>{name} thinks with this</Text>
          </View>
          <View style={{transform: [{rotate: picking ? "90deg" : "0deg"}]}}>
            <Icon name="forward" color={muted} size={20} />
          </View>
        </Pressable>
        {picking ? <View accessibilityRole="radiogroup" accessibilityLabel={`${name} thinks with`} style={{paddingLeft: 72}}>
          {MODEL_CHOICES.map(m => {
            const on = m.key === model;
            return (
              <Pressable key={m.key} testID={`model-${m.key}`} onPress={() => { onModel(m.key); setPicking(false); }} accessibilityRole="radio" accessibilityState={{selected: on}}
                style={({pressed}) => ({flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 8, borderRadius: 12, opacity: pressed ? .7 : 1})}>
                <View style={{flex: 1}}>
                  <Text style={{fontFamily: hanken.medium, fontSize: 17, color: ink}}>{m.name}</Text>
                  <Text style={{fontFamily: hanken.medium, fontSize: 13, color: muted}}>{m.note}</Text>
                </View>
                {on ? <Icon name="check" color={ink} size={22} /> : null}
              </Pressable>
            );
          })}
        </View> : null}
        </Card>
      </Reanimated.View>
    </View>
  );
}
