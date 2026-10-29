import {LinearGradient} from "expo-linear-gradient";
import {useFocusEffect} from "expo-router";
import {useCallback, useEffect, useRef, useState} from "react";
import {AccessibilityInfo, Dimensions, Image, Keyboard, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View, type HostInstance, type ScrollViewInstance} from "react-native";
import {useReanimatedKeyboardAnimation} from "react-native-keyboard-controller";
import Reanimated, {Easing, useAnimatedStyle, useSharedValue, withTiming} from "react-native-reanimated";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {useReducedMotion} from "@/components/BigMoney";
import {ConsentSheet} from "@/components/ConsentSheet";
import {Icon} from "@/components/Icon";
import {keyboardCover} from "@/components/Setup";
import {converse, type Answer, type Ended, type Transcript} from "@/lib/ai/converse";
import {receipt, type ToolEffect} from "@/lib/ai/tools";
import {uid} from "@/lib/defaults";
import {BLINK, frankBeats, lidFor, nextBeats, ON_TWOS, typingPoses, type Beat, type Lift, type Look, type Mood} from "@/lib/timEyes";
import {beatsOf, frankFrames, introFrames, linesOf, still, wordsFit, type Mouth, type SpeechFrame} from "@/lib/timSpeech";
import {AccountantFail, send, type AccountantError} from "@/services/accountant";
import {useMoney, type Accountant} from "@/store/useMoney";
import {hanken, timPage} from "@/theme/tokens";
import {HomeLook, useTheme} from "@/theme/useTheme";

// Tim, your accountant (the "Accountant-Tim" frame, drawn at 440pt wide): his picture across the top, fading into the page,
// what he says beside his head, and a box to ask him anything about your money (nothing else: no name, no suggestions).
// Claude does his thinking (lib/ai/converse.ts): it looks up what a question needs with the app's own engine, run here, and
// every £ in the answer is checked against what it looked up. The line under an answer says what it was checked against.
// His eyes follow what you're doing: idle, typing (the box has focus or text) or thinking (until his answer lands).
// DROP: how far down the page he sits; his picture fades into the page at the top as well as the bottom.
const W = 440, PIC = 443, FADE = 40, DROP = 64;

// Who he is: Tim, or Frank (switched at the top of the page, kept in the store). Frank's picture (from the "Accountant-Frank"
// frame, 874×880 like tim.jpg, so the layout is the same) blinks, now and then looks down at his laptop and types, and says his
// own hello with his mouth moving under his moustache.
// `fails`: what he says, in his own voice, when he can't answer (never a scold, never the error itself).
type Fail = AccountantError | Ended;
const PEOPLE: Record<Accountant, {name: string; pic: number; alt: string; fails: Record<Fail, string>}> = {
  tim: {name: "Tim", pic: require("../../../assets/tim.jpg"), alt: "Tim, a clay-style accountant with grey hair and a blue scarf over a dark jumper",
    fails: {
      offline: "I can't reach my notes right now. Check your connection and ask me again.",
      timeout: "That took me too long, sorry. Could you ask again?",
      busy: "I'm a bit swamped right now. Ask me again in a minute.",
      unavailable: "Something's gone wrong on my side. Try again in a bit.",
      "not-set-up": "I'm not switched on yet. The app needs setting up first.",
      refused: "I can't help with that one. Ask me something about your money?",
      "cut-off": "I lost my thread there. Could you ask that again, a bit narrower?",
      "went-round": "I went round in circles on that one. Could you ask it another way?",
    }},
  frank: {name: "Frank", pic: require("../../../assets/frank.jpg"), alt: "Frank, a clay-style accountant with red hair, a moustache and glasses, in a knitted jumper at his laptop",
    fails: {
      offline: "No connection, so I can't see your numbers. Try again when you've got signal.",
      timeout: "Took too long. Ask again.",
      busy: "Busy. Ask again in a minute.",
      unavailable: "Something's broken on my end. Try again later.",
      "not-set-up": "Not switched on yet. Someone has to set me up first.",
      refused: "Not something I can help with. Money questions, please.",
      "cut-off": "Lost my thread. Ask again, smaller.",
      "went-round": "Went round in circles. Ask it another way.",
    }},
};
// One thing said in the conversation: yours, or his (`who` is who it was with, so switching shows only theirs).
// His: `checked`, what the answer was checked against; `flag`, figures it couldn't check; `quiet`, he couldn't answer.
type Said = {id: number; who: Accountant; mine: boolean; text: string; checked?: string | null; flag?: string; quiet?: boolean};
// one answer, as said in the conversation
function saidOf(who: Accountant, a: Answer, now: Date): Omit<Said, "id"> {
  if (a.ended || !a.text) return {who, mine: false, text: PEOPLE[who].fails[a.ended ?? "went-round"], quiet: true};
  const state = useMoney.getState().state;
  return {
    who, mine: false, text: a.text, checked: state && receipt(a.used, state, now),
    ...a.unchecked.length ? {flag: `I couldn't check ${a.unchecked.join(", ")} against your numbers.`} : {},
  };
}
// The box grows with what you type, up to this many lines, then scrolls inside itself.
const BOX_LINE = 22, BOX_LINES = 5;

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

