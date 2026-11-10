import {setAudioModeAsync, useAudioPlayer, type AudioSource} from "expo-audio";
import {GlassView} from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import {LinearGradient} from "expo-linear-gradient";
import {router, useFocusEffect, useLocalSearchParams} from "expo-router";
import {openBrowserAsync} from "expo-web-browser";
import {useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type MutableRefObject} from "react";
import {AccessibilityInfo, Dimensions, Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type HostInstance, type ImageSourcePropType, type ScrollViewInstance, type TextInputInstance} from "react-native";
import {canDictate, mic, micLang, useMicEvent} from "@/services/dictation";
import {useKeyboardHeight} from "@/services/keyboard";
import {useVideoPlayer, VideoView} from "@/services/video";
import Reanimated, {Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming} from "react-native-reanimated";
import Svg, {Path} from "react-native-svg";
import {MerchantLogo} from "@/components/TxRow";
import {bubblesAt, holdMs, searchStops, STEP_MS, type Stop} from "@/lib/orgSearch";
import {entryAt, type EntryGeo, type OrgOrigin} from "@/lib/orgEntry";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {useChrome} from "@/store/chrome";
import {useReducedMotion} from "@/components/BigMoney";
import {CategoryPick} from "@/components/CategoryPick";
import {CategorySheet} from "@/components/CategorySheet";
import {ConsentSheet} from "@/components/ConsentSheet";
import {Attachments, PlusCard} from "@/components/PlusCard";
import {MAX_ATTACH, readFrom, shownOf, tooMuch, type Attachment, type Shown} from "@/lib/ai/attach";
import {fromCamera, fromFiles, fromPhotos, type Picked} from "@/services/attach";
import {Icon} from "@/components/Icon";
import {ChatsPanel, type Face} from "@/components/ChatsPanel";
import {deleteChat, listChats, loadChat, pruneChats, saveChat} from "@/db/chats";
import {bodyOf, cutoff, fromSaved, titleOf, toSaved, type ChatRow} from "@/lib/chats";
import {keyboardCover} from "@/components/Setup";
import {AnswerFigure} from "@/components/AnswerFigure";
import {BillCard, type CardStatus} from "@/components/BillCard";
import {CategoryCard} from "@/components/CategoryCard";
import {OrgCard, type EditTarget, type OrgCardStatus} from "@/components/OrgCard";
import {ResearchCard} from "@/components/ResearchCard";
import {doneLine, leftLine, outcomeLine, proposalView, type Proposal, type ProposalView} from "@/lib/billChange";
import {catDoneLine, catLeftLine, catOutcomeLine} from "@/lib/categoryChange";
import type {CategoryProposal} from "@/lib/types";
import {isNewView, researchView, type OldResearchView, type ResearchView, type Tile} from "@/lib/ai/research";
import {yesNo} from "@/lib/ai/yesNo";
import {converse, type Answer, type Deps, type Ended, type Transcript} from "@/lib/ai/converse";
import {briefingAsk, briefingDue, briefingFacts, logBrief} from "@/lib/briefing";
import type {Visual} from "@/lib/ai/visual";
import type {Source} from "@/lib/ai/web";
import {roundOf, stopwatch, type Stopwatch} from "@/lib/ai/timings";
import {receipt, type BuildOrgResult, type ToolEffect} from "@/lib/ai/tools";
import {orgOutcomeLine, type OrgEdits, type OrgProposal, type PendingOrg} from "@/lib/orgProposal";
import type {OrgReport} from "@/lib/organise";
import {uid} from "@/lib/defaults";
import {calmly, micRefused, micState, MIC_BUTTON, transcriptOf, withHeard} from "@/lib/dictation";
import {pieceFor} from "@/lib/lipsync";
import {BLINK, frankBeats, frankSearchBeats, lidFor, nextBeats, ON_TWOS, typingPoses, type Beat, type Lift, type Look, type Mood} from "@/lib/timEyes";
import {answerFrames, beatsFrom, beatsOf, bubbleFits, CAPTION, FILM_OPENING, FILM_VOICE, FRANK_BOX, frankFrames, linesOf, roomOf, still, TIM_BOX, timFrames, waitFrames, wordsFit, type Mouth, type SpeechFrame, type Take} from "@/lib/timSpeech";
import {AccountantFail, say as sayAloud, send, shop, type AccountantError} from "@/services/accountant";
import {FRANK_WAIT_CLIPS} from "../../../assets/frankWait-voice";
import {FRANK_CLIPS} from "../../../assets/frank-voice";
import {FRANK_FILMS} from "../../../assets/frank-video";
import {TIM_CLIPS} from "../../../assets/tim-voice";
import {useMoney, type Accountant} from "@/store/useMoney";
import {GLASS} from "@/theme/glass";
import {hanken, timPage} from "@/theme/tokens";
import {HomeLook, useTheme} from "@/theme/useTheme";

// Tim, your accountant (the "Accountant-Tim" frame, drawn at 440pt wide): his picture across the top, fading into the page,
// what he says beside his head, and a box to ask him anything about your money (no name). Suggestions to tap and send
// (lib/ai/next.ts): under his latest answer, what you might ask next. On Frank's empty chat, a stack of what he can do sits above the box.
// Claude does his thinking (lib/ai/converse.ts): it looks up what a question needs with the app's own engine, run here, and
// every £ in the answer is checked against what it looked up. The line under an answer says what it was checked against.
// His eyes follow what you're doing: idle, typing (the box has focus or text) or thinking (until his answer lands).
// DROP: how far down the page he sits; his picture fades into the page at the top as well as the bottom.
const W = 440, PIC = 443, FADE = 40, DROP = 64;

// Who he is: Tim, or Frank (switched at the top of the page, kept in the store). Frank's picture (from the "Accountant-Frank"
// frame, 874×880 like tim.jpg, so the layout is the same) blinks, now and then looks down at his laptop and types, and says his
// own hello with his mouth moving under his moustache. Their pictures are in ART.
// `fails`: what he says, in his own voice, when he can't answer (never a scold, never the error itself).
// Your bubbles, the send button and the buttons on his cards are neutral (`timPage`), the same for both.
type Fail = AccountantError | Ended;
const PEOPLE: Record<Accountant, {name: string; fails: Record<Fail, string>}> = {
  tim: {name: "Tim",
    fails: {
      offline: "I can't reach my notes right now. Check your connection and ask me again.",
      timeout: "That took longer than it should. Ask me again.",
      busy: "I'm busy for a moment. Ask me again in a minute.",
      unavailable: "Something's gone wrong on my side. Try again in a bit.",
      "not-set-up": "I'm not switched on yet. The app needs setting up first.",
      "too-big": "That's more than I can look at in one go. Try fewer photos, or start a new chat.",
      limit: "That's all I can do for today. Ask me again tomorrow.",
      refused: "I can't help with that one. Ask me something about your money?",
      "cut-off": "I lost my thread there. Could you ask that again, a bit narrower?",
      "went-round": "I went round in circles on that one. Could you ask it another way?",
    }},
  frank: {name: "Frank",
    fails: {
      offline: "No connection, so I can't see your numbers. Try again when you've got signal.",
      timeout: "Took too long. Ask again.",
      busy: "Busy. Ask again in a minute.",
      unavailable: "Something's broken on my end. Try again later.",
      "not-set-up": "Not switched on yet. Someone has to set me up first.",
      "too-big": "Too much to look at. Fewer photos, or a new chat.",
      limit: "That's me done for today. Back tomorrow.",
      refused: "Not something I can help with. Money questions, please.",
      "cut-off": "Lost my thread. Ask again, smaller.",
      "went-round": "Went round in circles. Ask it another way.",
    }},
};
// One thing said in the conversation: yours, or his (`who` is who it was with, so switching shows only theirs).
// His: `checked`, what the answer was checked against; `flag`, figures it couldn't check; `quiet`, he couldn't answer;
// `voiced`, the line of it he said out loud, and his take of it (kept on the phone, so a tap replays it for nothing).
// `visual`, the picture he led with (a figure and what it's made of).
// `next`, what you might ask him next (shown under his latest answer only).
// `cards`, changes to your bills he proposed, each waiting for your yes (its view worked out when it was shown).
// `web`, the pages he cites, when he searched the web for it (none: he looked and has nothing to cite).
// `research`, something to buy he looked up, as a card leading the answer (worked out when it was shown; one from before
// find_products, kept in a saved chat, is the old kind); `estimate`, he talked about what something costs with no card to show
// for it, so any price in his words is an estimate, and this says so under them.
// `attached`, on yours: the photos and files you sent with it (a small picture of each photo; the things themselves are in the transcript).
type Card = {p: Proposal; view: ProposalView; status: CardStatus; note?: string};
type CatCard = {p: CategoryProposal; status: CardStatus; note?: string};
// `edits`: where you've said a shop's payments should go before you confirm (nothing is saved till then)
type OrgCardState = {proposal: OrgProposal; status: OrgCardStatus; report?: OrgReport; skippedKeys: Set<string>; edits?: OrgEdits};
type Said = {id: number; who: Accountant; mine: boolean; text: string; attached?: Shown[]; checked?: string | null; flag?: string; quiet?: boolean; voiced?: {line: string; take: Take}; visual?: Visual; next?: string[]; cards?: Card[]; catCards?: CatCard[]; orgCard?: OrgCardState; web?: Source[]; research?: ResearchView | OldResearchView; estimate?: string};
const ESTIMATE = "No shop's listing was found for this, so any price here is an estimate.";
// a chat to keep, from your first question in it
const newChatId = () => ({id: uid(), made: Date.now()});
const Track = GLASS ? GlassView : View; // the Tim · Frank switch's track
const Bar = GLASS ? GlassView : View; // the question box
const BAR_FOOT = 12; // how far the bar at the top runs on below his bubble, to its hairline
/** The round buttons at the top: Liquid Glass where the phone has it (tinted when `tint`), else a plain circle in `fill`. */
function Round({fill, tint, children}: {fill: string; tint?: string; children: React.ReactNode}) {
  const round = {flex: 1, borderRadius: 24, borderCurve: "continuous" as const, alignItems: "center" as const, justifyContent: "center" as const};
  return GLASS
    ? <GlassView glassEffectStyle="regular" isInteractive tintColor={tint} style={round}>{children}</GlassView>
    : <View style={[round, {backgroundColor: fill}]}>{children}</View>;
}
/** A temporary chat is a mode, so it's said where he is for as long as it lasts, one quiet line (not a toast that goes):
 *  the incognito icon and "Temporary chat". */
function TempNote({color, reduced, style}: {color: string; reduced: boolean; style?: ComponentProps<typeof View>["style"]}) {
  return (
    <Reanimated.View testID="temp-note" entering={reduced ? undefined : FadeIn.duration(160)} exiting={reduced ? undefined : FadeOut.duration(120)}
      style={[{flexDirection: "row", alignItems: "center", gap: 6}, style]}>
      <Icon name="incognito" color={color} size={14} />
      <Text numberOfLines={1} style={{flexShrink: 1, fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color}}>
        Temporary chat
      </Text>
    </Reanimated.View>
  );
}
// told to him on each question in a temporary chat, since his notes aren't given to him and remember saves nothing
const TEMP_CHAT = "This is a temporary chat: the person turned on not keeping it. Nothing from it is kept, you can't see your notes from earlier conversations, and remember saves nothing, so don't offer to note anything.";
const nowMs = () => Date.now(); // the time now, read outside drawing
const PLUS_X = 32 + 6 + 38 / 2; // the middle of the box's "+": the foot's padding, the box's, half the button

// the conversation in cards: each of your questions starts one, and what he says to it goes in with it
const exchanges = (said: Said[]) => said.reduce<Said[][]>((cards, s) => {
  if (s.mine || !cards.length) cards.push([s]); else cards[cards.length - 1].push(s);
  return cards;
}, []);
// one answer, as said in the conversation
function saidOf(who: Accountant, a: Answer, now: Date): Omit<Said, "id"> {
  if (a.ended || !a.text) return {who, mine: false, text: PEOPLE[who].fails[a.ended ?? "went-round"], quiet: true};
  const st = useMoney.getState(), state = st.state, ctx = state && {state, txs: st.txs, today: st.today};
  const research = a.research && ctx ? researchView(ctx, a.research, now) : null;
  // the pages the card already links aren't listed again; with a card, nothing to list is nothing to say
  const onCard = new Set(research?.tiles.map(t => t.url)), web = (a.sources ?? []).filter(w => !onCard.has(w.url));
  return {
    who, mine: false, text: a.text, checked: state && receipt(a.used, state, now, a.searched || !!research),
    ...a.unchecked.length ? {flag: a.readFrom ? readFrom(a.unchecked, a.readFrom) : `I couldn't check ${a.unchecked.join(", ")} against your numbers${a.searched ? " or a source" : ""}.`} : {},
    ...a.searched && !(research && !web.length) ? {web} : {},
    ...research ? {research} : {},
    ...a.estimate ? {estimate: ESTIMATE} : {},
    ...a.visual ? {visual: a.visual} : {},
    ...a.next ? {next: a.next} : {},
    ...a.proposals && ctx ? {cards: a.proposals.map(p => ({p, view: proposalView(ctx, p), status: "open" as const}))} : {},
    ...a.categoryProposals?.length ? {catCards: a.categoryProposals.map(p => ({p, status: "open" as const}))} : {},
    ...a.orgProposal ? {orgCard: {proposal: a.orgProposal, status: "open" as OrgCardStatus, skippedKeys: new Set<string>()}} : {},
  };
}
// The sites his searches brought back while he works, under what he's doing: a few, then how many more. They fade in once
// (straight away with reduced motion), and are said with what he's doing rather than read out on their own.
const LOOKED_SHOWN = 3;
function Looked({hosts, color, reduced}: {hosts: string[]; color: string; reduced: boolean}) {
  const shown = useSharedValue(reduced ? 1 : 0);
  useEffect(() => { shown.value = reduced ? 1 : withTiming(1, {duration: 300}); }, [reduced, shown]);
  const fade = useAnimatedStyle(() => ({opacity: shown.value}));
  const more = hosts.length - LOOKED_SHOWN;
  return (
    <Reanimated.View style={fade} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text testID="looked" numberOfLines={1} style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color}}>
        {hosts.slice(0, LOOKED_SHOWN).join(" · ")}{more > 0 ? ` +${more}` : ""}
      </Text>
    </Reanimated.View>
  );
}

