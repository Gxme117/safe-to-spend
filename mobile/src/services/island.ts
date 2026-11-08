// The card island (Live Activity, widgets/CardTap.tsx): started when a sync finds a new card payment. iOS only, and never
// in the way: anything that goes wrong is logged and the app carries on. Native modules load only when it's shown, so the
// store (and its tests) don't need them.
import {requireOptionalNativeModule} from "expo";
import {Platform} from "react-native";
import {type CardTapProps, islandCaptions, islandFacts, lineOk} from "@/lib/cardTap";
import type {Take} from "@/lib/timSpeech";

// expo-widgets is a native module. Expo Go, and a development build made before it was added, haven't got it, and importing
// it there throws while it loads: Metro reports that as a fatal error (the red screen) however the import is wrapped. So it's
// only imported when the native side is there, and without it the island just doesn't exist.
const hasWidgets = (): boolean => {
  try { return !!requireOptionalNativeModule("ExpoWidgets"); } catch { return false; }
};
const widgets = () => hasWidgets() ? import("expo-widgets") : Promise.reject(new Error("this build has no widgets module"));

// Frank's pictures for the island. Each is copied under a new name whenever it changes, since a copy already there is never
// replaced (face v2: on white; v3: 160px. peek v2: white balanced)
const PICTURES = {
  face: {name: "frank-face-v3.png", asset: require("../../assets/frank-face.png")},
  peek: {name: "frank-peek-v2.png", asset: require("../../assets/frank-peek.png")},
};

/** One of Frank's pictures, copied once into the folder the island can read (it can't see the app's own files). "" if that fails. */
async function pictureFile(which: keyof typeof PICTURES): Promise<string> {
  try {
    const [{widgetsDirectory}, {Asset}, {File}] = await Promise.all([widgets(), import("expo-asset"), import("expo-file-system")]);
    if (!widgetsDirectory) return "";
    const out = new File(widgetsDirectory, PICTURES[which].name);
    if (!out.exists) {
      const a = await Asset.fromModule(PICTURES[which].asset).downloadAsync();
      if (!a.localUri) return "";
      await new File(a.localUri).copy(out);
    }
    return out.uri;
  } catch (e) {
    console.warn(`The island couldn't have Frank's ${which}:`, e instanceof Error ? e.message : e);
    return "";
  }
}

// How long an island stays up: Apple asks for a Live Activity to end soon after its event, and 5 minutes is
// usually enough. Only the app (or a push, not built yet) can end one, so it ends on a timer while the app's running, and
// otherwise the next time the app comes to the front (`endOldCardTap`). Past it, iOS marks it stale meanwhile.
const LASTS = 5 * 60e3;
const STARTED = "island.startedAt";
let timer: ReturnType<typeof setTimeout> | undefined;

const loadIsland = () => hasWidgets() ? import("@/widgets/CardTap").then(m => m.default) : Promise.reject(new Error("this build has no widgets module"));
const loadStorage = () => import("expo-sqlite/kv-store").then(m => m.default);

/** Shows the island for a payment: any one already up goes first, so there's only ever one. `speaks`: Frank may say a line
 *  about it ("They read their answers out" and the AI consent both on), so it's got ready for the play button. */
export async function showCardTap(p: CardTapProps, {speaks = false}: {speaks?: boolean} = {}): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const [CardTap, Storage] = await Promise.all([loadIsland(), loadStorage()]);
    const [face, peek] = await Promise.all([pictureFile("face"), pictureFile("peek")]);
    stopSpeaking();
    voice = null;
    Storage.removeItemSync(VOICE);
    await Promise.all(CardTap.getInstances().map(a => a.end("immediate")));
    const now = Date.now(), shown = {...p, face, peek};
    CardTap.start(shown, "moneytracker://", new Date(now + LASTS));
    Storage.setItemSync(STARTED, String(now));
    clearTimeout(timer);
    timer = setTimeout(() => void endOldCardTap(), LASTS);
    if (speaks) void prepareVoice(shown, now);
  } catch (e) {
    console.warn("The card island didn't start:", e instanceof Error ? e.message : e);
  }
}

/** Ends the island once it's been up 5 minutes. Cheap to call: it reads one key and only loads the island when it's due. */
export async function endOldCardTap(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const Storage = await loadStorage();
    const at = Number(Storage.getItemSync(STARTED));
    if (!at || Date.now() - at < LASTS) { settle().catch(() => {}); return; }
    stopSpeaking();
    voice = null;
    const CardTap = await loadIsland();
    await Promise.all(CardTap.getInstances().map(a => a.end("immediate")));
    Storage.removeItemSync(STARTED);
    Storage.removeItemSync(VOICE);
  } catch (e) {
    console.warn("The card island didn't end:", e instanceof Error ? e.message : e);
  }
}

// Frank's voice in the open island. iOS doesn't tell the app when the island's opened, and the island can't play sound
// itself, so once his line's ready the open island has a play button. Its tap wakes the app in the background (a Live
// Activity intent, expo-widgets' addUserInteractionListener), which plays his take and puts his words in the headline's
// place a caption at a time, then the headline back. The line's written and recorded as the island starts, while you're
// still in the app (iOS hides the island there), so it's ready long before anyone presses play.
const VOICE = "island.voice"; // kept beside STARTED, so a relaunch in the background can still play it
type Voice = {props: CardTapProps; take: Take; captions: {text: string; at: number}[]; started: number};
let voice: Voice | null = null;