// Once you've asked him something, he shrinks into a bubble at the top left, your question beside it ("Frank · Explanatory B"),
// so his answer starts near the top. BUBBLE: his picture's scale in the bubble (pt per px of the 874px picture) and the px at
// the bubble's top left. Each one's head is centred in it, his hair to his chin and ear to ear measured off his picture
// (Frank's rows 185–500, 288–579), with a little collar under it; Tim's long face is fitted so his smile's in. Both checked
// by laying the crop onto his picture. In light mode his hair comes out over the top, fading out HAIR pt down (B's
// 34 to 46): a copy of his picture behind the bubble, on the page's own colour, so only his hair shows. TOP_ROOM: above the
// bubble, under the switch, for it.
const BUBBLE_D = 88, HAIR = [34, 46] as const, TOP_ROOM = 16, SWITCH_H = 36, SHRINK_MS = 400;
const BUBBLE: Record<Accountant, {scale: number; x: number; y: number}> = {
  tim: {scale: .23, x: 241.5, y: 117.5},
  frank: {scale: .23, x: 242, y: 151},
};

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
  const insets = useSafeAreaInsets();
  const who = useMoney(st => st.accountant);
  const {name, pic: src, alt} = PEOPLE[who];
  const isTim = who === "tim";
  const [q, setQ] = useState("");
  const [boxFocused, setBoxFocused] = useState(false);
  const [thread, setThread] = useState<Said[]>([]);
  // who's a bubble: each from your Send until you tap him back
  const [smallFor, setSmallFor] = useState<Record<Accountant, boolean>>({tim: false, frank: false});
  // each accountant's conversation exactly as Claude saw it, for this visit to the app (not kept, like the thread)
  const talks = useRef<Record<Accountant, Transcript>>({tim: [], frank: []});
  // who's working out an answer, and what he's doing right now; one question at a time
  const [working, setWorking] = useState<{who: Accountant; doing: string} | null>(null);
  // a question waiting for you to say he can look at your numbers
  const [waiting, setWaiting] = useState<string | null>(null);
  const follow = useRef(false); // something was just said: scroll to it once it's laid out
  const say = (s: Omit<Said, "id">) => { follow.current = true; setThread(th => [...th, {...s, id: th.length}]); };
  const thinking = working?.who === who;
  const mood: Mood = thinking ? "thinking" : boxFocused || q.trim() ? "typing" : "idle";
  const reduced = useReducedMotion();

  // The box stays at the bottom, above the tab bar, and rides up with the keyboard frame for frame (keyboard-controller reports
  // where the keys are on the UI thread, so it starts, eases and stops with them, and follows a drag that puts them away).
  // The conversation keeps scrolling above it: what the keyboard covers is added to its bottom inset, so the last thing said
  // can always be scrolled into view. iOS only: Android resizes the window itself.
  const page = useRef<HostInstance>(null), scroll = useRef<ScrollViewInstance>(null);
  const [under, setUnder] = useState(0); // the tab bar and home indicator, under the page
  const measure = () => page.current?.measureInWindow((_x, y, _w, h) => setUnder(Math.max(0, Math.round(Dimensions.get("window").height - y - h))));
  const {height: keys} = useReanimatedKeyboardAnimation(); // minus the keyboard's height, this frame
  const ios = Platform.OS === "ios";
  // up by what the keyboard covers above the tab bar; nothing when it covers less
  const lift = useAnimatedStyle(() => ({transform: [{translateY: ios ? Math.min(0, keys.value + under) : 0}]}));
  const [covered, setCovered] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const show = Keyboard.addListener("keyboardWillShow", e => setCovered(Math.max(0, keyboardCover(e.endCoordinates) - under)));
    const hide = Keyboard.addListener("keyboardWillHide", () => setCovered(0));
    return () => { show.remove(); hide.remove(); };
  }, [under]);
  // the keyboard's up: keep the latest of the conversation in view above the box
  const talked = thread.some(s => s.who === who);
  useEffect(() => {
    if (covered && talked) scroll.current?.scrollToEnd({animated: !reduced});
  }, [covered, talked, reduced]);
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

  // Asked something, he's a bubble (0: his picture, 1: the bubble), pinned at the top as the conversation scrolls, your latest
  // question beside it. He shrinks into it as you send; tap it and he's back as he was, with his hello. A switch to the other
  // accountant shows him as he is straight away, and so does reduced motion.
  const small = smallFor[who];
  const asked = small ? thread.findLast(s => s.who === who && s.mine) : undefined;
  const shrunk = useSharedValue(small ? 1 : 0), was = useRef(who);
  useEffect(() => {
    const to = small ? 1 : 0;
    shrunk.value = reduced || was.current !== who ? to : withTiming(to, {duration: SHRINK_MS, easing: Easing.out(Easing.cubic)});
    was.current = who;
  }, [small, who, reduced, shrunk]);
  const grow = () => {
    setSmallFor(sm => ({...sm, [who]: false}));
    scroll.current?.scrollTo({y: 0, animated: !reduced});
    speech.replay();
  };
  const bubbleTop = insets.top + SWITCH_H + TOP_ROOM, {scale: bs, x: bx, y: by} = BUBBLE[who], fit = bs / k;
  // the clip goes from his whole picture to the round bubble, and his picture shrinks inside it to his face
  const clip = useAnimatedStyle(() => {
    const p = shrunk.value, at = (a: number, b: number) => a + (b - a) * p;
    return {left: at(0, 32), top: at(DROP, bubbleTop), width: at(width, BUBBLE_D), height: at(pic, BUBBLE_D), borderRadius: at(0, BUBBLE_D / 2)};
  });
  const face = useAnimatedStyle(() => {
    const p = shrunk.value, at = (a: number, b: number) => a + (b - a) * p;
    return {transform: [{translateX: at(0, -bx * bs)}, {translateY: at(0, -by * bs)}, {scale: at(1, fit)}]};
  });
  const ring = useAnimatedStyle(() => ({borderRadius: shrunk.value * BUBBLE_D / 2, opacity: shrunk.value}));
  const space = useAnimatedStyle(() => ({minHeight: DROP + pic + (bubbleTop + BUBBLE_D - DROP - pic) * shrunk.value}));
  const after = useAnimatedStyle(() => ({opacity: Math.max(0, shrunk.value - .8) / .2})); // the words and his hair, as he lands

  // a note he saves or crosses out: done straight away, with Undo on the toast
  const note = (effect: ToolEffect, by: Accountant) => {
    const st = useMoney.getState(), {name: his} = PEOPLE[by];
    if ("add" in effect) {
      st.addNote(effect.add);
      st.notify(`${his} noted: ${effect.add.text}`, false, () => { useMoney.getState().removeNote(effect.add.id); });
    } else {
      const gone = st.removeNote(effect.remove.id);
      if (gone) st.notify(`${his} crossed out: ${gone.note.text}`, false, () => useMoney.getState().restoreNote(gone.note, gone.at));
    }
  };
  const go = (text: string) => {
    const to = who;
    say({who: to, mine: true, text});
    setSmallFor(sm => ({...sm, [to]: true}));
    setWorking({who: to, doing: "Thinking…"});
    converse(talks.current[to], text, {
      send: m => send(to, m),
      env: () => {
        const st = useMoney.getState();
        return {ctx: {state: st.state!, txs: st.txs, today: st.today}, notes: st.notes, who: to, newId: () => "n_" + uid()};
      },
      apply: effect => note(effect, to),
      doing: doing => setWorking(w => w && {...w, doing}),
    }, new Date())
      .then(a => { talks.current[to] = a.transcript; say(saidOf(to, a, new Date())); })
      .catch(e => {
        // the question stays in the thread; the conversation carries on from before it
        if (!(e instanceof AccountantFail)) console.warn("Accountant failed:", e instanceof Error ? e.message : e);
        say({who: to, mine: false, text: PEOPLE[to].fails[e instanceof AccountantFail ? e.kind : "unavailable"], quiet: true});
      })
      .finally(() => setWorking(null));
  };
  const ask = () => {
    const text = q.trim();
    if (!text || working || !useMoney.getState().state) return;
    setQ("");
    // the first time, he asks before looking at your numbers
    if (!useMoney.getState().aiConsent) setWaiting(text);
    else go(text);
  };
  // read out what he's doing, and what he says when he's done
  const last = thread[thread.length - 1];
  useEffect(() => { if (working) AccessibilityInfo.announceForAccessibility(working.doing); }, [working]);
  useEffect(() => { if (last && !last.mine) AccessibilityInfo.announceForAccessibility(`${PEOPLE[last.who].name} says: ${last.text}`); }, [last]);

  return (
    <View ref={page} onLayout={measure} style={{flex: 1}}>
    {/* a drag on the conversation puts the keyboard away, and the box comes down with it */}
    {/* while he's a bubble, it and your question stay at the top (the first child sticks) as the conversation scrolls under them */}
    <ScrollView ref={scroll} testID="conversation" style={{flex: 1}} contentContainerStyle={{alignItems: "center", paddingHorizontal: 32, paddingBottom: 24}}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" stickyHeaderIndices={small ? [0] : []}
      contentInset={{bottom: covered}} scrollIndicatorInsets={{bottom: covered}}
      onContentSizeChange={() => { if (follow.current) { follow.current = false; scroll.current?.scrollToEnd({animated: !reduced}); } }}>
      <Reanimated.View style={[{alignSelf: "stretch", marginHorizontal: -32, backgroundColor: bg}, space]}>
        {/* asked something: room for his bubble, and your latest question beside it */}
        {asked && (
          <View style={{flexDirection: "row", alignItems: "flex-start", gap: 12, paddingTop: bubbleTop, paddingHorizontal: 32}}>
            <View style={{width: BUBBLE_D, height: BUBBLE_D}} />
            {/* centred on the bubble; a long question runs on below it */}
            <Reanimated.View accessible accessibilityLabel={`You asked: ${asked.text}`} style={[{flex: 1, minWidth: 0, alignSelf: "center", gap: 4}, after]}>
              <Text style={{fontFamily: hanken.semibold, fontSize: 12, lineHeight: 15, letterSpacing: 1, textTransform: "uppercase", color: c.muted}}>You asked</Text>
              <Text style={{fontFamily: hanken.semibold, fontSize: 18, lineHeight: 23, letterSpacing: -.18, color: c.ink}}>{asked.text}</Text>
            </Reanimated.View>
          </View>
        )}
        {/* the conversation fades in under it as it scrolls */}
        {small && <LinearGradient colors={[bg, bg + "00"]} style={{position: "absolute", left: 0, right: 0, bottom: -16, height: 16}} pointerEvents="none" />}
        {/* his hair out over the bubble's top (light mode: the copy's background is the page's own) */}
        {asked && !dark && (
          <Reanimated.View {...hidden} style={[{position: "absolute", left: 32, top: bubbleTop - TOP_ROOM, width: BUBBLE_D, height: TOP_ROOM + HAIR[1], overflow: "hidden"}, after]}>
            <Image source={src} style={{position: "absolute", left: -bx * bs, top: TOP_ROOM - by * bs, width: SRC_W * bs, height: SRC_W * bs * PIC / W}} resizeMode="cover" />
            <LinearGradient colors={[bg + "00", bg]} style={{position: "absolute", left: 0, right: 0, top: TOP_ROOM + HAIR[0], height: HAIR[1] - HAIR[0]}} />
          </Reanimated.View>
        )}
        <Reanimated.View style={[{position: "absolute", overflow: "hidden"}, clip]}>
          <Reanimated.View style={[{width, height: pic, transformOrigin: "left top"}, face]}>
            <Image source={src} style={{width, height: pic}} resizeMode="cover" accessibilityLabel={alt} />
            {/* tap him and he says who he is again (not once he's a bubble) */}
            {!small && <Pressable onPress={speech.replay} style={{position: "absolute", left: 0, top: 0, right: 0, bottom: 0}}
              accessibilityRole="button" accessibilityLabel={`Hear ${name} say who he is`} />}
            {/* Frank goes on with his own work, whatever you're doing, but looks at you while he talks */}
            <Eyes key={`eyes-${who}`} width={width} kit={EYES[who]} mood={isTim ? mood : "idle"} script={isTim && mood !== "idle" ? undefined : speech.script} />
            <MouthPieces key={`mouth-${who}`} width={width} who={who} mouth={speech.mouth} />
            {!small && <Text accessibilityLabel={speech.said ? `${name} says: ${speech.shown.replace(/^\.+/, "")}` : undefined} accessibilityLiveRegion="polite"
              style={{position: "absolute", ...words, top: top * k, fontFamily: hanken.medium, fontSize: size, lineHeight: Math.round(size * LEADING), color: c.ink}}>
              {speech.shown}
            </Text>}
            <LinearGradient colors={[bg, bg + "00"]} style={{position: "absolute", left: 0, right: 0, top: 0, height: FADE}} pointerEvents="none" />
            <LinearGradient colors={[bg + "00", bg]} style={{position: "absolute", left: 0, right: 0, bottom: 0, height: FADE}} pointerEvents="none" />
          </Reanimated.View>
          {!dark && <Reanimated.View pointerEvents="none" style={[{position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderWidth: 1, borderColor: "rgba(0,0,0,.05)"}, ring]} />}
          {/* tap the bubble and he's back as he was */}
          {small && <Pressable onPress={grow} style={{position: "absolute", left: 0, top: 0, right: 0, bottom: 0}}
            accessibilityRole="button" accessibilityLabel={`Show ${name} again`} />}
        </Reanimated.View>
      </Reanimated.View>

      {/* the conversation (less the question beside his bubble): yours on the right in a bubble, his on the left as plain words */}
      {talked && (
        <View style={{marginTop: 24, alignSelf: "stretch", gap: 16}}>
          {thread.filter(s => s.who === who && s !== asked).map(s => s.mine ? (
            <View key={s.id} style={{alignSelf: "flex-end", maxWidth: "80%", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, backgroundColor: box, borderWidth: 1, borderColor: edge}}>
              <Text accessibilityLabel={`You asked: ${s.text}`} style={{fontFamily: hanken.medium, fontSize: 17, lineHeight: BOX_LINE, color: c.ink}}>{s.text}</Text>
            </View>
          ) : (
            <View key={s.id} style={{alignSelf: "flex-start", maxWidth: "90%", gap: 6}}>
              <Text accessibilityLabel={`${name} says: ${s.text}`}
                style={{fontFamily: hanken.medium, fontSize: 17, lineHeight: BOX_LINE, color: s.quiet ? c.muted : c.ink}}>{s.text}</Text>
              {/* where the figures came from, and any he couldn't check */}
              {s.checked ? <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{s.checked}</Text> : null}
              {s.flag ? <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{s.flag}</Text> : null}
            </View>
          ))}
          {/* what he's doing while he works it out, where his answer will go */}
          {thinking ? <Text style={{alignSelf: "flex-start", fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.muted}}>{working?.doing}</Text> : null}
        </View>
      )}
    </ScrollView>

    {/* who your accountant is: a two-way switch, pinned just under the status bar, like a chat app's model picker. The page's
        colour behind it, so the conversation scrolls under it; at rest it only covers his picture's empty top, above his hair. */}
    <View style={{position: "absolute", left: 0, right: 0, top: 0, paddingTop: insets.top, paddingBottom: 4, alignItems: "center", backgroundColor: bg}}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Your accountant"
        style={{flexDirection: "row", padding: 2, borderRadius: 999, backgroundColor: dark ? c.surface : "#ECE9E3"}}>
        {(Object.keys(PEOPLE) as Accountant[]).map(a => {
          const on = a === who;
          return (
            <Pressable key={a} onPress={() => useMoney.getState().setAccountant(a)} accessibilityRole="radio" accessibilityState={{selected: on}} hitSlop={{top: 6, bottom: 6}}
              style={{height: 28, paddingHorizontal: 16, borderRadius: 999, justifyContent: "center", backgroundColor: on ? (dark ? c.line : "#FFFFFF") : "transparent"}}>
              <Text style={{fontFamily: hanken.medium, fontSize: 15, color: on ? c.ink : c.muted}}>{PEOPLE[a].name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>

    {/* the question box, at the bottom as in the OpenAI app; it grows as you write (return makes a new line), Send sends */}
    <Reanimated.View style={[{paddingHorizontal: 32, paddingTop: 8, paddingBottom: 12, backgroundColor: bg}, lift]}>
      <View style={{alignSelf: "stretch", flexDirection: "row", alignItems: "flex-end", gap: 8, minHeight: 52, paddingLeft: 20, paddingRight: 6, paddingVertical: 6, borderRadius: 26, backgroundColor: box, borderWidth: 1, borderColor: edge}}>
        <TextInput value={q} onChangeText={setQ} placeholder={`Ask ${name} anything…`} placeholderTextColor={c.muted} accessibilityLabel={`Ask ${name} a question`}
          multiline autoComplete="off" onFocus={() => setBoxFocused(true)} onBlur={() => setBoxFocused(false)}
          style={{flex: 1, minWidth: 0, maxHeight: BOX_LINE * BOX_LINES + 16, fontFamily: hanken.medium, fontSize: 17, lineHeight: BOX_LINE, color: c.ink, paddingTop: 8, paddingBottom: 8}} />
        {/* one question at a time: while he's working it out, Send waits */}
        <Pressable onPress={ask} disabled={!!working} accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{disabled: !!working}} hitSlop={4}
          style={{width: 38, height: 38, borderRadius: 19, backgroundColor: c.ink, alignItems: "center", justifyContent: "center", opacity: working ? 0.35 : 1}}>
          <Icon name="up" color={c.bg} size={16} />
        </Pressable>
      </View>
    </Reanimated.View>
    <ConsentSheet visible={waiting !== null} name={name}
      onYes={() => { const text = waiting ?? ""; setWaiting(null); useMoney.getState().setAiConsent(true); if (text) go(text); }}
      onNo={() => { setQ(waiting ?? ""); setWaiting(null); }} />
    </View>
  );
}

export default function TimScreen() {
  return <HomeLook value><Tim /></HomeLook>;
}