// what a toast says once a card's change is made
const toastOf = (p: Proposal) => p.kind === "add" ? `${p.bill.name} added` : p.kind === "change" ? `${p.after.name} updated` : `${p.bill.name} removed`;
const waits = (k: Card | CatCard) => k.status === "open" || k.status === "failed";
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
// a picture of him smiling): 0 is the smile, shut, always showing, with reduced motion too; talking, his jaw drops from it, his
// upper lip lifts and the smile's tips ease down, slightly open, open ("e", a hint of teeth) or round ("o", the tips pulled
// in). Which piece shows a lip-sync shape is
// pieceFor (lib/lipsync.ts, mouthShapes.json), some standing in for others until they're drawn.
// Frank's (scripts/frank_mouth.py) are under his moustache: at rest it's just his picture (no piece); talking, his jaw drops
// under the moustache's middle and the whole moustache lifts with his upper lip, its tips most.
type MouthKit = {crop: Crop; pieces: (number | null)[]};
const MOUTHS: Record<Accountant, MouthKit> = {
  tim: {crop: {x: 395, y: 405, w: 88, h: 75}, pieces: [
    require("../../../assets/tim-mouth-0.png"), require("../../../assets/tim-mouth-1.png"),
    require("../../../assets/tim-mouth-2.png"), require("../../../assets/tim-mouth-3.png"),
  ]},
  frank: {crop: {x: 380, y: 438, w: 118, h: 68}, pieces: [
    null, require("../../../assets/frank-mouth-1.png"),
    require("../../../assets/frank-mouth-2.png"), require("../../../assets/frank-mouth-3.png"),
  ]},
};

// What he looks like: his picture and the pieces made from it, in light mode and, where there's one, dark. Frank's dark one is
// him in a dark room (the "Frank · your accountant (dark mode)" frame), its wall the dark page's colour (timPage) so he blends
// in as he does in light. scripts/frank_dark.py puts his face where it is in frank.jpg, so his captions and bubble are the same
// in both modes, and his pieces are made from it as from frank.jpg (frank_eyes.py, frank_hands.py, frank_mouth.py with --dark,
// which print these crops). Tim has no dark one yet: in dark mode his picture's light background still shows.
// `room`: what's around him, on a layer of its own over his picture and under his pieces (Frank's dark office, its square
// lights hanging behind him: scripts/frank_room.py, which cuts him out of it and keeps it out of every piece's crop). Only
// when it's chosen in Settings (`frankRoom`); it goes as he shrinks into his bubble, which is just his face.
type Art = {pic: number; alt: string; eyes: EyeKit; mouth: MouthKit; room?: number};
const ART: Record<Accountant, {light: Art; dark?: Art}> = {
  tim: {light: {pic: require("../../../assets/tim.jpg"), alt: "Tim, a clay-style accountant with grey hair and a blue scarf over a dark jumper", eyes: EYES.tim, mouth: MOUTHS.tim}},
  frank: {
    light: {pic: require("../../../assets/frank.jpg"), alt: "Frank, a clay-style accountant with red hair, a moustache and glasses, in a knitted jumper at his laptop", eyes: EYES.frank, mouth: MOUTHS.frank},
    dark: {
      pic: require("../../../assets/frank-dark.jpg"), alt: "Frank, a clay-style accountant with red hair, a moustache and glasses, in a knitted jumper at his laptop in a dark room",
      room: require("../../../assets/frank-dark-room.png"),
      eyes: {
        ...EYES.frank,
        looks: {crop: {x: 363, y: 372, w: 154, h: 36}, pieces: {down: require("../../../assets/frank-dark-look-down.png")}},
        lid: {x: 359, y: 361, w: 162, h: 46},
        lids: [
          {shut: .2, src: require("../../../assets/frank-dark-blink-1.png")},
          {shut: .5, src: require("../../../assets/frank-dark-blink-2.png")},
          {shut: 1, src: require("../../../assets/frank-dark-blink-3.png")},
        ],
        hands: {
          crop: {left: {x: 210, y: 681, w: 46, h: 109}, right: {x: 607, y: 681, w: 48, h: 109}},
          pieces: {
            left: [require("../../../assets/frank-dark-hands-left-1.png"), require("../../../assets/frank-dark-hands-left-2.png")],
            right: [require("../../../assets/frank-dark-hands-right-1.png"), require("../../../assets/frank-dark-hands-right-2.png")],
          },
        },
      },
      mouth: {crop: {x: 378, y: 437, w: 119, h: 69}, pieces: [
        null, require("../../../assets/frank-dark-mouth-1.png"),
        require("../../../assets/frank-dark-mouth-2.png"), require("../../../assets/frank-dark-mouth-3.png"),
      ]},
    },
  },
};
// What he says each time the tab opens (lib/timSpeech.ts): who he is. The words go beside his head, on one side or the other:
// a box from the page's 16pt edge to 8pt from him (CAPTION; figure: the leftmost and rightmost of him in his picture's px, measured off
// its pixels in the rows the words can reach, his hair at its widest), starting at row top. Frank's start higher, beside his
// glasses: his shoulders spread out below row 511 (FRANK_BOX; his captions are cut to fit above them, as Tim's are above
// his, TIM_BOX). The font's sized so every line's longest word fits its box (wordsFit), so nothing breaks mid-word or runs
// off. clips: their recorded openings (scripts/voice.py), by voiceKey.
// films: openings that are a video, by voiceKey (said(true) is the opening as the video has it, light mode only).
const WORDS: Record<Accountant, {figure: {left: number; right: number}; top: number; said: (film?: boolean) => SpeechFrame[]; clips: Record<string, number>; films?: Record<string, number>}> = {
  tim: {figure: TIM_BOX.figure, top: TIM_BOX.top, said: () => timFrames(), clips: TIM_CLIPS},
  frank: {figure: FRANK_BOX.figure, top: FRANK_BOX.top, said: film => film ? frankFrames(FILM_OPENING, FILM_VOICE) : frankFrames(), clips: FRANK_CLIPS, films: FRANK_FILMS},
};

// Once you've asked him something, he shrinks into a bubble at the top left, his name beside it,
// so his answer starts near the top. BUBBLE: his picture's scale in the bubble (pt per px of the 874px picture) and the px at
// the bubble's top left. Each one's head is centred in it, his hair to his chin and ear to ear measured off his picture
// (Frank's rows 185–500, 288–579), with a little collar under it; Tim's long face is fitted so his smile's in. Both checked
// by laying the crop onto his picture. In light mode his hair comes out over the top, fading out HAIR pt down (B's
// 34 to 46): a copy of his picture behind the bubble, on the page's own colour, so only his hair shows. TOP_ROOM: above the
// bubble, under the switch, for it.
const BUBBLE_D = 88, HAIR = [34, 46] as const, TOP_ROOM = 16, SWITCH_H = 36, SHRINK_MS = 400, ORG_DONE_MS = 2200;
// how long Frank's video takes to fade into his picture when it's over (ms)
const FILM_FADE = 900;
// While he says the line of his answer out loud, it takes the question's place beside his bubble, a caption at a time
// of up to SAID.rows rows; his name comes back when he's done.
const SAID = {size: 18, line: 23, rows: 3};
// While Frank writes his briefing, the line where it will go (he says "Just a second…": waitFrames).
const HAVING_A_LOOK = "Having a look at your money…";
const BUBBLE: Record<Accountant, {scale: number; x: number; y: number}> = {
  tim: {scale: .23, x: 241.5, y: 117.5},
  frank: {scale: .23, x: 242, y: 151},
};

const hidden = {pointerEvents: "none", accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants"} as const;
const place = (c: typeof LOOK_CROP, k: number) =>
  ({position: "absolute" as const, left: c.x * k, top: c.y * k, width: c.w * k, height: c.h * k});

// His voice is the clock: his words and mouth wait for the recording to really start (LISTEN: how often to look, ms),
// then go from where it's got to. STALL: loaded, not playing and not buffering for this long, and it isn't going to (the
// ringer's off, on Android): it's stopped and his words go on without it. Still on its way (slow over the dev tunnel), they
// wait for it, LOADING at most, then go on without it, his voice left to catch up if it comes.
const LISTEN = 20, STALL = 1000, LOADING = 8000;

// he speaks whatever the silent switch says, as a voice message does (the setting in Settings is how to quiet him);
// whatever you're listening to carries on under him. Set on mount, and again after a dictation, which hands the audio
// session to the recogniser while it listens.
const AUDIO = {playsInSilentMode: true, interruptionMode: "mixWithOthers"} as const;

/** Plays what he says whenever the tab shows: the words so far, his mouth, and his eyes' beats while he's saying it. His
 *  opening in his voice: the recording loads while he looks up, and everything from its first pose on starts when the sound
 *  really does (late, it waits; silent, it goes on without), so his words, mouth and blinks keep to what you hear.
 *  Each time, it's who he is, from the start. replay(): he says it again, from the start (a tap on him). hush(): he stops,
 *  his words as they end (he's shrunk into his bubble). Leaving the tab, or switching to the other, stops him too.
 *  speak(by, line, take, fits): he says the line of his answer, from his bubble, the same way (`speaking` while he does);
 *  only while the tab's showing and he's the one on it.
 *  intro(): asked as the tab shows; what it gives (and its recordings) is said instead of who he is (Frank, while he writes
 *  his briefing).
 *  withFilm: he may open with a video where he has one (light mode, no reduced motion): it has its own sound, so it's the
 *  clock as a recording is, and it's drawn over his picture (`video`) from when its sound is heard until he's stopped. */
type Intro = {frames: SpeechFrame[]; clips: Record<string, number>};
function useSpeech(reduced: boolean, who: Accountant, intro: () => Intro | null, withFilm: boolean) {
  const [again, setAgain] = useState(0);
  const [frame, setFrame] = useState<SpeechFrame>(() => WORDS[who].said()[0]);
  const [script, setScript] = useState<{who: Accountant; beats: Beat[]}>(); // whose, so a switch never plays the other's
  const [lines, setLines] = useState<ReturnType<typeof linesOf>>([]);
  const [speaking, setSpeaking] = useState(false);
  const [video, setVideo] = useState(false); // his video is showing (its sound has started)
  const player = useAudioPlayer();
  const movie = useVideoPlayer(null);
  const stop = useRef(() => {});
  const filmed = withFilm && !!movie; // a build without the video module: his recordings, as before
  const live = useRef({who, focused: false, film: filmed}); // as they are now: a take arrives long after the render that asked for it
  useEffect(() => { live.current.who = who; live.current.film = filmed; }, [who, filmed]);
  const opener = useRef(intro);
  useEffect(() => { opener.current = intro; });
  useEffect(() => { setAudioModeAsync(AUDIO).catch(() => {}); }, []);
  /** Plays poses in order from now: those before the one with his voice (`voice`) straight away, then the sound, and
   *  everything from that pose on starts when the sound really does. done: once it's over, or stopped. onSound: once,
   *  when the sound is first heard (true), or when he goes on without it (false). */
  const perform = (frames: SpeechFrame[], source: AudioSource | undefined, beats: Beat[] | undefined, done?: () => void, onSound?: (heard: boolean) => void, film?: number) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, f: () => void) => timers.push(setTimeout(f, Math.max(0, Math.ceil(ms))));
    const v = frames.findIndex(f => f.voice), clip = v < 0 ? undefined : film ?? source;
    // the video's sound, or the recording's: the same things asked of either
    const sound = film != null && movie
      ? {play: () => movie.play(), pause: () => movie.pause(), heard: () => movie.currentTime * 1000, stalled: () => movie.status === "readyToPlay" && !movie.playing}
      : {play: () => player.play(), pause: () => player.pause(), heard: () => player.currentTime * 1000, stalled: () => player.isLoaded && !player.playing && !player.isBuffering};
    setVideo(false);
    // the video over, he's his picture again (his own face, eyes and typing)
    const ended = film != null && movie ? movie.addListener("playToEnd", () => setVideo(false)) : undefined;
    // it loads while he looks up
    if (film != null && movie) movie.replaceAsync(film).catch(() => {}); // not loaded, it stalls, and he goes on without it
    else if (clip) player.replace(clip);
    // pose i; in his voice, his eyes start again from it as the sound starts and at each new look, so his blinks keep to it
    const show = (i: number) => {
      setFrame(frames[i]);
      if (clip && !reduced && (i === v || (i > v && frames[i].look))) setScript({who, beats: beatsFrom(frames, i)});
    };
    // poses i on, the first `lead` ms from now (already under way if it's less than 0)
    const run = (i: number, lead: number) => {
      let at = lead;
      for (let j = i; j < frames.length; j++) { later(at, () => show(j)); at += frames[j].ms; }
      later(at, () => { setScript(undefined); setVideo(false); done?.(); });
    };
    setFrame(frames[0]);
    if (beats) setScript({who, beats});
    if (!clip) run(0, 0);
    else {
      let at = 0;
      for (let j = 0; j < v; j++) { later(at, () => show(j)); at += frames[j].ms; }
      later(at, () => {
        sound.play();
        const began = Date.now();
        let idle: number | undefined; // since when it's been loaded but neither playing nor buffering
        const listen = () => {
          const heard = sound.heard(), now = Date.now();
          if (heard > 0) { if (film != null) setVideo(true); onSound?.(true); return run(v, -heard); }
          idle = sound.stalled() ? idle ?? now : undefined;
          if (idle !== undefined && now - idle > STALL) { sound.pause(); onSound?.(false); return run(v, 0); }
          if (now - began > LOADING) { onSound?.(false); return run(v, 0); }
          later(LISTEN, listen);
        };
        later(LISTEN, listen);
      });
    }
    stop.current = () => { timers.forEach(clearTimeout); timers.length = 0; player.pause(); movie?.pause(); ended?.remove(); setVideo(false); setFrame(frames[frames.length - 1]); setScript(undefined); done?.(); };
  };
  useFocusEffect(useCallback(() => {
    live.current.focused = true;
    const instead = opener.current(), own = WORDS[who].films, films = !instead && live.current.film && own && Object.keys(own).length ? own : undefined;
    const said = instead?.frames ?? WORDS[who].said(!!films), clips = instead?.clips ?? WORDS[who].clips;
    setLines(linesOf(said));
    // reduced: each line all at once, his mouth still (his voice as it was)
    const frames = reduced ? still(said) : said, v = frames.findIndex(f => f.voice), key = v < 0 ? undefined : frames[v].voice!;
    perform(frames, key == null ? undefined : clips[key], reduced ? undefined : beatsOf(said), undefined, undefined, key == null ? undefined : films?.[key]);
    return () => { live.current.focused = false; stop.current(); };
  }, [reduced, who, again])); // eslint-disable-line react-hooks/exhaustive-deps -- again: a tap on him starts him over
  const replay = useCallback(() => setAgain(n => n + 1), []);
  const hush = useCallback(() => stop.current(), []);
  const speak = (by: Accountant, line: string, take: Take, fits: (text: string) => boolean, onSound?: (heard: boolean) => void) => {
    if (live.current.who !== by || !live.current.focused) return;
    stop.current();
    const said = answerFrames(line, take, fits);
    setSpeaking(true);
    perform(reduced ? still(said) : said, {uri: take.uri}, reduced ? undefined : beatsOf(said), () => setSpeaking(false), onSound);
  };
  return {...frame, script: script?.who === who ? script.beats : undefined, lines, speaking, video, movie, replay, hush, speak};
}

