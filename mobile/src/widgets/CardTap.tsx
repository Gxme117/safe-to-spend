import {Button, Gauge, HStack, Image, ProgressView, Spacer, Text, VStack, ZStack} from "@expo/ui/swift-ui";
import {
  accessibilityLabel, activityBackgroundTint, background, buttonStyle, clipShape, font, foregroundStyle, frame, gaugeStyle, lineLimit, minimumScaleFactor,
  padding, progressViewStyle, resizable, scaleEffect, shapes, tint,
} from "@expo/ui/swift-ui/modifiers";
import {createLiveActivity} from "expo-widgets";
import type {CardTapProps} from "@/lib/cardTap";

// The card island (Live Activity: Dynamic Island and Lock Screen), from the "Card tap" artboard: a payment in an everyday
// budget shows what's left of it (blue bar, a ring when it's minimal); anything else, what's safe to spend today (white
// bar). Its words come ready-made from `cardTapFor` (lib/cardTap.ts).
//
// The layout runs on its own inside iOS, not in the app: it can only use Expo UI's components and modifiers, no hooks, and
// nothing from outside this function (not even a constant beside it), so the colours live inside it.
const CardTap = (p: CardTapProps) => {
  "widget";
  const ink = "#FFFFFF", muted = "#9A9AA0", blue = "#4A8DF8";
  const fill = p.pot ? blue : ink;
  const face = (size: number) => p.face
    ? <Image uiImage={p.face} modifiers={[resizable(), frame({width: size, height: size}), clipShape("circle")]} />
    : <Image systemName="person.crop.circle.fill" size={size} color={ink} />;
  // what's left fills from the right, as on the artboard: the grey part on the left is what's gone. The system's own track
  // is nearly black on the island (28,28,31 measured), so a grey capsule goes under it to match the artboard's
  const bar = <ProgressView value={p.fill} modifiers={[progressViewStyle("linear"), tint(fill), background("#2C2C2E", shapes.capsule()), scaleEffect({x: -1, y: 1.6})]} />;
  const under = (left: string, right: string) => (
    <HStack>
      <Text modifiers={[font({size: 14}), foregroundStyle(muted)]}>{left}</Text>
      <Spacer />
      <Text modifiers={[font({size: 14}), foregroundStyle(muted)]}>{right}</Text>
    </HStack>
  );
  return {
    banner: (
      <VStack spacing={12} modifiers={[padding({all: 16}), activityBackgroundTint("#1F1F21")]}>
        <HStack spacing={12}>
          {face(44)}
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({size: 17, weight: "semibold"}), foregroundStyle(ink), lineLimit(1)]}>{p.title}</Text>
            <HStack spacing={4}>
              <Text modifiers={[font({size: 15}), foregroundStyle(muted), lineLimit(1)]}>{`${p.where} ·`}</Text>
              <Text modifiers={[font({size: 15, weight: "semibold"}), foregroundStyle(ink)]}>{p.paid}</Text>
              <Text modifiers={[font({size: 15}), foregroundStyle(muted), lineLimit(1)]}>{p.when}</Text>
            </HStack>
          </VStack>
          <Spacer />
          <Text modifiers={[font({size: 34, weight: "bold"}), foregroundStyle(ink)]}>{p.big}</Text>
        </HStack>
        {bar}
        {under(p.from, p.until)}
      </VStack>
    ),
    // Frank left of the camera, the budget's icon and the amount right of it. Frank is a 21.33pt circle (64px at 3x), padded
    // in so his centre is the end's centre, the pill's own radius (18.33pt), so the gap to its curve is 7.67pt all round
    // (measured off the simulator: the pill is 36.67pt tall, and iOS starts the leading slot 6.6pt in; 0.77pt more puts him
    // dead centre). The amount is 13pt bold, ends
    // 12.67pt from the right end, and the budget's icon beside it is white and small. Padding, not offset: the island clips
    // anything offset past its slot. (The peek over a wall, scripts/frank_peek.py, is kept but not used.)
    compactLeading: <HStack modifiers={[padding({leading: .77})]}>{face(21.33)}</HStack>,
    compactTrailing: (
      <HStack spacing={4} modifiers={[padding({trailing: 4.4})]}>
        {p.pot && p.icon ? <Image systemName={p.icon as never} modifiers={[font({size: 11, weight: "medium"}), foregroundStyle(ink)]} /> : null}
        <Text modifiers={[font({size: 13, weight: "bold"}), foregroundStyle(ink)]}>{p.compact}</Text>
      </HStack>
    ),
    minimal: p.pot
      ? <Gauge value={p.fill} modifiers={[gaugeStyle("circularCapacity"), tint(blue)]} />
      : <Text modifiers={[font({size: 12, weight: "bold"}), foregroundStyle(ink)]}>{p.minimal}</Text>,
    // Frank and the amount stay at the top as the island opens, each corner the compact island's round end grown 2.5 times.
    // Measured off the simulator: the open island's corners are 48.33pt round and iOS starts its top slots about 18pt in.
    // Frank is padded onto the corner's centre, so his circle is concentric with it, 21.7pt in all round: the same margin
    // as the words and bar under him. The amount sits on his centre line, 21.7pt from the side, in line with the bar's end
    expandedLeading: <HStack modifiers={[padding({leading: 4.17, top: 3.83})]}>{face(53.33)}</HStack>,
    // In a budget, the amount sits in a donut of what's left of it, Frank's circle mirrored in the other corner (trying it
    // out); the bar under it goes, since the donut says the same. The system ring is 58pt whatever its frame (measured off
    // the simulator), so it's scaled to Frank's 53.33pt; 3.5pt in puts its centre on the corner's, 48.33pt from each side
    expandedTrailing: p.pot
      ? (
        <HStack modifiers={[padding({trailing: 3.5, top: 3.83})]}>
          {/* the amount laid over the ring: inside a Live Activity, Expo's renderer drops the gauge's own value label */}
          <ZStack modifiers={[frame({width: 53.33, height: 53.33})]}>
            <Gauge value={p.fill} modifiers={[gaugeStyle("circularCapacity"), tint(blue), scaleEffect({x: 53.33 / 58, y: 53.33 / 58})]} />
            <Text modifiers={[font({size: 15, weight: "bold"}), foregroundStyle(ink), lineLimit(1), minimumScaleFactor(.6), padding({horizontal: 6})]}>{p.compact}</Text>
          </ZStack>
        </HStack>
      )
      : (
        <HStack spacing={10} modifiers={[padding({top: 11.33, trailing: 1.7})]}>
          <Text modifiers={[font({size: 32, weight: "semibold"}), foregroundStyle(ink)]}>{p.compact}</Text>
        </HStack>
      ),
    // the rest under them, the whole width: what the amount is, the payment that made it (muted), and how much of it is left
    // as a bar. The amount isn't said again in words. The only button is Frank's play button, once his line's ready; a tap
    // anywhere else opens the app
    expandedBottom: (
      <VStack alignment="leading" spacing={10} modifiers={[padding({leading: 4, trailing: 4, bottom: 8})]}>
        <VStack alignment="leading" spacing={2} modifiers={[frame({maxWidth: 10000, alignment: "leading"})]}>
          {/* while Frank speaks (the play button), his words take the headline's place a caption at a time, then it comes
              back. Shrinks a little on a narrow phone rather than lose its last word */}
          <HStack spacing={8}>
            <Text modifiers={[font({size: 17, weight: "semibold"}), foregroundStyle(ink), lineLimit(1), minimumScaleFactor(.75), frame({maxWidth: 10000, alignment: "leading"})]}>
              {p.caption || p.headline}
            </Text>
            {p.voice
              ? (
                <Button target="frank-say" modifiers={[buttonStyle("plain"), accessibilityLabel("Hear Frank")]}>
                  <Image systemName="speaker.wave.2.fill" modifiers={[font({size: 12, weight: "semibold"}), foregroundStyle(ink), frame({width: 28, height: 28}), background("#2C2C2E", shapes.circle())]} />
                </Button>
              )
              : null}
          </HStack>
          <Text modifiers={[font({size: 14}), foregroundStyle(muted), lineLimit(1)]}>{`${p.where} · ${p.paid}`}</Text>
        </VStack>
        {/* nothing under the bar: the open island is at most 160pt tall, and the amount above says it */}
        {p.pot ? null : bar}
      </VStack>
    ),
  };
};

export default createLiveActivity("CardTap", CardTap);
