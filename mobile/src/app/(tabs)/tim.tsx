import {LinearGradient} from "expo-linear-gradient";
import {useFocusEffect} from "expo-router";
import {useCallback, useEffect, useState} from "react";
import {Image, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View} from "react-native";
import {useReducedMotion} from "@/components/BigMoney";
import {Icon} from "@/components/Icon";
import {BLINK, frankBeats, lidFor, nextBeats, ON_TWOS, typingPoses, type Beat, type Lift, type Look, type Mood} from "@/lib/timEyes";
import {beatsOf, frankFrames, introFrames, linesOf, still, wordsFit, type Mouth, type SpeechFrame} from "@/lib/timSpeech";
import {useMoney, type Accountant} from "@/store/useMoney";
import {hanken, timPage} from "@/theme/tokens";
import {HomeLook, useTheme} from "@/theme/useTheme";

// Tim, your accountant (the "Accountant-Tim" frame, drawn at 440pt wide): his picture across the top, fading into the page,
// what he says beside his head, and a box to ask him anything about your money (nothing else: no name, no suggestions). He can't answer yet: there's no AI behind him so far.
// His eyes follow what you're doing: idle, typing (the box has focus or text) or thinking (just after Send).
// DROP: how far down the page he sits; his picture fades into the page at the top as well as the bottom.
const W = 440, PIC = 443, FADE = 40, DROP = 64;

// Who he is: Tim, or Frank (switched at the bottom of the page, kept in the store). Frank's picture (from the "Accountant-Frank"
// frame, 874×880 like tim.jpg, so the layout is the same) blinks, now and then looks down at his laptop and types, and says his
// own hello with his mouth moving under his moustache.
const PEOPLE: Record<Accountant, {name: string; pic: number; alt: string}> = {
  tim: {name: "Tim", pic: require("../../../assets/tim.jpg"), alt: "Tim, a clay-style accountant with grey hair and a blue scarf over a dark jumper"},
  frank: {name: "Frank", pic: require("../../../assets/frank.jpg"), alt: "Frank, a clay-style accountant with red hair, a moustache and glasses, in a knitted jumper at his laptop"},
};

// His eyes, the way stop-motion does it: replacement pieces made in advance from his own face by scripts/tim_eyes.py, swapped in.
// Looks: his pupils moved elsewhere in the whites (lib/timEyes.ts decides where and when, from his mood). Lids: his whole upper lid
// come down over the eye, a quarter, half or shut (one lid, not two). Each a transparent PNG laid over the picture where it came from
// (LOOK_CROP, LID_CROP, in the 874×880 tim.jpg; the script prints them). Looks change instantly, as eyes jump; a blink is held poses
// on twos (each 83ms, 2 frames at 24fps, no in-betweens): half, shut, shut, half, a quarter, open, and the look changes while it's shut.
// Every piece stays mounted so nothing flashes the first time it's shown. Only while the tab is showing; never with reduced motion.
const SRC_W = 874, LOOK_CROP = {x: 358, y: 263, w: 158, h: 49}, LID_CROP = {x: 352, y: 243, w: 170, h: 69};
const LOOK_PIECES: Record<Exclude<Look, "you">, number> = {
  nearLeft: require("../../../assets/tim-look-nearLeft.png"), nearRight: require("../../../assets/tim-look-nearRight.png"),
  left: require("../../../assets/tim-look-left.png"), right: require("../../../assets/tim-look-right.png"),
  down: require("../../../assets/tim-look-down.png"), downLeft: require("../../../assets/tim-look-downLeft.png"),
  downRight: require("../../../assets/tim-look-downRight.png"),
  upLeft: require("../../../assets/tim-look-upLeft.png"), upRight: require("../../../assets/tim-look-upRight.png"),
};
const LIDS = [
  {shut: .2, src: require("../../../assets/tim-blink-1.png")},
  {shut: .5, src: require("../../../assets/tim-blink-2.png")},
  {shut: 1, src: require("../../../assets/tim-blink-3.png")},
];
// Frank's are made the same way by scripts/frank_eyes.py, from frank.jpg, kept inside his glasses: his lids, and one look, down
// at his laptop, under his lid half down (downLid: frank-blink-2).
const FRANK_LOOK_CROP = {x: 364, y: 373, w: 148, h: 35}, FRANK_LID_CROP = {x: 360, y: 359, w: 156, h: 48};
const FRANK_LIDS = [
  {shut: .2, src: require("../../../assets/frank-blink-1.png")},
  {shut: .5, src: require("../../../assets/frank-blink-2.png")},
  {shut: 1, src: require("../../../assets/frank-blink-3.png")},
];
// Typing, his hands lift a little off the keys and come down (lib/timEyes.ts typingPoses), held poses on twos. All that shows
// of them beside his laptop is a cuff and a sliver of wrist each side: pieces by scripts/frank_hands.py, his own picture warped
// up a little (1) or more (2), the laptop's edge kept straight.
const FRANK_HANDS = {
  crop: {left: {x: 218, y: 681, w: 45, h: 103}, right: {x: 600, y: 681, w: 48, h: 103}},
  pieces: {
    left: [require("../../../assets/frank-hands-left-1.png"), require("../../../assets/frank-hands-left-2.png")],
    right: [require("../../../assets/frank-hands-right-1.png"), require("../../../assets/frank-hands-right-2.png")],
  },
};
type Crop = typeof LOOK_CROP;
type Side = "left" | "right";
type EyeKit = {
  id: Accountant;
  looks: {crop: Crop; pieces: Partial<Record<Look, number>>};
  lid: Crop; lids: typeof LIDS; downLid: number;
  hands?: {crop: Record<Side, Crop>; pieces: Record<Side, number[]>};
  beats: (mood: Mood) => Beat[];
};
const EYES: Record<Accountant, EyeKit> = {
  tim: {id: "tim", looks: {crop: LOOK_CROP, pieces: LOOK_PIECES}, lid: LID_CROP, lids: LIDS, downLid: lidFor("down"), beats: mood => nextBeats(mood)},
  frank: {
    id: "frank", looks: {crop: FRANK_LOOK_CROP, pieces: {down: require("../../../assets/frank-look-down.png")}},
    lid: FRANK_LID_CROP, lids: FRANK_LIDS, downLid: .5, hands: FRANK_HANDS, beats: () => frankBeats(),
  },
};
// how long he works it out after Send: the thinking beats, end to end
const THINK_MS = nextBeats("thinking").reduce((sum, b) => sum + b.ms, 0);