/** The microphone in the box. Tapping it hushes him first (or it would be him being heard), asks for the microphone
 *  the first time, then listens: the words fill the box as you speak, after anything you'd already typed. Tapping stop
 *  finishes the sentence and leaves it there to read before you send it. Leaving the tab, switching accountant or
 *  closing the screen closes the microphone, saying nothing.
 *  It all happens on the phone (`requiresOnDeviceRecognition`), and where the phone can't do that the microphone isn't
 *  offered at all — see services/dictation.ts, which is what holds that promise. */
function useDictation(o: {q: string; setQ: (s: string) => void; hush: () => void; trouble: (text: string) => void}) {
  const [able, setAble] = useState(canDictate);
  const [listening, setListening] = useState(false);
  const typed = useRef(""); // what was in the box when the microphone opened
  const live = useRef(false); // listening, as the recogniser's own events report it (a second tap is a stop, not a start)
  // the box and the screen's own doings as they are now: the recogniser's events arrive long after a render
  const now = useRef(o);
  useEffect(() => { now.current = o; });

  useMicEvent("start", () => { live.current = true; setListening(true); AccessibilityInfo.announceForAccessibility("Listening"); });
  useMicEvent("result", e => now.current.setQ(withHeard(typed.current, transcriptOf(e))));
  useMicEvent("end", () => {
    live.current = false;
    setListening(false);
    setAudioModeAsync(AUDIO).catch(() => {}); // the recogniser had the audio session; his voice plays as before again
    AccessibilityInfo.announceForAccessibility("Stopped listening");
  });
  useMicEvent("error", e => {
    const line = calmly(e.error);
    if (micRefused(e.error)) setAble(false);
    if (line) now.current.trouble(line);
  });

  // nothing is said about a microphone we closed ourselves: abort's error code is one of the quiet ones
  const close = useCallback(() => { if (live.current) { live.current = false; mic?.abort(); } }, []);
  useFocusEffect(useCallback(() => close, [close])); // leaving the tab (the cleanup) closes it
  useEffect(() => close, [close]); // and so does leaving the screen

  const toggle = useCallback(async () => {
    if (live.current) return mic?.stop(); // finishes the sentence and keeps it
    // the microphone is always shown; where the phone can't keep your voice on it, tapping it says so instead
    if (!mic || !canDictate()) { now.current.trouble(calmly("not-on-phone")!); return; }
    now.current.hush(); // he stops talking before the microphone opens
    const got = await mic.requestMicrophonePermissionsAsync().catch(() => null);
    if (!got?.granted) { setAble(false); now.current.trouble(calmly("not-allowed")!); return; }
    typed.current = now.current.q;
    mic.start({lang: micLang(), interimResults: true, continuous: true, requiresOnDeviceRecognition: true, addsPunctuation: true});
  }, []);

  return {able, listening, toggle, close};
}

function MouthPieces({width, who, kit, mouth}: {width: number; who: Accountant; kit: MouthKit; mouth: Mouth}) {
  const k = width / SRC_W, {crop, pieces} = kit, on = pieceFor(who, mouth);
  return <>
    {pieces.map((src, i) => src !== null && (
      <Image key={i} source={src} testID={on !== i ? undefined : i ? `${who}-mouth` : `${who}-smile`} style={[place(crop, k), {opacity: on === i ? 1 : 0}]} {...hidden} />
    ))}
  </>;
}

// "Smart Organisation": while he looks through your payments he comes forward into a screen of his own, from where he was
// (his bubble, or his place on the page), in one quick springy move (lib/orgEntry.ts): the screen's background fades in
// under him over COVER_MS while he is still exactly where he was, so he is the same Frank all the way, his eyes and mouth
// carried over. `open` drives it; it unmounts once it has shrunk back.
// Going out is an iris-out, as the old cartoons end: a circle closes in on his face (the picture stays put), then the small circle
// slips into the bubble. IRIS_CLOSE is the share of the time spent closing in.
// ENTER: a jolt (it starts already moving) and a bouncy settle (past the spot by about a third, back, settled by about .6s). On top
// of it he lunges at you: PUNCH is how much bigger he gets at the peak (a quick swell, then a wobbly spring back). The
// background fades in over COVER_MS.
const ENTER = {damping: 11, stiffness: 380, mass: .8, velocity: 5}, PUNCH = .1, COVER_MS = 140, FIRST_SHOP_MS = 500, POP_OUT_MS = 520, IRIS_CLOSE = .62;
// what the page's Frank is doing, for the Frank of the Smart Organisation screen to take over from
type EyesNow = {look: Look; hands: Record<Side, Lift>};
// Frank while he searches: head down in his laptop, typing, never glancing up, blinking every few seconds as he does. Long enough
// to outlast any search; when it's over he's back to looking at you.
const FRANK_DEEP: Beat[] = frankSearchBeats();
// Where the shops he looks at float: round his head, in the order they come (left, right, then the two above), as
// pt from the middle of his head (cx, the px across his picture) and the top of his hair (px down it).
const HEAD: Record<Accountant, {cx: number; top: number}> = {tim: {cx: 422, top: 120}, frank: {cx: 433, top: 185}};
const SLOTS = [{dx: -118, dy: -6}, {dx: 118, dy: -6}, {dx: -44, dy: -58}, {dx: 44, dy: -58}] as const, ORG_BUBBLE = 64;
// One shop's logo (Monzo's, else the icon its payments get), popping in with a bounce and floating a little
function OrgBubble({stop, x, y, inn, slot, fill, reduced}: {stop: Stop; x: number; y: number; inn: boolean; slot: number; fill: string; reduced: boolean}) {
  const pop = useSharedValue(reduced && inn ? 1 : 0), bob = useSharedValue(0);
  useEffect(() => {
    pop.value = reduced ? (inn ? 1 : 0) : inn ? withSpring(1, {damping: 8, stiffness: 220, mass: .8}) : withTiming(0, {duration: 180});
  }, [inn, reduced, pop]);
  useEffect(() => {
    if (reduced) return;
    bob.value = withDelay(slot * 260, withRepeat(withSequence(
      withTiming(-4, {duration: 1300, easing: Easing.inOut(Easing.sin)}), withTiming(4, {duration: 1300, easing: Easing.inOut(Easing.sin)})), -1, true));
  }, [reduced, slot, bob]);
  const style = useAnimatedStyle(() => ({opacity: Math.min(1, pop.value * 4), transform: [{translateY: bob.value}, {scale: pop.value}]}));
  return (
    <Reanimated.View {...hidden} style={[{position: "absolute", left: x - ORG_BUBBLE / 2, top: y - ORG_BUBBLE / 2, width: ORG_BUBBLE, height: ORG_BUBBLE, borderRadius: ORG_BUBBLE / 2,
      backgroundColor: fill, shadowColor: "#000", shadowOpacity: .12, shadowRadius: 8, shadowOffset: {width: 0, height: 3}}, style]}>
      <MerchantLogo name={stop.name} uri={stop.logo} look={stop.look} size={ORG_BUBBLE} />
    </Reanimated.View>
  );
}

// The black card that comes out of the Dynamic Island when he's done: it starts as the island itself (126×37, 11pt down,
// where it sits on phones that have one) and springs out to a card with a tick and what he did.
const ISLAND = {w: 126, h: 37, top: 11}, DONE_CARD = {w: 236, h: 104};
function OrgScreen({open, done, who, art, src, alt, office, bg, ink, muted, fill, stops, count, origin, mouth0, eyes0, bubbleTop, width, mood, reduced}: {
  open: boolean; done: boolean; who: Accountant; art: (typeof ART)[Accountant]["light"]; src: ImageSourcePropType; alt: string; office?: ImageSourcePropType;
  bg: string; ink: string; muted: string; fill: string; stops: Stop[]; count: number; bubbleTop: number; width: number; mood: Mood; reduced: boolean;
  // where he comes from (his place on the page, or his bubble), the mouth he had then, what his eyes were doing, and the
  // page's own Frank's fade (1 while this one is standing in for him)
  origin: OrgOrigin; mouth0: Mouth; eyes0: EyesNow;
}) {
  const insets = useSafeAreaInsets();
  // stays mounted while it shrinks back
  const [leaving, setLeaving] = useState(false), [was, setWas] = useState(open), [shown, setShown] = useState(0), [mouth, setMouth] = useState<Mouth>("X");
  if (was !== open) { setWas(open); setLeaving(!open && !reduced); if (open) { setShown(0); setMouth(mouth0); } }
  // the mouth he had is held for a pose, then he's at rest
  useEffect(() => {
    if (!open || mouth === "X") return;
    const t = setTimeout(() => setMouth("X"), ON_TWOS);
    return () => clearTimeout(t);
  }, [open, mouth]);
  // once he's landed, a new shop every so often, so it's clear he's going through them
  useEffect(() => {
    if (!open) return;
    let every: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => { setShown(1); every = setInterval(() => setShown(s => s + 1), STEP_MS); }, FIRST_SHOP_MS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [open]);
  const mounted = open || leaving;
  const enter = useSharedValue(0), punch = useSharedValue(0);
  // the screen's background (it fades in under him) and whether the screen has been set up for this time (it is not drawn before)
  const cover = useSharedValue(0), ready = useSharedValue(0);
  // 1: he comes from his bubble. From his place on the page he comes from exactly there. He always goes out into the bubble:
  // the chat is where the results are.
  const toBubble = useSharedValue(origin === "bubble" ? 1 : 0);
  const pic = width * PIC / W, k = width / SRC_W, {scale: bs, x: bx, y: by} = BUBBLE[who], fit = bs / k;
  // in the middle of the screen (a touch above it, for the line under him), not up where he sits on his tab
  const {height} = useWindowDimensions();
  const at0 = Math.max(DROP, Math.round((height - pic) / 2 - 64));
  const geo: EntryGeo = {width, pic, drop: DROP, at0, bubbleTop, bubble: BUBBLE_D, bs, bx, by, fit};
  const iris = useSharedValue(0); // 1 while he's going out
  // the iris: closes on the middle of his face (in the picture's own points), from a circle that covers the whole picture down to
  // the size the bubble shows of it (fcx, fcy, from the top of the picture; big, small)
  const half = BUBBLE_D / bs / 2 * k, fcx = bx * k + half, fcy = by * k + half;
  const irisBig = 2 * Math.max(Math.hypot(fcx, fcy), Math.hypot(width - fcx, fcy), Math.hypot(fcx, pic - fcy), Math.hypot(width - fcx, pic - fcy));
  const irisSmall = BUBBLE_D / fit;
  // where it is at progress p (0 the whole picture, 1 the bubble): the circle's box, and how the picture sits in it
  const irisAt = (p: number) => {
    "worklet";
    const q1 = Math.min(1, Math.max(0, p / IRIS_CLOSE)), q2 = Math.min(1, Math.max(0, (p - IRIS_CLOSE) / (1 - IRIS_CLOSE)));
    const d = irisBig + (irisSmall - irisBig) * q1, l = fcx - d / 2, t = fcy - d / 2;
    return {
      left: l + (32 - l) * q2, top: at0 + t + (bubbleTop - (at0 + t)) * q2, size: d + (BUBBLE_D - d) * q2,
      x: -l + (-bx * bs + l) * q2, y: -t + (-by * bs + t) * q2, scale: 1 + (fit - 1) * q2, q2,
    };
  };
  // a thin outline round the iris's edge so the circle can be seen closing; it fades as he lands in the bubble
  const outline = useAnimatedStyle(() => {
    if (!(toBubble.value && iris.value === 1)) return {opacity: 0};
    const c = irisAt(Math.min(1, Math.max(0, 1 - enter.value)));
    return {left: c.left, top: c.top, width: c.size, height: c.size, borderRadius: c.size / 2, opacity: .09 * (1 - c.q2 * c.q2)};
  });
  useEffect(() => {
    if (open) {
      // all of it lands together: the page's own Frank steps aside as this one is drawn, exactly where he was
      iris.value = 0;
      toBubble.value = origin === "bubble" ? 1 : 0;
      enter.value = reduced ? 1 : withSpring(1, ENTER);
      punch.value = reduced ? 0 : withSequence(withTiming(1, {duration: 80, easing: Easing.out(Easing.quad)}), withSpring(0, {damping: 7, stiffness: 240, mass: .8}));
      cover.value = reduced ? 1 : withTiming(1, {duration: COVER_MS, easing: Easing.out(Easing.quad)});
      ready.value = 1;
      return;
    }
    iris.value = 1;
    toBubble.value = 1;
    punch.value = 0;
    enter.value = reduced ? 0 : withTiming(0, {duration: POP_OUT_MS, easing: Easing.inOut(Easing.quad)});
    const t = setTimeout(() => { setLeaving(false); ready.value = 0; cover.value = 0; }, POP_OUT_MS + 20);
    return () => clearTimeout(t);
    // `origin` is read only as he comes in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reduced, enter, punch, toBubble, cover, ready]);
  // the finish: 0 is the island's own size, 1 the card; the tick pops once it's out
  const finish = useSharedValue(0), tick = useSharedValue(0);
  useEffect(() => {
    if (open && done) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); // as the card comes out (nothing on a build without the module)
      finish.value = reduced ? 1 : withSpring(1, {damping: 12, stiffness: 170, mass: .9});
      tick.value = reduced ? 1 : withDelay(260, withSpring(1, {damping: 7, stiffness: 240, mass: .7}));
    } else {
      finish.value = reduced ? 0 : withTiming(0, {duration: 220, easing: Easing.in(Easing.cubic)});
      tick.value = 0;
    }
  }, [open, done, reduced, finish, tick]);
  const isle = insets.top >= 50 ? ISLAND.top : insets.top + 4; // no island: it drops from under the status bar
  const card = useAnimatedStyle(() => {
    const p = finish.value, w = ISLAND.w + (DONE_CARD.w - ISLAND.w) * p, h = ISLAND.h + (DONE_CARD.h - ISLAND.h) * p;
    return {left: (width - w) / 2, top: isle, width: w, height: h, borderRadius: Math.max(ISLAND.h / 2, ISLAND.h / 2 + (30 - ISLAND.h / 2) * p), opacity: Math.min(1, p * 20)};
  });
  const cardWords = useAnimatedStyle(() => ({opacity: Math.max(0, Math.min(1, (finish.value - .5) / .4))}));
  const tickPop = useAnimatedStyle(() => ({transform: [{scale: tick.value}]}));
  const searching = useAnimatedStyle(() => ({opacity: 1 - Math.min(1, finish.value * 3)})); // the search goes as the card comes
  // the whole screen: not drawn until it has been set up for this time, and, going out, gone only as the circle lands
  const root = useAnimatedStyle(() => ({opacity: ready.value ? (iris.value === 1 ? Math.min(1, enter.value * 12) : 1) : 0}));
  // the page's colour behind him, fading in over the page while he is still where he was (the chat goes under it)
  const veil = useAnimatedStyle(() => ({opacity: cover.value}));
  const clip = useAnimatedStyle(() => {
    if (iris.value === 1) {
      const c = irisAt(Math.min(1, Math.max(0, 1 - enter.value)));
      return {left: c.left, top: c.top, width: c.size, height: c.size, borderRadius: c.size / 2, transform: [{scale: 1}]};
    }
    const c = entryAt(enter.value, toBubble.value ? "bubble" : "rest", geo);
    return {left: c.left, top: c.top, width: c.width, height: c.height, borderRadius: c.radius, transform: [{scale: 1 + PUNCH * punch.value}]};
  });
  const face = useAnimatedStyle(() => {
    if (iris.value === 1) {
      const c = irisAt(Math.min(1, Math.max(0, 1 - enter.value)));
      return {transform: [{translateX: c.x}, {translateY: c.y}, {scale: c.scale}]};
    }
    const c = entryAt(enter.value, toBubble.value ? "bubble" : "rest", geo);
    return {transform: [{translateX: c.x}, {translateY: c.y}, {scale: c.scale}]};
  });
  const words = useAnimatedStyle(() => ({opacity: Math.max(0, Math.min(1, (enter.value - .5) / .4)), transform: [{translateY: (1 - Math.min(1, enter.value)) * 8}]}));
  // The screen is always there, undrawn (and out of the way of touches and the screen reader) until it's wanted, with his picture
  // already loaded: made new each time, his picture took a few frames to show, and the page's own Frank had gone by then.
  return (
    <Reanimated.View testID="org-screen" style={[StyleSheet.absoluteFill, {zIndex: 20}, root]} pointerEvents={mounted ? "auto" : "none"}
      accessibilityViewIsModal={mounted} accessibilityElementsHidden={!mounted} importantForAccessibility={mounted ? "auto" : "no-hide-descendants"}
      accessibilityLabel="Smart Sort">
      <Reanimated.View style={[StyleSheet.absoluteFill, {backgroundColor: bg}, veil]} {...hidden} />
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, searching]}>
        <Reanimated.View style={[{position: "absolute", left: 32, right: 32, top: insets.top + 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8}, words]}>
          <Icon name="broom" color={ink} size={20} />
          <Text style={{fontFamily: hanken.semibold, fontSize: 17, lineHeight: 22, color: ink}}>Smart Sort</Text>
        </Reanimated.View>
      </Reanimated.View>
      <Reanimated.View style={[{position: "absolute", overflow: "hidden"}, clip]}>
        <Reanimated.View style={[{width, height: pic, transformOrigin: "left top"}, face]}>
          <Image source={src} style={{width, height: pic}} resizeMode="cover" accessibilityLabel={alt} />
          {office != null && <Image source={office} style={{position: "absolute", left: 0, top: 0, width, height: pic}} resizeMode="cover" {...hidden} />}
          {mounted && <Eyes key={`org-eyes-${who}`} width={width} kit={art.eyes} mood={done ? "idle" : mood} script={who === "frank" && !done ? FRANK_DEEP : undefined} seed={eyes0} />}
          {mounted && <MouthPieces key={`org-mouth-${who}`} width={width} who={who} kit={art.mouth} mouth={mouth} />}
          <LinearGradient colors={[bg, bg + "00"]} style={{position: "absolute", left: 0, right: 0, top: 0, height: FADE}} pointerEvents="none" />
          <LinearGradient colors={[bg + "00", bg]} style={{position: "absolute", left: 0, right: 0, bottom: 0, height: FADE}} pointerEvents="none" />
        </Reanimated.View>
      </Reanimated.View>
      <Reanimated.View {...hidden} pointerEvents="none" style={[{position: "absolute", borderWidth: 1.5, borderColor: ink}, outline]} />
      {mounted && bubblesAt(stops, shown).map(p => (
        <OrgBubble key={p.i} stop={p.stop} slot={p.slot} inn={p.inn && !done && open} fill={fill} reduced={reduced}
          x={HEAD[who].cx * k + SLOTS[p.slot].dx} y={at0 + HEAD[who].top * k + SLOTS[p.slot].dy} />
      ))}
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, searching]}>
        <Reanimated.Text style={[{position: "absolute", left: 32, right: 32, top: at0 + pic + 8, textAlign: "center", fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: muted}, words]}>
          {count > 0 ? `Looking through ${count} payment${count === 1 ? "" : "s"}…` : "Looking at your payments…"}
        </Reanimated.Text>
      </Reanimated.View>
      {/* out of the island: black, a tick, and what he did */}
      <Reanimated.View testID="org-done" accessible={done} accessibilityLabel={`Search complete. ${count} payments looked through.`} pointerEvents="none"
        style={[{position: "absolute", backgroundColor: "#000", overflow: "hidden"}, card]}>
        <Reanimated.View style={[{position: "absolute", left: 20, right: 20, top: 50, flexDirection: "row", alignItems: "center", gap: 12}, cardWords]}>
          <Reanimated.View style={[{width: 32, height: 32, borderRadius: 16, borderCurve: "continuous", backgroundColor: "#FFF", alignItems: "center", justifyContent: "center"}, tickPop]}>
            <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M5 12.5l4.5 4.5L19 7.5" stroke="#000" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" /></Svg>
          </Reanimated.View>
          <View style={{flex: 1, minWidth: 0}}>
            <Text numberOfLines={1} style={{fontFamily: hanken.semibold, fontSize: 17, lineHeight: 22, color: "#FFF"}}>Search complete</Text>
            {count > 0 && <Text numberOfLines={1} style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,.6)"}}>{count} payment{count === 1 ? "" : "s"} looked through</Text>}
          </View>
        </Reanimated.View>
      </Reanimated.View>
    </Reanimated.View>
  );
}

