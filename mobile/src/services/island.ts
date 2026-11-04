// The card island (Live Activity, widgets/CardTap.tsx): started when a sync finds a new card payment. iOS only, and never
// in the way: anything that goes wrong is logged and the app carries on. Native modules load only when it's shown, so the
// store (and its tests) don't need them.
import {Platform} from "react-native";
import type {CardTapProps} from "@/lib/cardTap";

// Frank's pictures for the island. Each is copied under a new name whenever it changes, since a copy already there is never
// replaced (face v2: on white; v3: 160px. peek v2: white balanced)
const PICTURES = {
  face: {name: "frank-face-v3.png", asset: require("../../assets/frank-face.png")},
  peek: {name: "frank-peek-v2.png", asset: require("../../assets/frank-peek.png")},
};

/** One of Frank's pictures, copied once into the folder the island can read (it can't see the app's own files). "" if that fails. */
async function pictureFile(which: keyof typeof PICTURES): Promise<string> {
  try {
    const [{widgetsDirectory}, {Asset}, {File}] = await Promise.all([import("expo-widgets"), import("expo-asset"), import("expo-file-system")]);
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

// How long an island stays up: Apple asks for a Live Activity to end soon after its event, and 15 to 30 minutes is
// usually enough. Only the app (or a push, not built yet) can end one, so it ends on a timer while the app's running, and
// otherwise the next time the app comes to the front (`endOldCardTap`). Past it, iOS marks it stale meanwhile.
const LASTS = 15 * 60e3;
const STARTED = "island.startedAt";
let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows the island for a payment: any one already up goes first, so there's only ever one. */
export async function showCardTap(p: CardTapProps): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const [CardTap, {default: Storage}] = await Promise.all([import("@/widgets/CardTap").then(m => m.default), import("expo-sqlite/kv-store")]);
    const [face, peek] = await Promise.all([pictureFile("face"), pictureFile("peek")]);
    await Promise.all(CardTap.getInstances().map(a => a.end("immediate")));
    const now = Date.now();
    CardTap.start({...p, face, peek},"moneytracker://", new Date(now + LASTS));
    Storage.setItemSync(STARTED, String(now));
    clearTimeout(timer);
    timer = setTimeout(() => void endOldCardTap(), LASTS);
  } catch (e) {
    console.warn("The card island didn't start:", e instanceof Error ? e.message : e);  }
}

/** Ends the island once it's been up 15 minutes. Cheap to call: it reads one key and only loads the island when it's due. */
export async function endOldCardTap(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const {default: Storage} = await import("expo-sqlite/kv-store");
    const at = Number(Storage.getItemSync(STARTED));
    if (!at || Date.now() - at < LASTS) return;
    const CardTap = (await import("@/widgets/CardTap")).default;
    await Promise.all(CardTap.getInstances().map(a => a.end("immediate")));
    Storage.removeItemSync(STARTED);
  } catch (e) {
    console.warn("The card island didn't end:", e instanceof Error ? e.message : e);
  }
}