// His mouth, the same way (scripts/tim_mouth.py). He always smiles (his picture's mouth is straight; the smile is measured from
// a picture of him smiling): 0 is the smile, shut, always showing, with reduced motion too; talking, his jaw drops from it a
// little, slightly open, open ("e") or narrower ("y"), the corners still curled up.
// Frank's (scripts/frank_mouth.py) are under his moustache: at rest it's just his picture (no piece); talking, his jaw drops
// under the moustache's middle and the whole moustache lifts with his upper lip, its tips most.
const MOUTHS: Record<Accountant, {crop: Crop; pieces: (number | null)[]}> = {
  tim: {crop: {x: 402, y: 407, w: 75, h: 73}, pieces: [
    require("../../../assets/tim-mouth-0.png"), require("../../../assets/tim-mouth-1.png"),
    require("../../../assets/tim-mouth-2.png"), require("../../../assets/tim-mouth-3.png"),
  ]},
  frank: {crop: {x: 380, y: 438, w: 118, h: 68}, pieces: [
    null, require("../../../assets/frank-mouth-1.png"),
    require("../../../assets/frank-mouth-2.png"), require("../../../assets/frank-mouth-3.png"),
  ]},
};
// What he says each time the tab opens (lib/timSpeech.ts): who he is. The words go beside his head, on one side or the other:
// a box from the page's 16pt edge to GAP from him (figure: the leftmost and rightmost of him in his picture's px, measured off
// its pixels in the rows the words can reach, his hair at its widest), starting at row top. Frank's start higher, beside his
// glasses: his shoulders spread out below row 511. The font's sized so every line's longest word fits its box (wordsFit), so
// nothing breaks mid-word or runs off.
const WORDS: Record<Accountant, {figure: {left: number; right: number}; top: number; said: () => SpeechFrame[]}> = {
  tim: {figure: {left: 271, right: 573}, top: 318, said: introFrames},
  frank: {figure: {left: 288, right: 579}, top: 240, said: frankFrames},
};
const EDGE = 16, GAP = 8, SIZE = 22, LEADING = 28 / 22;

