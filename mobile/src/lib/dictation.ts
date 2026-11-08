// The microphone in the question box, so you can say what you want to know instead of typing it.
//
// One button does all three jobs, as the chat apps do: the microphone when there's nothing to send, Stop while it's
// listening, and Send once there are words. While he's working an answer out it stays on Send, waiting — one question
// at a time, as it was before, so you're never left holding something you can't send yet.
//
// What you say is added to whatever you'd already typed, so half a typed question can be finished out loud. Each
// result replaces the last, because the recogniser hands back the whole sentence so far every time rather than only
// the new words.
//
// When it doesn't work out he says one calm line, and every one of them ends with something you can do instead. Some
// things aren't worth saying at all: you stopped it yourself, or you said nothing. None of it ever tells you off.

/** Which of its three jobs the one button is doing. */
export type MicState = "mic" | "stop" | "send";

/** What the button looks like and what a screen reader calls it. Send keeps its name, so nothing that knew it changes. */
export const MIC_BUTTON: Record<MicState, {icon: "wave" | "stop" | "up"; label: string}> = {
  mic: {icon: "wave", label: "Speak your question"},
  stop: {icon: "stop", label: "Stop listening"},
  send: {icon: "up", label: "Send"},
};

/** What the button is right now. Listening beats everything, so the first word heard doesn't turn it into Send
 *  mid-sentence; while he's working it stays Send (waiting), so one question at a time still reads plainly. */
export function micState(p: {listening: boolean; text: string; working: boolean; canDictate: boolean}): MicState {
  if (p.listening) return "stop";
  if (p.working || p.text.trim() || !p.canDictate) return "send";
  return "mic";
}

/** The box as it should read: what you'd already typed when the microphone opened, then everything heard since,
 *  one space between them and never two. */
export function withHeard(before: string, heard: string): string {
  if (!before.trim()) return heard;
  if (!heard) return before;
  return `${before.replace(/\s+$/, "")} ${heard}`;
}

/** The words out of a result event: the best of what it offers, or nothing. */
export function transcriptOf(ev: {results?: {transcript?: string}[]}): string {
  return ev.results?.[0]?.transcript?.trim() ?? "";
}

// Nothing to say: you stopped it, or there was nothing to hear. The button just goes back to the microphone.
const QUIET = ["aborted", "no-speech", "speech-timeout", "nomatch"];

const SAY: Record<string, string> = {
  "not-allowed": "I can't hear you — Pocket hasn't got the microphone yet. You can turn it on in Settings, under Pocket",
  "service-not-allowed": "I can't hear you — Pocket hasn't got the microphone yet. You can turn it on in Settings, under Pocket",
  "audio-capture": "The microphone didn't come on. Type your question and I'll read it",
  interrupted: "Something else is using the microphone. Try again in a moment, or just type it",
  busy: "Something else is using the microphone. Try again in a moment, or just type it",
  network: "That wanted to go online to listen, so I stopped. Type your question and I'll read it",
  "language-not-supported": "Your phone can't do this in your language yet. Type your question and I'll read it",
  // ours, not the recogniser's: the phone can't listen without sending your voice away, so we don't
  "not-on-phone": "This phone can't listen without sending your voice away, so I won't. Type your question and I'll read it",
};

/** What he says when the microphone didn't work out — or nothing, when there's nothing worth saying. */
export function calmly(code: string): string | null {
  if (QUIET.includes(code)) return null;
  return SAY[code] ?? "That didn't quite work. Type your question and I'll read it";
}

/** Whether the problem means the microphone isn't ours to use, so it shouldn't be offered again this visit. */
export function micRefused(code: string): boolean {
  return code === "not-allowed" || code === "service-not-allowed";
}

// What we fall back to: a UK app, so UK English.
const HOME = "en-GB";

/** A language tag for the recogniser, from the phone's own locale. Its own, so that the check for whether the phone
 *  can listen without sending your voice away asks about the same language we then listen in. */
export function speechLang(locale: string | undefined): string {
  if (!locale) return HOME;
  const tag = locale.replace(/_/g, "-");
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag) ? tag : HOME;
}
