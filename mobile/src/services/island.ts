// The card island (Live Activity, widgets/CardTap.tsx): started when a sync finds a new card payment. iOS only, and never
// in the way: anything that goes wrong is logged and the app carries on. Native modules load only when it's shown, so the
// store (and its tests) don't need them.
import {Platform} from "react-native";
import type {CardTapProps} from "@/lib/cardTap";

/** Frank's face, copied once into the folder the island can read (it can't see the app's own files). "" if that fails. */
async function faceFile(): Promise<string> {
  try {
    const [{widgetsDirectory}, {Asset}, {File}] = await Promise.all([import("expo-widgets"), import("expo-asset"), import("expo-file-system")]);
    if (!widgetsDirectory) return "";
    const out = new File(widgetsDirectory, "frank-face.png");
    if (!out.exists) {
      const a = await Asset.fromModule(require("../../assets/frank-face.png")).downloadAsync();
      if (!a.localUri) return "";
      await new File(a.localUri).copy(out);
    }
    return out.uri;
  } catch (e) {
    console.warn("The island couldn't have Frank's face:", e instanceof Error ? e.message : e);
    return "";
  }
}

/** Shows the island for a payment: any one already up goes first, so there's only ever one. */
export async function showCardTap(p: CardTapProps): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const CardTap = (await import("@/widgets/CardTap")).default;
    const face = await faceFile();
    await Promise.all(CardTap.getInstances().map(a => a.end("immediate")));
    CardTap.start({...p, face}, "moneytracker://");
  } catch (e) {
    console.warn("The card island didn't start:", e instanceof Error ? e.message : e);  }
}
