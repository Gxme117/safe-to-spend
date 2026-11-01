// A short reply to the one card he's showing, typed or said: a plain yes or no is taken as tapping it, without asking Claude.
// Strict on purpose, since a yes changes your bills: a few words at most, no figures, no "but". Anything else is a reply for him
// to read ("yes, but make it £14.99" goes to him, and he shows a new card).
export type Reply = "yes" | "no" | "reply";

const YES = new Set(["yes", "yeah", "yep", "yup", "yes please", "sure", "ok", "okay", "go ahead", "go on", "do it", "add it", "please do",
  "please", "that's right", "thats right", "correct", "sounds good", "fine", "yes go ahead", "yeah go ahead", "yes do it", "yeah do it",
  "go for it", "change it", "remove it", "update it", "delete it", "yes that's right", "yeah that's right", "absolutely", "definitely", "perfect"]);
const NO = new Set(["no", "nope", "nah", "no thanks", "not now", "not yet", "leave it", "don't", "dont", "no don't", "cancel", "skip",
  "skip it", "forget it", "never mind", "nevermind", "no leave it", "not really"]);

export function yesNo(text: string): Reply {
  const t = text.toLowerCase().replace(/[’]/g, "'").replace(/[.!,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t || /\d|£|\bbut\b|\?/.test(t) || t.split(" ").length > 5) return "reply";
  // "yep, go ahead": a yes word in front of a yes
  const rest = t.replace(/^(yes|yeah|yep|yup|ok|okay|sure) /, "");
  return YES.has(t) || YES.has(rest) ? "yes" : NO.has(t) ? "no" : "reply";
}