const hidden = {pointerEvents: "none", accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants"} as const;
const place = (c: typeof LOOK_CROP, k: number) =>
  ({position: "absolute" as const, left: c.x * k, top: c.y * k, width: c.w * k, height: c.h * k});

/** Plays what he says whenever the tab shows: the words so far, his mouth, and his eyes' beats while he's saying it.
 *  Each time, it's who he is, from the start. replay(): he says it again, from the start (a tap on him). */
function useSpeech(reduced: boolean, who: Accountant) {
  const [again, setAgain] = useState(0);
  const [frame, setFrame] = useState<SpeechFrame>(() => WORDS[who].said()[0]);
  const [script, setScript] = useState<{who: Accountant; beats: Beat[]}>(); // whose, so a switch never plays the other's
  const [lines, setLines] = useState<ReturnType<typeof linesOf>>([]);
  useFocusEffect(useCallback(() => {
    const said = WORDS[who].said();
    const frames = reduced ? still(said) : said; // reduced: each line all at once, his mouth still
    setLines(linesOf(said));
    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = 0;
    setFrame(frames[0]);
    if (!reduced) setScript({who, beats: beatsOf(said)});
    for (const f of frames) { timers.push(setTimeout(() => setFrame(f), at)); at += f.ms; }
    timers.push(setTimeout(() => setScript(undefined), at));
    return () => { timers.forEach(clearTimeout); setFrame(frames[frames.length - 1]); setScript(undefined); };
  }, [reduced, who, again])); // eslint-disable-line react-hooks/exhaustive-deps -- again: a tap on him starts him over
  const replay = useCallback(() => setAgain(n => n + 1), []);
  return {...frame, script: script?.who === who ? script.beats : undefined, lines, replay};
}

function MouthPieces({width, who, mouth}: {width: number; who: Accountant; mouth: Mouth}) {
  const k = width / SRC_W, {crop, pieces} = MOUTHS[who];
  return <>
    {pieces.map((src, i) => src !== null && (
      <Image key={i} source={src} testID={mouth !== i ? undefined : i ? `${who}-mouth` : `${who}-smile`} style={[place(crop, k), {opacity: mouth === i ? 1 : 0}]} {...hidden} />
    ))}
  </>;
}

// kit: whose eyes (his pieces, and how they move; Frank's hands too, as they go with where he looks). script: beats to play
// first (his hello), before going on with his mood's
function Eyes({width, kit, mood, script}: {width: number; kit: EyeKit; mood: Mood; script?: Beat[]}) {
  const reduced = useReducedMotion();
  const [look, setLook] = useState<Look>("you");
  const [blink, setBlink] = useState(0);
  const [hands, setHands] = useState<Record<Side, Lift>>({left: 0, right: 0});
  useFocusEffect(useCallback(() => {
    if (reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, f: () => void) => timers.push(setTimeout(f, ms));
    const play = (beats: Beat[]) => {
      timers.length = 0; // the last round's have all gone off
      let at = 0;
      for (const b of beats) {
        if (b.blink) {
          BLINK.forEach((p, i) => later(at + i * ON_TWOS, () => setBlink(p)));
          later(at + ON_TWOS, () => setLook(b.look)); // while the lid's shut
        } else later(at, () => setLook(b.look));
        if (b.typing && kit.hands) {
          let t = at;
          for (const {left, right, ms} of typingPoses(b.ms)) { later(t, () => setHands({left, right})); t += ms; }
        }
        at += b.ms;
      }
      later(at, () => play(kit.beats(mood)));
    };
    play(script ?? kit.beats(mood)); // a new mood (or he's starting to talk): he reacts straight away
    return () => { timers.forEach(clearTimeout); setBlink(0); setHands({left: 0, right: 0}); };
  }, [reduced, kit, mood, script]));
  if (reduced) return null;
  const k = width / SRC_W, {looks, hands: handKit} = kit;
  const lid = Math.max(blink, lidFor(look, kit.downLid)); // looking down, the lid follows
  return <>
    {(Object.keys(looks.pieces) as Look[]).map(l => (
      <Image key={l} source={looks.pieces[l]} testID={look === l ? `${kit.id}-look-${l}` : undefined} style={[place(looks.crop, k), {opacity: look === l ? 1 : 0}]} {...hidden} />
    ))}
    {handKit && (["left", "right"] as const).flatMap(side => handKit.pieces[side].map((src, i) => {
      const on = hands[side] === i + 1;
      return <Image key={`${side}-${i}`} source={src} testID={on ? `${kit.id}-hand-${side}` : undefined} style={[place(handKit.crop[side], k), {opacity: on ? 1 : 0}]} {...hidden} />;
    }))}
    {kit.lids.map(l => (
      <Image key={l.shut} source={l.src} testID={lid === l.shut ? `${kit.id}-lid` : undefined} style={[place(kit.lid, k), {opacity: lid === l.shut ? 1 : 0}]} {...hidden} />
    ))}
  </>;
}

function Tim() {
  const {c, dark} = useTheme();
  const {width} = useWindowDimensions();
  const who = useMoney(st => st.accountant);
  const {name, pic: src, alt} = PEOPLE[who];
  const isTim = who === "tim";
  const [q, setQ] = useState("");
  const [boxFocused, setBoxFocused] = useState(false);
  const [thinking, setThinking] = useState(false);
  useEffect(() => {
    if (!thinking) return;
    const t = setTimeout(() => setThinking(false), THINK_MS);
    return () => clearTimeout(t);
  }, [thinking]);
  const mood: Mood = thinking ? "thinking" : boxFocused || q.trim() ? "typing" : "idle";
  const reduced = useReducedMotion();
  const speech = useSpeech(reduced, who);
  const pic = width * PIC / W, k = width / SRC_W;
  // where his words go: beside his head, on this line's side
  const {figure, top} = WORDS[who];
  const room = {left: figure.left * k - GAP - EDGE, right: width - EDGE - figure.right * k - GAP};
  const words = speech.side === "left"
    ? {left: EDGE, width: room.left, textAlign: "right" as const}
    : {left: figure.right * k + GAP, width: room.right, textAlign: "left" as const};
  const size = wordsFit(speech.lines, room, SIZE);
  const bg = dark ? c.bg : timPage; // light, the page is his picture's own background
  const box = dark ? c.surface : "#FFFFFF", edge = dark ? c.line : "#E4E1DA";

  const ask = () => {
    if (!q.trim()) return;
    setThinking(true);
    useMoney.getState().notify(`${name} can't answer yet. He's coming soon.`);
  };

  return (
    <ScrollView contentContainerStyle={{alignItems: "center", paddingHorizontal: 32, paddingBottom: 32}} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={{width, height: pic, marginHorizontal: -32, marginTop: DROP}}>
        <Image source={src} style={{width, height: pic}} resizeMode="cover" accessibilityLabel={alt} />
        {/* tap him and he says who he is again */}
        <Pressable onPress={speech.replay} style={{position: "absolute", left: 0, top: 0, right: 0, bottom: 0}}
          accessibilityRole="button" accessibilityLabel={`Hear ${name} say who he is`} />
        {/* Frank goes on with his own work, whatever you're doing, but looks at you while he talks */}
        <Eyes key={`eyes-${who}`} width={width} kit={EYES[who]} mood={isTim ? mood : "idle"} script={isTim && mood !== "idle" ? undefined : speech.script} />
        <MouthPieces key={`mouth-${who}`} width={width} who={who} mouth={speech.mouth} />
        <Text accessibilityLabel={speech.said ? `${name} says: ${speech.shown.replace(/^\.+/, "")}` : undefined} accessibilityLiveRegion="polite"
          style={{position: "absolute", ...words, top: top * k, fontFamily: hanken.medium, fontSize: size, lineHeight: Math.round(size * LEADING), color: c.ink}}>
          {speech.shown}
        </Text>
        <LinearGradient colors={[bg, bg + "00"]} style={{position: "absolute", left: 0, right: 0, top: 0, height: FADE}} pointerEvents="none" />
        <LinearGradient colors={[bg + "00", bg]} style={{position: "absolute", left: 0, right: 0, bottom: 0, height: FADE}} pointerEvents="none" />
      </View>

      <View style={{marginTop: 24, alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 8, height: 52, paddingLeft: 20, paddingRight: 7, borderRadius: 999, backgroundColor: box, borderWidth: 1, borderColor: edge}}>
        <TextInput value={q} onChangeText={setQ} placeholder={`Ask ${name} anything…`} placeholderTextColor={c.muted} accessibilityLabel={`Ask ${name} a question`}
          autoComplete="off" returnKeyType="send" onSubmitEditing={ask} onFocus={() => setBoxFocused(true)} onBlur={() => setBoxFocused(false)}
          style={{flex: 1, minWidth: 0, fontFamily: hanken.medium, fontSize: 17, color: c.ink, paddingVertical: 0}} />
        <Pressable onPress={ask} accessibilityRole="button" accessibilityLabel="Send" hitSlop={4}
          style={{width: 38, height: 38, borderRadius: 19, backgroundColor: c.ink, alignItems: "center", justifyContent: "center"}}>
          <Icon name="up" color={c.bg} size={16} />
        </Pressable>
      </View>

      {/* who your accountant is: a two-way switch */}
      <View accessibilityRole="radiogroup" accessibilityLabel="Your accountant"
        style={{marginTop: 32, flexDirection: "row", padding: 3, borderRadius: 999, backgroundColor: dark ? c.surface : "#ECE9E3"}}>
        {(Object.keys(PEOPLE) as Accountant[]).map(a => {
          const on = a === who;
          return (
            <Pressable key={a} onPress={() => useMoney.getState().setAccountant(a)} accessibilityRole="radio" accessibilityState={{selected: on}}
              style={{height: 32, paddingHorizontal: 18, borderRadius: 999, justifyContent: "center", backgroundColor: on ? (dark ? c.line : "#FFFFFF") : "transparent"}}>
              <Text style={{fontFamily: hanken.medium, fontSize: 15, color: on ? c.ink : c.muted}}>{PEOPLE[a].name}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

export default function TimScreen() {
  return <HomeLook value><Tim /></HomeLook>;
}
