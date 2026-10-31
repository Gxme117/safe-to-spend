import Constants, {ExecutionEnvironment} from "expo-constants";
import {Platform} from "react-native";
import {speechLang} from "@/lib/dictation";

// expo-speech-recognition is a native module, so Expo Go hasn't got it: there (and on Android, which isn't wired up
// yet) the microphone simply isn't offered and the box works exactly as it did. The dev build has it.
const expoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
let mod: typeof import("expo-speech-recognition") | null = null;
if (!expoGo) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only when it's there
  try { mod = require("expo-speech-recognition"); } catch { mod = null; }
}

export const mic = mod?.ExpoSpeechRecognitionModule ?? null;

/** Listen for one of the recogniser's events; does nothing where there's no recogniser. */
export const useMicEvent: typeof import("expo-speech-recognition").useSpeechRecognitionEvent = mod?.useSpeechRecognitionEvent ?? (() => {});

/** Can this phone turn speech into words without sending the audio anywhere?
 *
 *  The last of these is the one that matters. iOS only honours "keep it on the phone" when the language has a model
 *  on the phone, and quietly uses Apple's servers when it hasn't (ExpoSpeechRecognizer.swift sets the flag only
 *  `if recognizer.supportsOnDeviceRecognition`). Nothing in the module stops that, so this is the only thing holding
 *  the promise: no on-device recognition, no microphone. Not cached, so a phone that gains it is noticed next time. */
export function canDictate(): boolean {
  try {
    return !!mic && Platform.OS === "ios" && mic.isRecognitionAvailable() && mic.supportsOnDeviceRecognition();
  } catch {
    return false;
  }
}

/** The language to listen in: the phone's own, so the check above asked about the same one. */
export function micLang(): string {
  try {
    return speechLang(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return speechLang(undefined);
  }
}
