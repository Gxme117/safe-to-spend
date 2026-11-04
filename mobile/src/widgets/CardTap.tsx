import {Gauge, HStack, Image, Link, ProgressView, Spacer, Text, VStack} from "@expo/ui/swift-ui";
import {
  activityBackgroundTint, background, clipShape, fixedSize, font, foregroundStyle, frame, gaugeStyle, layoutPriority, lineLimit, minimumScaleFactor, padding, progressViewStyle,
  resizable, scaleEffect, shapes, tint,
} from "@expo/ui/swift-ui/modifiers";
import {createLiveActivity} from "expo-widgets";
import type {CardTapProps} from "@/lib/cardTap";

// The card island (Live Activity: Dynamic Island and Lock Screen), from the "Card tap" artboard: a payment in an everyday
// budget shows what's left of it (blue bar, a ring when it's minimal); anything else, what's safe to spend today (white bar,
// "Ask Frank"). Its words come ready-made from `cardTapFor` (lib/cardTap.ts).
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
    compactLeading: face(24),
    compactTrailing: (
      <HStack spacing={4}>
        {p.pot && p.icon ? <Image systemName={p.icon as never} size={14} color={ink} /> : null}
        <Text modifiers={[font({size: 15, weight: "semibold"}), foregroundStyle(ink)]}>{p.compact}</Text>
      </HStack>
    ),
    minimal: p.pot
      ? <Gauge value={p.fill} modifiers={[gaugeStyle("circularCapacity"), tint(blue)]} />
      : <Text modifiers={[font({size: 12, weight: "bold"}), foregroundStyle(ink)]}>{p.minimal}</Text>,
    // all of it in one block under the camera, the whole width: iOS gives its leading, centre and trailing regions equal
    // room either side, which cut the headline short beside "Ask Frank"
    expandedBottom: (
      <VStack spacing={10} modifiers={[padding({leading: 4, trailing: 4})]}>
        <HStack spacing={10}>
          {face(48)}
          {/* takes all the room the button or "this pay" leaves, so the headline only shrinks when it has to */}
          <VStack alignment="leading" spacing={2} modifiers={[frame({maxWidth: 10000, alignment: "leading"}), layoutPriority(1)]}>
            <Text modifiers={[font({size: 14}), foregroundStyle(muted), lineLimit(1)]}>{`${p.where} · ${p.paid}`}</Text>
            {/* shrinks a little on a narrow phone rather than lose its last word */}
            <Text modifiers={[font({size: 17, weight: "semibold"}), foregroundStyle(ink), lineLimit(1), minimumScaleFactor(.75)]}>{p.headline}</Text>
          </VStack>
          {p.pot
            ? <Text modifiers={[font({size: 14}), foregroundStyle(muted)]}>{p.aside}</Text>
            : (
              <Link destination="moneytracker://tim?who=frank">
                <Text modifiers={[font({size: 14, weight: "semibold"}), foregroundStyle("#000000"), lineLimit(1), fixedSize(), padding({horizontal: 11, vertical: 7}), background(ink, shapes.capsule())]}>Ask Frank</Text>
              </Link>
            )}
        </HStack>
        <VStack modifiers={[padding({top: 12})]}>{bar}</VStack>
        {under(p.spent, p.of)}
      </VStack>
    ),
  };
};

export default createLiveActivity("CardTap", CardTap);