// kit: whose eyes (his pieces, and how they move; Frank's hands too, as they go with where he looks). script: beats to play
// first (his hello), before going on with his mood's
// shareRef: where to keep what he's doing, for the Smart Organisation screen's Frank to take over from (seed, on that one)
function Eyes({width, kit, mood, script, shareRef, seed}: {width: number; kit: EyeKit; mood: Mood; script?: Beat[]; shareRef?: MutableRefObject<EyesNow>; seed?: EyesNow}) {
  const reduced = useReducedMotion();
  const [look, setLook] = useState<Look>(seed?.look ?? "you");
  const [blink, setBlink] = useState(0);
  const [hands, setHands] = useState<Record<Side, Lift>>(seed?.hands ?? {left: 0, right: 0});
  useEffect(() => { if (shareRef) shareRef.current = {look, hands}; }, [shareRef, look, hands]);
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
  const {name} = PEOPLE[who];
  const cats = useMoney(st => st.state?.categories ?? []);
  const needsCatCount = useMoney(st => st.txs.filter(t => t.type === "expense" && !!t.needsCat && !t.billId && !t.refundOf).length);
  // his picture for this mode; `blends`: its background is the page's (light, and dark where he has a dark picture)
  const blends = !dark || !!ART[who].dark, art = (dark && ART[who].dark) || ART[who].light, {pic: src, alt} = art;
  // the room around him, when it's chosen in Settings (plain black at first)
  const office = useMoney(st => st.frankRoom) === "office" ? art.room : undefined;
  const isTim = who === "tim";
  const [q, setQ] = useState("");
  const [boxFocused, setBoxFocused] = useState(false);
  const input = useRef<TextInputInstance>(null);
  const [thread, setThread] = useState<Said[]>([]);
  // who's a bubble: each from your Send until you tap him back
  const [smallFor, setSmallFor] = useState<Record<Accountant, boolean>>({tim: false, frank: false});
  // each accountant's conversation exactly as Claude saw it, for this visit to the app (not kept, like the thread)
  const talks = useRef<Record<Accountant, Transcript>>({tim: [], frank: []});
  // each accountant's chat, counted up when you start a new one, so an answer still on its way to the old one is dropped
  const chats = useRef<Record<Accountant, number>>({tim: 0, frank: 0});
  const said = useRef(0); // ids for what's said, never reused when a chat is cleared
  // each accountant's chat as it's kept (lib/chats.ts): its id from your first question, and when it started
  // (`openIds` is the same for the panel to draw, since a ref can't be read while drawing)
  const chatId = useRef<Record<Accountant, string | null>>({tim: null, frank: null});
  const [openIds, setOpenIds] = useState<string[]>([]);
  const setChatId = (w: Accountant, id: string | null) => {
    chatId.current[w] = id;
    setOpenIds([chatId.current.tim, chatId.current.frank].filter((x): x is string => !!x));
  };
  const made = useRef<Record<Accountant, number>>({tim: 0, frank: 0});
  // a temporary chat (the button at the top right): nothing in it is kept, not the chat and not his notes, and your notes
  // aren't given to him. Turning it on or off starts both accountants afresh, so nothing said in one is kept by the other.
  const [temp, setTemp] = useState(false);
  const tempRef = useRef(false);
  // what you did with his cards since your last message, for him on your next one (inside <app_context>)
  const outcomes = useRef<Record<Accountant, string[]>>({tim: [], frank: []});
  // the apply closure for the pending organisation run (set by preview_organisation, consumed by OrgCard confirm)
  const orgApplyRef = useRef<PendingOrg | null>(null);
  // who's working out an answer, and what he's doing right now; one question at a time
  const [working, setWorking] = useState<{who: Accountant; doing: string} | null>(null);
  // the sites his searches brought back while he works, under that line (apart, so the line isn't read out again as they come)
  const [looked, setLooked] = useState<string[]>([]);
  // he's looking through your payments to organise them: the Smart Organisation screen is up
  const [lookingThrough, setLookingThrough] = useState(false);
  const orgSince = useRef(0); // when it came up (0: it isn't), so it stays long enough to be seen
  // Where he comes from as it comes up: his place on the page, or his bubble (a question already sent), the mouth he had and what
  // his eyes were doing. Read from what's on screen now (the refs), not from this render: the tool that opens it runs long after
  // the question went.
  const [orgFrom, setOrgFrom] = useState<{origin: OrgOrigin; mouth: Mouth; eyes: EyesNow}>({origin: "rest", mouth: "X", eyes: {look: "you", hands: {left: 0, right: 0}}});
  const smallNow = useRef(false), mouthNow = useRef<Mouth>("X");
  const eyesNow = useRef<EyesNow>({look: "you", hands: {left: 0, right: 0}});
  const hideReal = useSharedValue(0); // 1 while the Smart Organisation screen's Frank stands in for the page's
  // (going out, it's back at once, under the circle that's closing in, so it's there when the circle lands)
  useEffect(() => { hideReal.value = lookingThrough ? 1 : 0; }, [lookingThrough, hideReal]);
  // Opened from his place on the page, the page's own chrome (the rows, the box, the tab bar) is left alone for as long as the
  // screen's background takes to fade in over it, so nothing jumps under it as it does.
  const [settling, setSettling] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openOrg = () => {
    if (!orgSince.current) {
      orgSince.current = Date.now();
      const origin: OrgOrigin = smallNow.current ? "bubble" : "rest";
      setOrgFrom({origin, mouth: origin === "rest" ? mouthNow.current : "X", eyes: eyesNow.current});
      if (origin === "rest" && !reduced) {
        setSettling(true);
        clearTimeout(settle.current);
        settle.current = setTimeout(() => setSettling(false), COVER_MS + 60);
      }
    }
    setLookingThrough(true);
  };
  useEffect(() => () => clearTimeout(settle.current), []);
  const orgHold = useRef(holdMs(0)); // at least this long, a beat per shop he looks at
  // when he's done and it's been up long enough: the card out of the island, held a moment, then the screen goes. Once at a
  // time (the tool ending and the question ending both ask); the returned function cancels it.
  const [orgDone, setOrgDone] = useState(false);
  const orgClosing = useRef(false);
  const closeOrg = () => {
    if (orgClosing.current) return () => {};
    orgClosing.current = true;
    let t2: ReturnType<typeof setTimeout> | undefined;
    const t1 = setTimeout(() => {
      setOrgDone(true);
      t2 = setTimeout(() => { orgSince.current = 0; orgClosing.current = false; setLookingThrough(false); setOrgDone(false); }, ORG_DONE_MS);
    }, Math.max(0, orgHold.current - (Date.now() - orgSince.current)));
    return () => { clearTimeout(t1); clearTimeout(t2); orgClosing.current = false; };
  };
  const orgState = useMoney(st => st.state), orgTxs = useMoney(st => st.txs), orgToday = useMoney(st => st.today);
  const orgStops = useMemo(() => orgState ? searchStops({state: orgState, txs: orgTxs, today: orgToday}) : [], [orgState, orgTxs, orgToday]);
  // the organising card lists payments as they're filed now; tapping one opens the sheet to put it somewhere else
  const orgCtx = useMemo(() => orgState ? {state: orgState, txs: orgTxs, today: orgToday} : null, [orgState, orgTxs, orgToday]);
  const [editing, setEditing] = useState<string | null>(null), editingBy = useRef<Accountant>("frank"); // whose card it was
  // Edit on a shop in a preview that isn't saved: which card, and which shop
  const [picking, setPicking] = useState<{id: number; t: EditTarget} | null>(null);
  useEffect(() => { orgHold.current = holdMs(orgStops.length); }, [orgStops]);
  // a question waiting for you to say he can look at your numbers, and what the app tells him with it (a product you tapped)
  const [waiting, setWaiting] = useState<string | null>(null);
  const waitingExtra = useRef<string[]>([]);
  // As ChatGPT does: send a question and it goes to the top, just under his pinned bubble, with room under it for his answer
  // (the latest exchange is at least a screen tall), so his answer comes in below it and you read it from its beginning.
  // Nothing scrolls when it lands. A chat opened again goes to the end.
  const follow = useRef(false);
  const pin = useRef<number | null>(null); // your question, to go to the top once it's laid out
  const listY = useRef(0);
  const [viewH, setViewH] = useState(0);
  const say = (s: Omit<Said, "id">) => { const id = said.current++; if (s.mine) pin.current = id; setThread(th => [...th, {...s, id}]); return id; };
  const thinking = working?.who === who;
  const reduced = useReducedMotion();
  // The "+" card (components/PlusCard.tsx): photos and files for your next question, in a tray in the box until you send, and
  // which Claude each accountant thinks with
  const [plus, setPlus] = useState(false);
  // where the "+" menu stops: just above the question box (its foot's height less where the box starts in it)
  const [footH, setFootH] = useState(0), [barY, setBarY] = useState(0);
  const [attach, setAttach] = useState<Attachment[]>([]);
  const model = useMoney(st => st.models[who]);
  const openPlus = () => { Keyboard.dismiss(); setPlus(true); };
  // what you picked goes in the tray, as many as fit; the first that doesn't says why on the toast
  const pick = async (from: (room: number) => Promise<Picked>) => {
    setPlus(false);
    if (attach.length >= MAX_ATTACH) { useMoney.getState().notify(`Up to ${MAX_ATTACH} at a time.`); return; }
    const r = await from(MAX_ATTACH - attach.length);
    if ("reason" in r) { useMoney.getState().notify(r.reason); return; }
    setAttach(have => {
      const out = [...have];
      for (const a of r.add) {
        const why = tooMuch(out, a);
        if (why) { useMoney.getState().notify(why); break; }
        out.push(a);
      }
      return out;
    });
  };

  // Recent chats: the burger button slides a panel in from the left and pushes the page right to make room, as in the
  // ChatGPT app. A tap on the page (or the button) slides it back. Reduced motion: it's just there.
  const [drawer, setDrawer] = useState(false);
  const drawerW = Math.min(Math.round(width * .8), 320);
  const opened = useSharedValue(0);
  useEffect(() => { opened.value = reduced ? (drawer ? 1 : 0) : withTiming(drawer ? 1 : 0, {duration: 280, easing: Easing.out(Easing.cubic)}); }, [drawer, reduced, opened]);
  const pushed = useAnimatedStyle(() => ({transform: [{translateX: opened.value * drawerW}]}));
  const slid = useAnimatedStyle(() => ({transform: [{translateX: (opened.value - 1) * drawerW}]}));
  const shade = useAnimatedStyle(() => ({opacity: opened.value * .2}));

  // The box stays at the bottom, above the tab bar, and rides up with the keyboard frame for frame (keyboard-controller reports
  // where the keys are on the UI thread, so it starts, eases and stops with them, and follows a drag that puts them away).
  // The conversation keeps scrolling above it: what the keyboard covers is added to its bottom inset, so the last thing said
  // can always be scrolled into view. iOS only: Android resizes the window itself.
  const page = useRef<HostInstance>(null), scroll = useRef<ScrollViewInstance>(null);
  const [under, setUnder] = useState(0); // the tab bar and home indicator, under the page
  const measure = () => page.current?.measureInWindow((_x, y, _w, h) => setUnder(Math.max(0, Math.round(Dimensions.get("window").height - y - h))));
  const {height: keys} = useKeyboardHeight(); // minus the keyboard's height, this frame
  const ios = Platform.OS === "ios";
  // with no tab bar (a conversation, for now), the box keeps clear of the home indicator itself
  const bare = useChrome(st => st.bare), foot = bare ? insets.bottom : 0;
  // up by what the keyboard covers above the tab bar (or the home indicator); nothing when it covers less
  const lift = useAnimatedStyle(() => ({transform: [{translateY: ios ? Math.min(0, keys.value + under + foot) : 0}]}));
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
  // Frank's briefing (lib/briefing.ts): the first time his tab opens each day, on an empty chat, once you've said he can look
  // at your numbers, he's been keeping an eye on them and says what's worth knowing instead of his opening. While he writes it
  // he says he's having a look; it lands as his first message, and what he said is kept so it isn't said again. If he can't,
  // or there's nothing worth saying, he says his opening as usual. One go per visit to the tab.
  // a note he saves or crosses out: done straight away, with Undo on the toast
  const note = (effect: ToolEffect, by: Accountant) => {
    const st = useMoney.getState(), {name: his} = PEOPLE[by];
    if ("add" in effect) {
      st.addNote(effect.add);
      st.notify(`${his} noted: ${effect.add.text}`, false, () => { useMoney.getState().removeNote(effect.add.id); });
    } else if ("remove" in effect) {
      const gone = st.removeNote(effect.remove.id);
      if (gone) st.notify(`${his} crossed out: ${gone.note.text}`, false, () => useMoney.getState().restoreNote(gone.note, gone.at));
    }
  };
  // what a question needs: the function, the tools' view of your money as it is right now, notes to the store, what he's doing
  const depsOf = (to: Accountant, current: () => boolean, clock: Stopwatch | null): Deps => {
    let round = 0;
    return {
      send: async m => { const turn = await send(to, m, useMoney.getState().models[to]); clock?.mark(roundOf(++round, turn)); return turn; },
      env: () => {
        const st = useMoney.getState();
        return {ctx: {state: st.state!, txs: st.txs, today: st.today, rules: st.merchantRules ?? []}, notes: tempRef.current ? [] : st.notes, who: to, newId: () => "n_" + uid(),
          regulars: {scan: st.scan, answers: st.answers}, rules: st.merchantRules ?? []};
      },
      apply: effect => { if (!tempRef.current) note(effect, to); },
      doing: doing => { if (current()) setWorking(w => w && {...w, doing}); },
      looked: hosts => { if (current()) setLooked(hosts); },
      // the shops, for find_products; how it went goes in the dev log's timings line (counts, never names)
      shop: async args => {
        const got = await shop(args);
        const st = got.stats as {verified?: number; listed?: number; brave?: number} | undefined;
        clock?.mark(`shop (${got.products.length} found, ${st?.verified ?? 0} on the shops' pages, ${st?.brave ?? 0} searches)`);
        return got;
      },
      buildOrganisation: async () => {
        if (current()) openOrg();
        // it stays up until the whole question is done (below), so the results are in the chat when it goes
        return await useMoney.getState().buildOrganisation() as BuildOrgResult | null | string;
      },
      setPendingOrg: (p: PendingOrg) => { orgApplyRef.current = p; },
    };
  };
  const briefed = useRef(false);
  const replay = useRef(() => {}); // his opening again (speech.replay, from below)
  const readOut = useRef((_id: number, _line: string, _current: () => boolean) => {}); // his briefing out loud (voice, from below)
  useFocusEffect(useCallback(() => () => { briefed.current = false; }, []));
  const briefing = (): Intro | null => {
    const st = useMoney.getState(), kind = st.state && st.aiConsent ? briefingDue(st.briefLog, st.today) : null;
    if (who !== "frank" || !kind || briefed.current || working || thread.some(s => s.who === "frank")) return null;
    briefed.current = true;
    const ctx = {state: st.state!, txs: st.txs, today: st.today};
    const facts = briefingFacts(ctx, {scan: st.scan, answers: st.answers}, st.briefLog, Date.now());
    const chat = chats.current.frank, current = () => chats.current.frank === chat;
    // his opening after all, if he's still the one on the tab
    const opening = () => { if (useMoney.getState().accountant === "frank") replay.current(); };
    const keep = (text: string, mentioned: string[]) =>
      useMoney.getState().setBriefLog(logBrief(useMoney.getState().briefLog, kind, facts, mentioned, text, Date.now(), ctx.today));
    setWorking({who: "frank", doing: HAVING_A_LOOK});
    converse(talks.current.frank, briefingAsk(kind, facts, st.briefLog), depsOf("frank", current, null), new Date(), [], {whole: true})
      .then(a => {
        if (!current()) return;
        if (a.nothing) { keep("", []); return opening(); }
        if (a.ended || !a.text) return opening();
        talks.current.frank = a.transcript;
        setSmallFor(sm => ({...sm, frank: true}));
        // the facts came from the engine, as the overview tool's do
        const id = say(saidOf("frank", {...a, used: ["overview", ...a.used]}, new Date()));
        keep(a.text, a.mentioned ?? []);
        // all of it out loud, only when every figure checked out (`spoken`)
        if (a.spoken && useMoney.getState().speaks) readOut.current(id, a.spoken, current);
      })
      .catch(e => {
        if (!(e instanceof AccountantFail)) console.warn("Frank's briefing failed:", e instanceof Error ? e.message : e);
        if (current()) opening();
      })
      .finally(() => { if (current()) setWorking(null); });
    // "Just a second… let me have a look.", in his voice, while he writes it
    return {frames: waitFrames(), clips: FRANK_WAIT_CLIPS};
  };
  // his opening as the animation only when it's chosen in Settings (`frankOpening`), in light mode
  const animated = useMoney(st => st.frankOpening) === "animation";
  const speech = useSpeech(reduced, who, briefing, animated && who === "frank" && !dark && !reduced);
  // his video shows at once as its sound starts (his lips are on it), and fades slowly into his picture when it's over
  const film = useSharedValue(0);
  useEffect(() => { film.value = speech.video ? 1 : withTiming(0, {duration: FILM_FADE, easing: Easing.out(Easing.cubic)}); }, [speech.video, film]);
  const filmFade = useAnimatedStyle(() => ({opacity: film.value}));
  useEffect(() => { replay.current = speech.replay; }, [speech.replay]);
  const pic = width * PIC / W, k = width / SRC_W;
  // where his words go: beside his head, on this line's side
  const {figure, top} = WORDS[who];
  const room = roomOf(width, figure, SRC_W);
  const words = speech.side === "left"
    ? {left: CAPTION.edge, width: room.left, textAlign: "right" as const}
    : {left: figure.right * k + CAPTION.gap, width: room.right, textAlign: "left" as const};
  const size = wordsFit(speech.lines, room, CAPTION.size);
  const tone = timPage[dark ? "dark" : "light"], {box, edge, mine, mineInk, send: sendBg, sendInk} = tone;
  // each chat's face in the recent chats panel: his picture for this mode, cropped as his bubble is
  const faces = useMemo(() => {
    const face = (w: Accountant): Face => ({pic: ((dark && ART[w].dark) || ART[w].light).pic, ...BUBBLE[w], size: BUBBLE_D, w: SRC_W, h: SRC_W * PIC / W});
    return {tim: face("tim"), frank: face("frank")};
  }, [dark]);
  const bg = tone.page; // his picture's own background

  // Asked something, he's a bubble (0: his picture, 1: the bubble), pinned at the top as the conversation scrolls, his name
  // beside it. He shrinks into it as you send; tap it and he's back as he was, with his hello, for a new chat (his
  // conversation cleared, the other's kept). A switch to the other accountant shows him as he is straight away, and so does
  // reduced motion.
  const small = smallFor[who];
  // while a conversation's going, no tab bar, for the room (the other tabs are in the recent chats panel); back with a
  // new chat, or when you leave the tab
  const setBare = useChrome(st => st.setBare);
  useFocusEffect(useCallback(() => { setBare((small || lookingThrough) && !settling); return () => setBare(false); }, [small, lookingThrough, settling, setBare]));
  useEffect(() => { smallNow.current = small; }, [small]);
  useEffect(() => { mouthNow.current = speech.mouth; }, [speech.mouth]);
  // asked something, or Frank's briefing: his bubble and his name at the top
  const asked = small && thread.some(s => s.who === who);
  const shrunk = useSharedValue(small ? 1 : 0), was = useRef(who);
  useEffect(() => {
    const to = small ? 1 : 0;
    shrunk.value = reduced || was.current !== who ? to : withTiming(to, {duration: SHRINK_MS, easing: Easing.out(Easing.cubic)});
    was.current = who;
  }, [small, who, reduced, shrunk]);
  const {hush} = speech;
  useEffect(() => { if (small) hush(); }, [small, hush]); // in his bubble, he stops talking out loud
  // the microphone in the box. Trouble goes in the conversation in his own voice, where it's read out like his answers
  const dict = useDictation({q, setQ, hush, trouble: text => say({who, mine: false, text, quiet: true})});
  const {close: closeMic} = dict;
  useEffect(() => { closeMic(); }, [who, closeMic]); // switching accountant closes it; the box keeps its words
  // his eyes: down at the box while you type or dictate (he's watching it fill), up and away while he works it out
  const mood: Mood = thinking ? "thinking" : dict.listening || boxFocused || q.trim() ? "typing" : "idle";
  // an accountant's chat put away (it's already kept, from the last time it changed): a new one starts empty
  const clear = (w: Accountant) => {
    chats.current[w]++;
    talks.current[w] = [];
    outcomes.current[w] = [];
    setChatId(w, null);
    setThread(th => th.filter(s => s.who !== w));
    setWorking(x => x?.who === w ? null : x);
    setSmallFor(sm => ({...sm, [w]: false}));
  };
  const grow = () => {
    clear(who);
    scroll.current?.scrollTo({y: 0, animated: !reduced});
    speech.replay();
  };
  const newChat = (w: Accountant) => { if (w === who) grow(); else clear(w); };

  // Recent chats (lib/chats.ts, db/chats.ts): each chat is kept on the phone, what's on screen and what Claude saw, every time
  // it changes, so it can be opened again from the panel and carried on. Only once you've asked something; kept 30 days.
  const kept = useRef<Record<Accountant, string>>({tim: "", frank: ""}); // what was last kept of each, so nothing's kept twice
  useEffect(() => {
    for (const w of ["tim", "frank"] as const) {
      const id = chatId.current[w], mine = thread.filter(s => s.who === w), first = mine.find(s => s.mine);
      if (!id || !first || tempRef.current) continue;
      const saved = toSaved(mine), sig = JSON.stringify(saved);
      if (sig === kept.current[w]) continue;
      kept.current[w] = sig;
      const now = nowMs();
      saveChat({id, who: w, title: titleOf(first.text, 80, first.attached), created: made.current[w] || now, updated: now, body: bodyOf(saved), said: saved, transcript: talks.current[w]})
        .catch(e => console.warn("Couldn't keep the chat:", e instanceof Error ? e.message : e));
    }
  }, [thread]);
  const [chatRows, setChatRows] = useState<ChatRow[]>([]);
  const [chatQuery, setChatQuery] = useState("");
  const [chatsAt, setChatsAt] = useState(0); // when they were read, for their groups (Today, Yesterday…)
  const readChats = async () => {
    const now = nowMs();
    try { await pruneChats(cutoff(now)); setChatRows(await listChats(cutoff(now))); setChatsAt(now); }
    catch (e) { console.warn("Couldn't read the chats:", e instanceof Error ? e.message : e); }
  };
  // the burger button: the chats are read again each time the panel opens, with the search empty
  const toggleDrawer = () => {
    Keyboard.dismiss();
    if (!drawer) { setChatQuery(""); void readChats(); }
    setDrawer(!drawer);
  };
  const setTempChat = (on: boolean) => {
    if (tempRef.current === on) return;
    tempRef.current = on;
    setTemp(on);
    clear(who === "tim" ? "frank" : "tim");
    newChat(who);
  };
  const toggleTemp = () => {
    Keyboard.dismiss();
    setTempChat(!tempRef.current);
    // said under him while it's on (TempNote), so no toast; the screen reader is told, as the toast was
    AccessibilityInfo.announceForAccessibility(tempRef.current ? "Temporary chat on. Not kept, and nothing's noted." : "Temporary chat off.");
  };
  // an old chat back on screen, with whoever it was with, ready to carry on
  const openChat = async (id: string) => {
    const c = await loadChat<Said, Transcript>(id).catch(() => null);
    if (!c) { void readChats(); return; }
    const w = c.who, back = fromSaved(c.said, () => said.current++);
    // a kept chat opened ends the temporary one; the other accountant's temporary chat goes too, so it's never kept
    if (tempRef.current) { tempRef.current = false; setTemp(false); clear(w === "tim" ? "frank" : "tim"); }
    if (chatId.current[w] !== id) {
      chats.current[w]++; // an answer still coming to the chat on screen is dropped
      talks.current[w] = c.transcript;
      outcomes.current[w] = [];
      setChatId(w, id);
      made.current[w] = c.created;
      kept.current[w] = JSON.stringify(toSaved(back));
      speech.hush();
      setWorking(x => x?.who === w ? null : x);
      setThread(th => [...th.filter(s => s.who !== w), ...back]);
      setSmallFor(sm => ({...sm, [w]: true}));
      follow.current = true;
    }
    if (w !== who) useMoney.getState().setAccountant(w);
    setDrawer(false);
  };
  const removeChat = async (id: string) => {
    await deleteChat(id).catch(e => console.warn("Couldn't delete the chat:", e instanceof Error ? e.message : e));
    setChatRows(rows => rows.filter(r => r.id !== id));
    for (const w of ["tim", "frank"] as const) if (chatId.current[w] === id) newChat(w);
  };
  const bubbleTop = insets.top + SWITCH_H + TOP_ROOM, {scale: bs, x: bx, y: by} = BUBBLE[who], fit = bs / k;
  // where your question sits once sent: 16pt under the hairline of the bar behind his bubble
  const pinTop = small ? bubbleTop + BUBBLE_D + BAR_FOOT + 16 : 0;
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
  const roomFade = useAnimatedStyle(() => ({opacity: 1 - shrunk.value})); // the room around him goes as he shrinks
  const space = useAnimatedStyle(() => ({minHeight: DROP + pic + (bubbleTop + BUBBLE_D - DROP - pic) * shrunk.value}));
  const after = useAnimatedStyle(() => ({opacity: Math.max(0, shrunk.value - .8) / .2})); // the words and his hair, as he lands
  const standInFade = useAnimatedStyle(() => ({opacity: 1 - hideReal.value})); // the Smart Organisation screen's Frank stands in for him

  // He says the line of his answer out loud from his bubble, his words beside it as he says them. ElevenLabs records it
  // once (the accountant function's /say); the take stays with his answer, so a tap on the answer plays it again for nothing.
  const fits = bubbleFits(width - 64 - BUBBLE_D - 12, SAID.size, SAID.rows);
  // in development, one line per question in the log: how long each stage took from Send (lib/ai/timings.ts)
  const logTimes = (by: Accountant, clock: Stopwatch | null) => { if (clock) console.log(`${PEOPLE[by].name} timings: ${clock.line()}`); };
  const voice = (by: Accountant, id: number, line: string, current: () => boolean, clock: Stopwatch | null, kind?: "brief") => {
    clock?.mark("take asked");
    sayAloud(by, line, kind).then(take => {
      clock?.mark(take ? "take ready" : "no take");
      if (!take || !current()) return logTimes(by, clock);
      setThread(th => th.map(s => s.id === id ? {...s, voiced: {line, take}} : s));
      speech.speak(by, line, take, fits, heard => { clock?.mark(heard ? "voice heard" : "voice never started"); logTimes(by, clock); });
    });
  };
  useEffect(() => { readOut.current = (id, line, current) => voice("frank", id, line, current, null, "brief"); });
  // A card's yes or no: yes makes the change (the store files its payments, saves the bill and reads it back), then he says it's
  // done, with Undo on the toast; no leaves everything as it was. Either way he's told on your next message.
  const setCard = (id: number, i: number, k: Partial<Card>) =>
    setThread(th => th.map(s => s.id === id && s.cards ? {...s, cards: s.cards.map((x, j) => j === i ? {...x, ...k} : x)} : s));
  const setCatCard = (id: number, i: number, k: Partial<CatCard>) =>
    setThread(th => th.map(s => s.id === id && s.catCards ? {...s, catCards: s.catCards.map((x, j) => j === i ? {...x, ...k} : x)} : s));
  const decide = async (s: Said, i: number, yes: boolean) => {
    const by = s.who, card = s.cards![i], st = useMoney.getState(), chat = chats.current[by], still = () => chats.current[by] === chat;
    const ctx = {state: st.state!, txs: st.txs, today: st.today};
    if (!yes) {
      setCard(s.id, i, {status: "declined"});
      outcomes.current[by].push(outcomeLine(ctx, card.p, "declined"));
      // a regular payment you didn't want as a bill: not asked about again for a while
      if (card.p.kind === "add" && card.p.ref) st.answerRegular(card.p.ref, "not_now", card.p.bill.name);
      say({who: by, mine: false, text: leftLine(by)});
      return;
    }
    setCard(s.id, i, {status: "saving"});
    const line = outcomeLine(ctx, card.p, "done");
    const r = await st.applyProposal(card.p);
    if (!still()) return;
    if ("error" in r) { setCard(s.id, i, {status: r.stale ? "stale" : "failed", note: r.error}); return; }
    setCard(s.id, i, {status: "done"});
    outcomes.current[by].push(line);
    st.notify(toastOf(card.p), false, () => {
      void r.undo();
      setCard(s.id, i, {status: "undone"});
      outcomes.current[by].push(outcomeLine(ctx, card.p, "undone"));
    });
    const text = doneLine(card.p, by), id = say({who: by, mine: false, text});
    if (useMoney.getState().speaks) voice(by, id, text, still, null);
  };
  const decideCat = async (s: Said, i: number, yes: boolean) => {
    const by = s.who, card = s.catCards![i], st = useMoney.getState(), chat = chats.current[by], still = () => chats.current[by] === chat;
    const cats = st.state?.categories ?? [];
    if (!yes) {
      setCatCard(s.id, i, {status: "declined"});
      outcomes.current[by].push(catOutcomeLine(cats, card.p, "declined"));
      say({who: by, mine: false, text: catLeftLine(by)});
      return;
    }
    setCatCard(s.id, i, {status: "saving"});
    const line = catOutcomeLine(cats, card.p, "done");
    const r = await st.applyCategoryProposal(card.p);
    if (!still()) return;
    if ("error" in r) { setCatCard(s.id, i, {status: r.stale ? "stale" : "failed", note: r.error}); return; }
    setCatCard(s.id, i, {status: "done"});
    outcomes.current[by].push(line);
    st.notify(catDoneLine(cats, card.p, by), true, () => {
      void r.undo();
      setCatCard(s.id, i, {status: "undone"});
      outcomes.current[by].push(catOutcomeLine(cats, card.p, "undone"));
    });
    const text = catDoneLine(cats, card.p, by), id = say({who: by, mine: false, text});
    if (useMoney.getState().speaks) voice(by, id, text, still, null);
  };
  const setOrgCard = (id: number, k: Partial<OrgCardState>) =>
    setThread(th => th.map(s => s.id === id && s.orgCard ? {...s, orgCard: {...s.orgCard, ...k}} : s));
  const decideOrg = async (s: Said, confirmed: boolean) => {
    const by = s.who, chat = chats.current[by], still = () => chats.current[by] === chat;
    if (!confirmed) {
      setOrgCard(s.id, {status: "cancelled"});
      outcomes.current[by].push(orgOutcomeLine(s.orgCard!.proposal.preview.runId, "cancelled"));
      orgApplyRef.current = null;
      return;
    }
    setOrgCard(s.id, {status: "saving"});
    const apply = orgApplyRef.current;
    orgApplyRef.current = null;
    if (!apply) { setOrgCard(s.id, {status: "failed"}); return; }
    const r = await apply.apply(s.orgCard!.skippedKeys, s.orgCard!.edits);
    if (!still()) return;
    if (!r) { setOrgCard(s.id, {status: "failed"}); return; }
    setOrgCard(s.id, {status: "done", report: r.report});
    outcomes.current[by].push(orgOutcomeLine(s.orgCard!.proposal.preview.runId, r));
  };
  const undoOrg = async (s: Said) => {
    const runId = s.orgCard!.proposal.preview.runId;
    const r = await useMoney.getState().undoOrganisation(runId);
    if (!r) return;
    setOrgCard(s.id, {status: "undone"});
    outcomes.current[s.who].push(`Organisation undone (run ${runId}): ${r.restored} payment${r.restored === 1 ? "" : "s"} put back.`);
  };
  // the cards still waiting for your yes, in this accountant's chat
  const openCards = (w: Accountant) => [
    ...thread.filter(s => s.who === w && s.cards).flatMap(s => s.cards!.map((k, i) => ({s, i, k}))).filter(x => waits(x.k)),
    ...thread.filter(s => s.who === w && s.catCards).flatMap(s => s.catCards!.map((k, i) => ({s, i, k}))).filter(x => waits(x.k)),
  ];
  // `extra`: what the app tells him with this question only (a product you tapped on his card)
  const go = (text: string, extra: string[] = []) => {
    const to = who, chat = chats.current[to], still = () => chats.current[to] === chat;
    const files = attach; // the tray goes with this question
    setAttach([]);
    const clock = __DEV__ ? stopwatch() : null;
    // a card you answered with words instead: it closes, nothing changed, and he reads what you said
    const st0 = useMoney.getState();
    const ctx0 = st0.state ? {state: st0.state, txs: st0.txs, today: st0.today} : null;
    for (const s of thread.filter(x => x.who === to)) {
      s.cards?.forEach((k, i) => { if (waits(k)) { setCard(s.id, i, {status: "unanswered"}); if (ctx0) outcomes.current[to].push(outcomeLine(ctx0, k.p, "unanswered")); } });
      s.catCards?.forEach((k, i) => { if (waits(k)) { setCatCard(s.id, i, {status: "unanswered"}); if (ctx0) outcomes.current[to].push(catOutcomeLine(ctx0.state.categories, k.p, "unanswered")); } });
      if (s.orgCard?.status === "open" || s.orgCard?.status === "saving" || s.orgCard?.status === "failed") {
        setOrgCard(s.id, {status: "cancelled"});
        outcomes.current[to].push(orgOutcomeLine(s.orgCard.proposal.preview.runId, "cancelled"));
        orgApplyRef.current = null;
      }
    }
    const context = [...outcomes.current[to].splice(0), ...extra, ...tempRef.current ? [TEMP_CHAT] : []];
    if (!chatId.current[to]) { const n = newChatId(); setChatId(to, n.id); made.current[to] = n.made; }
    say({who: to, mine: true, text, ...files.length ? {attached: shownOf(files)} : {}});
    setSmallFor(sm => ({...sm, [to]: true}));
    setWorking({who: to, doing: "Thinking…"});
    setLooked([]);
    converse(talks.current[to], text, depsOf(to, still, clock), new Date(), context, files.length ? {attach: files} : {})
      .then(a => {
        if (!still()) return;
        talks.current[to] = a.transcript;
        const id = say(saidOf(to, a, new Date()));
        clock?.mark("answer on screen");
        if (a.spoken && useMoney.getState().speaks) voice(to, id, a.spoken, still, clock);
        else logTimes(to, clock);
      })
      .catch(e => {
        // the question stays in the thread; the conversation carries on from before it
        if (!(e instanceof AccountantFail)) console.warn("Accountant failed:", e instanceof Error ? e.message : e);
        clock?.mark(`couldn't answer (${e instanceof AccountantFail ? e.kind : "error"})`);
        logTimes(to, clock);
        if (still()) say({who: to, mine: false, text: PEOPLE[to].fails[e instanceof AccountantFail ? e.kind : "unavailable"], quiet: true});
      })
      .finally(() => { if (still()) setWorking(null); });
  };
  // what's in the box, or a suggestion you tapped (sent as it is, the box left alone); `extra` goes to him with it only
  const ask = (tapped?: string, extra: string[] = []) => {
    const text = tapped ?? q.trim();
    // a photo or file can go on its own, with no words
    if ((!text && !attach.length) || working || dict.listening || !useMoney.getState().state) return;
    if (!tapped) setQ("");
    Keyboard.dismiss(); // sent: the keyboard goes down so his answer has the room
    // a plain yes or no to the one card he's showing is the same as tapping it: no need to ask him (never with a photo or file)
    const open = openCards(who), reply = !tapped && !attach.length && open.length === 1 ? yesNo(text) : "reply";
    if (reply !== "reply") {
      say({who, mine: true, text});
      const oc = open[0];
      if ("view" in oc.k) void decide(oc.s, oc.i, reply === "yes");
      else void decideCat(oc.s, oc.i, reply === "yes");
      return;
    }
    // the first time, he asks before looking at your numbers
    if (!useMoney.getState().aiConsent) { waitingExtra.current = extra; setWaiting(text); }
    else go(text, extra);
  };
  // a product you tapped on his card: you ask whether it fits, and the app tells him which one (by its id, never its price, so the
  // price reaches your money only through show_products, with how sure it is)
  const choose = (t: Tile) => {
    if (working || !t.selectable) return;
    ask(`Can I afford the ${t.name} from ${t.retailer}?`, [`They tapped ${t.id} on your card: ${t.name} at ${t.retailer}. Call show_products with ids ["${t.id}"] and pick "${t.id}", then answer whether they can afford it, and whether waiting for payday would be better.`]);
  };
  // a photo or file in the tray is something to send, words or not
  const sendable = !!q.trim() || attach.length > 0;
  const button = micState({listening: dict.listening, text: sendable ? q || "attached" : "", working: !!working, canDictate: dict.able});
  const off = button === "send" && !!working; // only Send ever waits; stop and the microphone are always yours to tap
  // an empty box shows the soundwave, even where the phone can't listen (there it's still Send, with nothing to send)
  const icon = button === "send" && !working && !sendable ? "wave" : MIC_BUTTON[button].icon;
  // read out what he's doing, and what he says when he's done
  const last = thread[thread.length - 1];
  // what you might ask next, under his latest answer, while he isn't working
  const latest = thread.filter(s => s.who === who).at(-1);
  // on an empty chat while the box is empty (not while the "+" menu is out): what each accountant can do, a stack above the box
  const showFeatures = (!talked && !q && !dict.listening && !working && !plus) || settling;
  const chip = (text: string, onTap: (text: string) => void = ask) => (
    <Pressable key={text} onPress={() => onTap(text)} accessibilityRole="button" accessibilityHint={`Asks ${name}`}
      style={{paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderCurve: "continuous", borderWidth: 1, borderColor: edge, backgroundColor: box}}>
      <Text style={{fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.ink}}>{text}</Text>
    </Pressable>
  );
  useEffect(() => { if (working) AccessibilityInfo.announceForAccessibility(working.doing); }, [working]);
  // development: Settings plays the screen with no question asked, so no AI credits are spent
  const {org: playOrg} = useLocalSearchParams<{org?: string}>();
  useEffect(() => {
    if (!__DEV__ || !playOrg) return;
    const t = setTimeout(openOrg, 300);
    return () => clearTimeout(t);
  }, [playOrg]);
  // opened by the chip before he looked: if the question ends without him organising anything, it goes away
  useEffect(() => {
    if (working || !lookingThrough) return;
    return closeOrg();
  }, [working, lookingThrough]);
  // "Organise my N unsorted payments": straight into the Smart Organisation screen, not after his first reply
  const organiseChip = (text: string) => {
    if (useMoney.getState().aiConsent && useMoney.getState().state) openOrg();
    ask(text);
  };
  // what each accountant can do, on the empty chat: Frank's are his bookkeeping and shopping, Tim's are planning. A row that
  // needs your numbers (a goal, a what-if, a price) starts the sentence in the box for you to finish; the others ask straight away.
  type Feature = {key: "sort" | "shop" | "bills" | "save" | "ahead" | "ifs"; icon: ComponentProps<typeof Icon>["name"]; title: string; note?: string};
  const FEATURES: Feature[] = isTim ? [
    {key: "save", icon: "piggy", title: "Smart Save"},
    {key: "ahead", icon: "eye", title: "Look Ahead"},
    {key: "ifs", icon: "question", title: "What If"},
  ] : [
    {key: "shop", icon: "bag", title: "Shopping"},
    {key: "bills", icon: "month", title: "Find my bills"},
    {key: "sort", icon: "broom", title: "Smart Sort", note: needsCatCount > 0 ? `${needsCatCount} to sort` : undefined},
  ];
  const startFeature = (key: Feature["key"]) => {
    if (key === "sort") {
      if (needsCatCount > 0) organiseChip(`Smart Sort my ${needsCatCount} unsorted payment${needsCatCount === 1 ? "" : "s"}`);
      else ask("Smart Sort my payments");
    } else if (key === "bills") ask("Have I missed any regular payments that should be bills?");
    else if (key === "ahead") ask("Will I make it to my next payday, and what would change that?");
    else {
      setQ(key === "shop" ? "Can I afford " : key === "save" ? "I want to save £ for " : "What if I ");
      input.current?.focus();
    }
  };
  useEffect(() => { if (last && !last.mine) AccessibilityInfo.announceForAccessibility(`${PEOPLE[last.who].name} says: ${last.text}`); }, [last]);

  return (
    <View ref={page} onLayout={measure} style={{flex: 1, overflow: "hidden"}}>
    <Reanimated.View style={[{flex: 1}, pushed]}>
    {/* a drag on the conversation puts the keyboard away, and the box comes down with it */}
    {/* while he's a bubble, it and his name stay at the top (the first child sticks) as the conversation scrolls under them */}
    <ScrollView ref={scroll} testID="conversation" style={{flex: 1}} contentContainerStyle={{alignItems: "center", paddingHorizontal: 32, paddingBottom: 24}}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" stickyHeaderIndices={small ? [0] : []}
      contentInset={{bottom: covered}} scrollIndicatorInsets={{bottom: covered}}
      onLayout={e => setViewH(e.nativeEvent.layout.height)}
      onContentSizeChange={() => {
        if (!follow.current) return;
        follow.current = false;
        scroll.current?.scrollToEnd({animated: !reduced});
      }}>
      <Reanimated.View style={[{alignSelf: "stretch", marginHorizontal: -32, backgroundColor: bg}, space]}>
        {/* while he's a bubble, the bar behind him and his name is solid, in the page's colour, ending in a hairline, not a fade */}
        {small && (
          <View pointerEvents="none" style={{position: "absolute", left: 0, right: 0, top: 0, bottom: -BAR_FOOT, backgroundColor: bg}}>
            <View style={{position: "absolute", left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: edge}} />
          </View>
        )}
        {/* asked something: room for his bubble, and his name beside it */}
        {asked && (
          <View style={{flexDirection: "row", alignItems: "flex-start", gap: 12, paddingTop: bubbleTop, paddingHorizontal: 32}}>
            <View style={{width: BUBBLE_D, height: BUBBLE_D}} />
            {/* centred on the bubble; a long question runs on below it. While he says his answer out loud, his words */}
            {/* take its place as he says them (the screen reader has his whole answer already) */}
            {speech.speaking ? (
              <Reanimated.View accessible accessibilityLabel={`${name} says: ${speech.line}`} style={[{flex: 1, minWidth: 0, alignSelf: "center", gap: 4}, after]}>
                <Text style={{fontFamily: hanken.semibold, fontSize: 12, lineHeight: 15, letterSpacing: 1, textTransform: "uppercase", color: c.muted}}>{name}</Text>
                <Text testID="said-aloud" style={{fontFamily: hanken.medium, fontSize: SAID.size, lineHeight: SAID.line, color: c.ink, minHeight: SAID.line}}>{speech.shown}</Text>
              </Reanimated.View>
            ) : (
              <Reanimated.View style={[{flex: 1, minWidth: 0, alignSelf: "center", gap: 2}, after]}>
                <Text style={{fontFamily: hanken.semibold, fontSize: 18, lineHeight: 23, letterSpacing: -.18, color: c.ink}}>{name}</Text>
                {temp
                  ? <TempNote color={c.muted} reduced={reduced} />
                  : <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>Tap him for a new chat</Text>}
              </Reanimated.View>
            )}
          </View>
        )}
        {/* his hair out over the bubble's top (where the copy's background is the page's own) */}
        {asked && blends && (
          <Reanimated.View {...hidden} style={[{position: "absolute", left: 32, top: bubbleTop - TOP_ROOM, width: BUBBLE_D, height: TOP_ROOM + HAIR[1], overflow: "hidden"}, after]}>
            <Image source={src} style={{position: "absolute", left: -bx * bs, top: TOP_ROOM - by * bs, width: SRC_W * bs, height: SRC_W * bs * PIC / W}} resizeMode="cover" />
            <LinearGradient colors={[bg + "00", bg]} style={{position: "absolute", left: 0, right: 0, top: TOP_ROOM + HAIR[0], height: HAIR[1] - HAIR[0]}} />
          </Reanimated.View>
        )}
        <Reanimated.View style={[{position: "absolute", overflow: "hidden"}, clip, standInFade]}>
          <Reanimated.View style={[{width, height: pic, transformOrigin: "left top"}, face]}>
            <Image source={src} testID={`${who}-picture`} style={{width, height: pic}} resizeMode="cover" accessibilityLabel={alt} />
            {/* the room around him, over his picture and under everything that moves (he's cut out of it) */}
            {office != null && (
              <Reanimated.View {...hidden} style={[{position: "absolute", left: 0, top: 0, width, height: pic}, roomFade]}>
                <Image source={office} style={{width, height: pic}} resizeMode="cover" />
              </Reanimated.View>
            )}
            {/* tap him and he says who he is again (not once he's a bubble) */}
            {!small && <Pressable onPress={speech.replay} style={{position: "absolute", left: 0, top: 0, right: 0, bottom: 0}}
              accessibilityRole="button" accessibilityLabel={`Hear ${name} say who he is`} />}
            {/* Frank goes on with his own work, whatever you're doing, but looks at you while he talks */}
            <Eyes key={`eyes-${who}`} width={width} kit={art.eyes} mood={isTim ? mood : "idle"} script={isTim && mood !== "idle" ? undefined : speech.script} shareRef={eyesNow} />
            <MouthPieces key={`mouth-${who}`} width={width} who={who} kit={art.mouth} mouth={speech.mouth} />
            {/* his opening as a video, over all of him (the picture's own size and place, its background the page's) from when
                its sound starts; kept mounted so it doesn't flash. When it ends it fades slowly into his picture (FILM_FADE);
                he's the picture again once he's stopped or a bubble. */}
            {who === "frank" && !small && VideoView && speech.movie && (
              <Reanimated.View {...hidden} style={[{position: "absolute", left: 0, top: 0, width, height: pic}, filmFade]}>
                <VideoView player={speech.movie} nativeControls={false} contentFit="cover" allowsPictureInPicture={false} style={{width, height: pic}} />
              </Reanimated.View>
            )}
            {!small && <Text accessibilityLabel={speech.said ? `${name} says: ${speech.shown.replace(/^\.+/, "")}` : undefined} accessibilityLiveRegion="polite"
              style={{position: "absolute", ...words, top: top * k, fontFamily: hanken.medium, fontSize: size, lineHeight: Math.round(size * CAPTION.leading), color: c.ink}}>
              {speech.shown}
            </Text>}
            <LinearGradient colors={[bg, bg + "00"]} style={{position: "absolute", left: 0, right: 0, top: 0, height: FADE}} pointerEvents="none" />
            <LinearGradient colors={[bg + "00", bg]} style={{position: "absolute", left: 0, right: 0, bottom: 0, height: FADE}} pointerEvents="none" />
          </Reanimated.View>
          {!dark && <Reanimated.View pointerEvents="none" style={[{position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderWidth: 1, borderColor: "rgba(0,0,0,.05)"}, ring]} />}
          {/* tap the bubble and he's back as he was, for a new chat */}
          {small && <Pressable onPress={grow} style={{position: "absolute", left: 0, top: 0, right: 0, bottom: 0}}
            accessibilityRole="button" accessibilityLabel={`New chat with ${name}`} />}
        </Reanimated.View>
        {/* a temporary chat, said just under him on the page's own colour (his picture has faded out by then) */}
        {temp && !small && (
          <View pointerEvents="none" style={{position: "absolute", left: 32, right: 32, top: DROP + pic + 4, alignItems: "center"}}>
            <TempNote color={c.muted} reduced={reduced} />
          </View>
        )}
      </Reanimated.View>

      {/* the conversation, one message after another: yours on the right in a filled grey bubble, his on the left as plain
          words with a row of small icons under it that ends it, and more room before your next question than inside an
          exchange */}
      {talked && (
        <View onLayout={e => { listY.current = e.nativeEvent.layout.y; }} style={{marginTop: 32, alignSelf: "stretch", gap: 40}}>
          {exchanges(thread.filter(s => s.who === who)).map((group, gi, groups) => (
          <View key={group[0].id} onLayout={e => {
            if (pin.current !== group[0].id) return;
            pin.current = null;
            // where the list starts once he's a bubble (he may still be shrinking into it, the list moving up with him)
            const top = small ? bubbleTop + BUBBLE_D + 32 : listY.current;
            scroll.current?.scrollTo({y: Math.max(0, top + e.nativeEvent.layout.y - pinTop), animated: !reduced});
          }} style={{gap: 20, minHeight: gi === groups.length - 1 ? Math.max(0, viewH - covered - pinTop - 24) : 0}}>
          {group.map(s => s.mine ? (
            <View key={s.id} style={{alignSelf: "flex-end", alignItems: "flex-end", maxWidth: "80%", gap: 8}}>
              {/* the photos and files you sent with it, above your words */}
              {s.attached ? <Attachments items={s.attached} tone={tone} ink={c.ink} /> : null}
              {s.text ? (
                <View style={{paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, borderCurve: "continuous", backgroundColor: mine}}>
                  <Text accessibilityLabel={`You asked: ${s.text}`} style={{fontFamily: hanken.medium, fontSize: 17, lineHeight: BOX_LINE, color: mineInk}}>{s.text}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View key={s.id} style={{alignSelf: "stretch", gap: 32}}>
            {/* the picture he leads with, or what he found to buy, the whole width; his words under it say what it doesn't */}
            {s.visual ? <AnswerFigure visual={s.visual} />
              : s.research ? <ResearchCard view={s.research} box={box} edge={edge} onOpen={url => { openBrowserAsync(url).catch(() => {}); }}
                onSelect={isNewView(s.research) ? choose : undefined} disabled={!!working} /> : null}
            {/* a bulk organisation preview leads the answer too: nothing is saved until they confirm */}
            {s.orgCard && orgCtx ? (
              <OrgCard who={s.who} proposal={s.orgCard.proposal} status={s.orgCard.status} report={s.orgCard.report}
                edits={s.orgCard.edits} ctx={orgCtx} onEdit={id => { setEditing(id); editingBy.current = s.who; }}
                onEditGroup={t => setPicking({id: s.id, t})}
                color={sendBg} ink={sendInk} box={box} edge={edge} disabled={!!working}
                onConfirm={() => { void decideOrg(s, true); }} onCancel={() => { void decideOrg(s, false); }}
                onUndo={() => { void undoOrg(s); }} />
            ) : null}
            <View style={{alignSelf: "flex-start", maxWidth: "90%", gap: 8}}>
              {/* what he said out loud: tap it to hear it again (the take's on the phone, so it costs nothing) */}
              <Pressable disabled={!s.voiced} onPress={() => s.voiced && speech.speak(s.who, s.voiced.line, s.voiced.take, fits)}
                accessibilityRole={s.voiced ? "button" : undefined} accessibilityHint={s.voiced ? `Hear ${name} say it again` : undefined}>
                <Text accessibilityLabel={`${name} says: ${s.text}`}
                  style={{fontFamily: hanken.medium, fontSize: 17, lineHeight: 25, color: s.quiet ? c.muted : c.ink}}>{s.text}</Text>
              </Pressable>
              {/* where the figures came from, and any he couldn't check */}
              {s.checked ? <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{s.checked}</Text> : null}
              {s.flag ? <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{s.flag}</Text> : null}
              {s.estimate ? <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{s.estimate}</Text> : null}
              {/* what he found on the web: never your bank's word for it, and each page a tap away */}
              {s.web ? (
                <View style={{flexDirection: "row", flexWrap: "wrap", columnGap: 8}}>
                  <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{s.web.length ? "From the web, as listed:" : "Looked on the web, nothing to cite."}</Text>
                  {s.web.map(w => (
                    <Pressable key={w.url} onPress={() => { openBrowserAsync(w.url).catch(() => {}); }} hitSlop={10}
                      accessibilityRole="link" accessibilityLabel={`Open ${w.title}, on ${w.host}`}>
                      <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted, textDecorationLine: "underline"}}>{w.host}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {/* a change to your bills he proposed: nothing happens until you say yes to it */}
              {s.cards?.map((k, i) => (
                <View key={i} style={{marginTop: 8}}>
                  <BillCard view={k.view} status={k.status} note={k.note} color={sendBg} ink={sendInk} box={box} edge={edge} disabled={!!working}
                    onYes={() => { void decide(s, i, true); }} onNo={() => { void decide(s, i, false); }} />
                </View>
              ))}
              {/* a category or filing change he proposed */}
              {s.catCards?.map((k, i) => (
                <View key={i} style={{marginTop: 8}}>
                  <CategoryCard proposal={k.p} cats={cats} status={k.status} note={k.note} color={sendBg} ink={sendInk} box={box} edge={edge} disabled={!!working}
                    onYes={() => { void decideCat(s, i, true); }} onNo={() => { void decideCat(s, i, false); }} />
                </View>
              ))}
              {/* the icon row under an answer, as ChatGPT's: here, hear it again */}
              {s.voiced ? (
                <Pressable onPress={() => s.voiced && speech.speak(s.who, s.voiced.line, s.voiced.take, fits)} hitSlop={10}
                  accessibilityRole="button" accessibilityLabel={`Hear ${name} say it again`} style={{alignSelf: "flex-start", marginLeft: -2}}>
                  <Icon name="speaker" color={c.muted} size={18} />
                </Pressable>
              ) : null}
              {/* what you might ask him next: tap one and it's asked */}
              {s === latest && s.next && !thinking ? (
                <View testID="next" style={{alignItems: "flex-start", gap: 8, marginTop: 8}}>{s.next.map(n => chip(n))}</View>
              ) : null}
            </View>
            </View>
          ))}
          {/* what he's doing while he works it out, where his answer will go, and the sites he's looking at */}
          {thinking && gi === groups.length - 1 ? (
            <View style={{alignSelf: "flex-start", gap: 4}}>
              <Text style={{fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.muted}}>{working?.doing}</Text>
              {looked.length ? <Looked hosts={looked} color={c.muted} reduced={reduced} /> : null}
            </View>
          ) : null}
          </View>
          ))}
        </View>
      )}
    </ScrollView>

    {/* who your accountant is: a two-way switch, pinned just under the status bar, like a chat app's model picker. The page's
        colour behind it, so the conversation scrolls under it; at rest it only covers his picture's empty top, above his hair. */}
    <View style={{position: "absolute", left: 0, right: 0, top: 0, paddingTop: insets.top, paddingBottom: 4, alignItems: "center", backgroundColor: bg}}>
      {/* Liquid Glass where the phone has it, as the round buttons either side are */}
      <Track accessibilityRole="radiogroup" accessibilityLabel="Your accountant" {...GLASS ? {glassEffectStyle: "regular" as const, tintColor: box} : {}}
        style={{flexDirection: "row", padding: 2, borderRadius: 999, ...GLASS ? {} : {backgroundColor: tone.track}}}>
        {(Object.keys(PEOPLE) as Accountant[]).map(a => {
          const on = a === who;
          return (
            <Pressable key={a} onPress={() => useMoney.getState().setAccountant(a)} accessibilityRole="radio" accessibilityState={{selected: on}} hitSlop={{top: 6, bottom: 6}}
              style={{height: 28, paddingHorizontal: 16, borderRadius: 999, justifyContent: "center", backgroundColor: on ? tone.thumb : "transparent"}}>
              <Text style={{fontFamily: hanken.medium, fontSize: 15, color: on ? c.ink : c.muted}}>{PEOPLE[a].name}</Text>
            </Pressable>
          );
        })}
      </Track>
      {/* recent chats: opens the panel on the left */}
      <Pressable testID="recent-chats" onPress={toggleDrawer}
        accessibilityRole="button" accessibilityLabel="Recent chats" accessibilityState={{expanded: drawer}} hitSlop={12}
        style={{position: "absolute", left: 16, top: insets.top - 4, width: 48, height: 48}}>
        <Round fill={tone.track} tint={box}><Icon name="menu" color={c.ink} size={26} /></Round>
      </Pressable>
      {/* a temporary chat, on the right: on, it's filled in ink */}
      <Pressable testID="temporary-chat" onPress={toggleTemp}
        accessibilityRole="switch" accessibilityLabel="Temporary chat" accessibilityHint="Not kept, and nothing's noted" accessibilityState={{checked: temp}} hitSlop={12}
        style={{position: "absolute", right: 16, top: insets.top - 4, width: 48, height: 48}}>
        <Round fill={temp ? c.ink : tone.track} tint={temp ? c.ink : box}><Icon name="incognito" color={temp ? bg : c.ink} size={24} /></Round>
      </Pressable>
    </View>

    {/* the question box, at the bottom as in the OpenAI app; it grows as you write (return makes a new line), Send sends */}
    <Reanimated.View onLayout={e => setFootH(e.nativeEvent.layout.height)} style={[{paddingHorizontal: 32, paddingTop: 8, paddingBottom: 12 + foot, backgroundColor: bg}, lift]}>
      {/* on an empty chat, what Frank can do: three rows stacked just above the box, one tap each */}
      {showFeatures ? (
        <View testID="features" style={{gap: 8, marginBottom: 8}}>
          {FEATURES.map(f => (
            <Pressable key={f.key} onPress={() => startFeature(f.key)} accessibilityRole="button" accessibilityLabel={f.note ? `${f.title}, ${f.note}` : f.title}
              style={{flexDirection: "row", alignItems: "center", gap: 12, height: 48, paddingHorizontal: 16}}>
              <Icon name={f.icon} color={c.ink} size={22} />
              <Text style={{flex: 1, fontFamily: hanken.medium, fontSize: 16, lineHeight: 22, color: c.ink}}>{f.title}</Text>
              {f.note ? <Text style={{fontFamily: hanken.medium, fontSize: 14, lineHeight: 20, color: c.muted}}>{f.note}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {/* Liquid Glass where the phone has it, as the top buttons are, tinted in the box's colour so it reads solid on
          the flat page (untinted, with nothing behind it to frost, it looked faded); else the box in its own colour */}
      <Bar onLayout={e => setBarY(e.nativeEvent.layout.y)} {...GLASS ? {glassEffectStyle: "regular" as const, tintColor: box} : {}} style={[{gap: 4, minHeight: 52, paddingHorizontal: 6, paddingVertical: 6, borderRadius: 26, borderCurve: "continuous"},
        GLASS ? null : {backgroundColor: box, borderWidth: 1, borderColor: edge}]}>
        {/* the photos and files for this question, above the words, each with a × */}
        {attach.length ? (
          <View testID="attach-tray" style={{paddingHorizontal: 6, paddingTop: 6}}>
            <Attachments items={shownOf(attach)} onRemove={i => setAttach(have => have.filter((_a, j) => j !== i))} tone={tone} ink={c.ink} />
          </View>
        ) : null}
        <View style={{flexDirection: "row", alignItems: "flex-end", gap: 4}}>
        {/* in the box, on the left, the send button's size: the "+" card (photos, camera, files, and his model) */}
        <Pressable testID="plus" onPress={openPlus} accessibilityRole="button" accessibilityLabel="Add photos or files, or change model" accessibilityState={{expanded: plus}} hitSlop={4}
          style={{width: 38, height: 38, borderRadius: 19, borderCurve: "continuous", alignItems: "center", justifyContent: "center"}}>
          <Icon name="plus" color={c.ink} size={28} />
        </Pressable>
        <TextInput ref={input} value={q} onChangeText={setQ} placeholder={dict.listening ? "Listening…" : `Ask ${name} anything…`} placeholderTextColor={c.muted} accessibilityLabel={`Ask ${name} a question`}
          multiline autoComplete="off" onFocus={() => setBoxFocused(true)} onBlur={() => setBoxFocused(false)}
          style={{flex: 1, minWidth: 0, maxHeight: BOX_LINE * BOX_LINES + 16, fontFamily: hanken.medium, fontSize: 17, lineHeight: BOX_LINE, color: c.ink, paddingTop: 8, paddingBottom: 8}} />
        {/* the microphone, plain, beside the round button as in the OpenAI app: speak into the box, words or not.
            While it's listening the round button is stop, so this steps aside. Shown even where the phone can't
            listen on its own: a tap then says why */}
        {!dict.listening ? (
          <Pressable onPress={dict.toggle} accessibilityRole="button" accessibilityLabel="Dictate" hitSlop={4}
            style={{width: 38, height: 38, borderRadius: 19, borderCurve: "continuous", alignItems: "center", justifyContent: "center"}}>
            <Icon name="mic" color={c.ink} size={22} />
          </Pressable>
        ) : null}
        {/* one button, three jobs: the microphone when there's nothing to send, stop while it's listening, Send once
            there are words. One question at a time, as before: while he's working it out it stays Send, and waits. */}
        <Pressable onPress={button === "send" ? () => ask() : dict.toggle} disabled={off} accessibilityRole="button" accessibilityLabel={MIC_BUTTON[button].label} accessibilityState={{disabled: off}} hitSlop={4}
          style={{width: 38, height: 38, borderRadius: 19, borderCurve: "continuous", backgroundColor: sendBg, alignItems: "center", justifyContent: "center", opacity: off ? 0.35 : 1}}>
          <Icon name={icon} color={sendInk} size={button === "stop" ? 14 : icon === "wave" ? 22 : 16} />
        </Pressable>
        </View>
      </Bar>
    </Reanimated.View>

    {/* while the panel's open, the page dims a little and a tap on it closes the panel */}
    <Pressable testID="close-recent-chats" onPress={() => setDrawer(false)} pointerEvents={drawer ? "auto" : "none"}
      accessibilityRole="button" accessibilityLabel="Close recent chats" accessibilityElementsHidden={!drawer} importantForAccessibility={drawer ? "auto" : "no-hide-descendants"}
      style={{position: "absolute", left: 0, right: 0, top: 0, bottom: 0}}>
      <Reanimated.View style={[{flex: 1, backgroundColor: "#000000"}, shade]} />
    </Pressable>
    </Reanimated.View>

    {/* the recent chats panel (components/ChatsPanel.tsx) */}
    <Reanimated.View testID="recent-chats-panel" pointerEvents={drawer ? "auto" : "none"} accessibilityElementsHidden={!drawer} importantForAccessibility={drawer ? "auto" : "no-hide-descendants"}
      style={[{position: "absolute", left: 0, top: 0, bottom: 0, width: drawerW, paddingTop: insets.top + 8, paddingHorizontal: 24,
        backgroundColor: tone.box, borderRightWidth: 1, borderRightColor: edge}, slid]}>
      <ChatsPanel rows={chatRows} now={chatsAt} openIds={openIds}
        query={chatQuery} onQuery={setChatQuery} onOpen={id => void openChat(id)} onDelete={id => void removeChat(id)}
        onNew={() => { newChat(who); setDrawer(false); }} onGo={href => { setDrawer(false); router.navigate(href); }}
        tone={tone} bottom={16 + foot} faces={faces} />
    </Reanimated.View>
    {/* the "+" card, over the whole page */}
    <PlusCard open={plus} onClose={() => setPlus(false)} name={name} model={model} onModel={m => useMoney.getState().setModel(who, m)}
      onCamera={() => void pick(() => fromCamera())} onPhotos={() => void pick(fromPhotos)} onFiles={() => void pick(fromFiles)}
      tone={tone} ink={c.ink} muted={c.muted} reduced={reduced} bottom={footH - barY + 8} left={32} plusX={PLUS_X} plusY={12 + foot + 6 + 38 / 2} />
    <OrgScreen open={lookingThrough} done={orgDone} who={who} art={art} src={src} alt={alt} office={office} bg={bg} ink={c.ink} muted={c.muted}
      fill={box} stops={orgStops} count={needsCatCount}
      origin={orgFrom.origin} mouth0={orgFrom.mouth} eyes0={orgFrom.eyes}
      bubbleTop={bubbleTop} width={width} mood="thinking" reduced={reduced} />
    <CategorySheet txId={editing} onClose={() => setEditing(null)} onMoved={line => { outcomes.current[editingBy.current].push(line); }} />
    <CategoryPick target={picking?.t ?? null} state={orgCtx?.state ?? null} onClose={() => setPicking(null)}
      onPick={(key, cat, sub) => { const id = picking?.id; if (id !== undefined) setThread(th => th.map(m => m.id === id && m.orgCard ? {...m, orgCard: {...m.orgCard, edits: {...m.orgCard.edits, [key]: {cat, ...(sub ? {sub} : {})}}}} : m)); }} />
    <ConsentSheet visible={waiting !== null} name={name}
      onYes={() => { const text = waiting ?? "", extra = waitingExtra.current; waitingExtra.current = []; setWaiting(null); useMoney.getState().setAiConsent(true); if (text || attach.length) go(text, extra); }}
      onNo={() => { setQ(waiting ?? ""); waitingExtra.current = []; setWaiting(null); }} />
    </View>
  );
}

export default function TimScreen() {
  // "Ask Frank" on the card island opens moneytracker://tim?who=frank
  const {who} = useLocalSearchParams<{who?: string}>();
  useEffect(() => { if (who === "tim" || who === "frank") useMoney.getState().setAccountant(who); }, [who]);
  return <HomeLook value><Tim /></HomeLook>;
}
