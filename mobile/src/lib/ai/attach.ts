// What you add to a question with the "+" card: a photo (camera or library), a PDF, or a text file (CSV, TXT). All pure: the
// pickers in services/attach.ts turn what you chose into an Attachment, and this turns it into what Claude reads.
// A text file the phone has read, so its figures count as your words (lib/ai/check.ts). A photo or a PDF only Claude can
// read, so a figure that traces back only to one is said to be read from it, never checked against your numbers.
import type Anthropic from "@anthropic-ai/sdk";

type Message = Anthropic.Beta.Messages.BetaMessageParam;
type Block = Anthropic.Beta.Messages.BetaContentBlockParam;

export type AttachKind = "image" | "pdf" | "text";
/** `data`: base64 for a photo or PDF, the words for a text file. `thumb`: a small data URI of a photo, for the bubble. */
export interface Attachment { kind: AttachKind; name: string; data: string; thumb?: string }
/** What's kept on your bubble: enough to show it, not the thing itself (that rides in the transcript). */
export type Shown = Pick<Attachment, "kind" | "name" | "thumb">;

export const MAX_ATTACH = 4;
// base64 characters (about 4/3 of the file): a PDF of up to about 5 MB; a text file of 200 KB; all of a question's together
// under 8 MB, so a conversation stays inside what the accountant function takes (its MAX_BYTES, 12 MB)
export const MAX_PDF = 6_700_000, MAX_TEXT = 200_000, MAX_TOTAL = 8_000_000;

/** Why this one can't go with the rest, in a sentence; null when it can. */
export function tooMuch(have: readonly Attachment[], add: Attachment): string | null {
  if (have.length >= MAX_ATTACH) return `Up to ${MAX_ATTACH} at a time.`;
  if (add.kind === "pdf" && add.data.length > MAX_PDF) return `${add.name} is too big. PDFs up to 5 MB.`;
  if (add.kind === "text" && add.data.length > MAX_TEXT) return `${add.name} is too big. Text files up to 200 KB.`;
  if (have.reduce((n, a) => n + a.data.length, add.data.length) > MAX_TOTAL) return "That's more than fits in one question.";
  return null;
}

/** What Claude reads: each one before your words, as the API advises. */
export function blocksOf(attachments: readonly Attachment[]): Block[] {
  return attachments.map(a =>
    a.kind === "image" ? {type: "image", source: {type: "base64", media_type: "image/jpeg", data: a.data}}
    : a.kind === "pdf" ? {type: "document", source: {type: "base64", media_type: "application/pdf", data: a.data}, title: a.name}
    : {type: "document", source: {type: "text", media_type: "text/plain", data: a.data}, title: a.name});
}

export const shownOf = (attachments: readonly Attachment[]): Shown[] =>
  attachments.map(({kind, name, thumb}) => ({kind, name, ...thumb ? {thumb} : {}}));

const unread = (b: Block) => b.type === "image" || (b.type === "document" && b.source.type === "base64");

/** What in the conversation only Claude could read: "photo" if any is a photo, else "file" for a PDF, null for none. */
export function unreadIn(messages: readonly Message[]): "photo" | "file" | null {
  let found: "photo" | "file" | null = null;
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "image") return "photo";
      if (unread(b)) found = "file";
    }
  }
  return found;
}

/** Whether these blocks have one only Claude can read. */
export const hasUnread = (attachments: readonly Attachment[]) => attachments.some(a => a.kind !== "text");

/** The line under an answer whose figures trace back only to a photo or a PDF. */
export const readFrom = (figures: readonly string[], what: "photo" | "file") =>
  `Read from your ${what}, not checked against your numbers: ${figures.join(", ")}.`;