/** Has Claude write his line (the accountant function's /line), checks its figures, has it recorded in his voice, and puts
 *  the play button on the island. Anything going wrong and the island just has no play button. */
async function prepareVoice(p: CardTapProps, started: number): Promise<void> {
  try {
    const [{islandLine, say}, CardTap, Storage] = await Promise.all([import("./accountant"), loadIsland(), loadStorage()]);
    const line = await islandLine(islandFacts(p));
    if (!line) return;
    if (!lineOk(line, p)) { console.warn("Frank's island line had a figure the island doesn't show, so he won't say it"); return; }
    const take = await say("frank", line);
    const captions = take ? islandCaptions(line, take) : [];
    const island = CardTap.getInstances()[0];
    // a newer payment's island took its place while he was getting ready
    if (!take || !captions.length || !island || Number(Storage.getItemSync(STARTED)) !== started) return;
    voice = {props: p, take, captions, started};
    Storage.setItemSync(VOICE, JSON.stringify(voice));
    await island.update({...p, voice: true, caption: ""}, new Date(started + LASTS));
  } catch (e) {
    console.warn("Frank's island line isn't ready:", e instanceof Error ? e.message : e);
  }
}

// no sound this long after play (the ringer's audio route failed, say): the captions run on their own clock
const NO_SOUND = 2_000;
// while he speaks: the player and the clock driving the captions; `left` a caption still up after he stopped early
let speaking: {stop: (restore: boolean) => void} | null = null;
let left = false;

/** Plays his line from the island's play button: a press while he's speaking starts him again from the top. */
async function speakOnIsland(): Promise<void> {
  try {
    const Storage = await loadStorage();
    const saved = Storage.getItemSync(VOICE);
    const v = voice ?? (saved ? JSON.parse(saved) as Voice : null);
    if (!v) return;
    stopSpeaking();
    const [{createAudioPlayer, setAudioModeAsync}, CardTap] = await Promise.all([import("expo-audio"), loadIsland()]);
    // a play button you pressed plays whatever the silent switch says (as a voice message does), and keeps playing with the
    // app in the background, where it is when the island's tapped
    await setAudioModeAsync({playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "mixWithOthers"});
    const stale = new Date(v.started + LASTS);
    const show = (caption: string) => {
      left = caption !== "";
      return CardTap.getInstances()[0]?.update({...v.props, voice: true, caption}, stale).catch(() => {});
    };
    const player = createAudioPlayer({uri: v.take.uri});
    // his voice is the clock: the captions start when the sound really does, so they're never ahead of him
    const pressed = Date.now();
    let t0 = 0, shown = -1;
    const tick = setInterval(() => {
      if (!t0) {
        if (player.currentTime > 0) t0 = Date.now() - player.currentTime * 1000;
        else if (Date.now() - pressed > NO_SOUND) t0 = Date.now();
        else return;
      }
      const n = v.captions.findLastIndex(c => c.at <= Date.now() - t0);
      if (n !== shown) { shown = n; void show(v.captions[n].text); }
      if (n === v.captions.length - 1) stop(false); // the last is "": the headline's back
    }, 100);
    const stop = (restore: boolean) => {
      clearInterval(tick);
      player.remove();
      if (speaking?.stop === stop) speaking = null;
      if (restore && left) void show("");
      // back as Tim and Frank's tab has it: through the silent switch, but not in the background
      setAudioModeAsync({playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: "mixWithOthers"}).catch(() => {});
    };
    speaking = {stop};
    player.play();
  } catch (e) {
    console.warn("Frank couldn't speak in the island:", e instanceof Error ? e.message : e);
  }
}

/** Stops him mid-line, leaving the island as it is (`stopSpeaking`, a new one or the end follows straight away). */
function stopSpeaking() {
  speaking?.stop(false);
}

/** A caption left up when he was cut off (the app was suspended mid-line) goes when the app's back: the headline returns. */
async function settle(): Promise<void> {
  if (speaking || !left || !voice) return;
  left = false;
  const CardTap = await loadIsland();
  await CardTap.getInstances()[0]?.update({...voice.props, voice: true, caption: ""}, new Date(voice.started + LASTS)).catch(() => {});
}

/** Listens for the island's play button for as long as the app's running. Returns the way to stop listening. */
export function listenToIsland(): () => void {
  if (Platform.OS !== "ios" || !hasWidgets()) return () => {};
  let sub: {remove(): void} | undefined, gone = false;
  widgets().then(({addUserInteractionListener}) => {
    if (gone) return;
    sub = addUserInteractionListener(e => { if (e.source === "CardTap" && e.target === "frank-say") void speakOnIsland(); });
  }).catch(e => console.warn("The island's play button isn't listened for:", e instanceof Error ? e.message : e));
  return () => { gone = true; sub?.remove(); };
}
