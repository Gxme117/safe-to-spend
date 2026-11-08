// Pure display/outcome functions for the organisation preview card in Tim and Frank's chat.
// No imports from DB, store, or React.
import type {OrgExample, OrgPreview, OrgReport} from "./organise";

export interface OrgPreviewWithExamples extends OrgPreview {
  examples: OrgExample[];
}

/** A different category (and subcategory) chosen for one shop's payments in a run, by that shop's payee key. */
export type OrgEdits = Record<string, {cat: string; sub?: string}>;

export interface PendingOrg {
  runId: string;
  apply: (skippedKeys: Set<string>, edits?: OrgEdits) => Promise<{report: OrgReport} | null>;
}

export interface OrgProposal { preview: OrgPreviewWithExamples }

/** One-line summary for Frank's context after the card resolves. */
export function orgOutcomeLine(runId: string, result: "cancelled" | {report: OrgReport}): string {
  if (result === "cancelled") return `Organisation cancelled (run ${runId}).`;
  const {auto, provisional, left, more} = result.report;
  const done = auto + provisional;
  const parts: string[] = [`${done} payment${done === 1 ? "" : "s"} organised`];
  if (provisional > 0) parts.push(`${provisional} to review`);
  if (left > 0) parts.push(`${left} skipped`);
  if (more > 0) parts.push(`${more} more still waiting`);
  return `Organisation done (run ${runId}): ${parts.join(", ")}.`;
}

/** Plain-English note explaining the confidence levels, shown in the preview card. */
export function confidenceNote(): string {
  return "Automatic ones are filed straight away. The ones that need a check are filed too, but you'll see them flagged to review.";
}

/** Whether a pending org exists for this runId and hasn't been applied yet. */
export function isOrgPending(pending: PendingOrg | null, runId: string): boolean {
  return pending !== null && pending.runId === runId;
}

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** "Three things" / "One thing" / "12 things": the start of a sentence. */
function things(n: number): string {
  return `${n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n)} thing${n === 1 ? "" : "s"}`;
}

/**
 * The line under the organisation card, in the accountant's own voice.
 * `done`: the run's been saved (else it's a preview and nothing has been). `review`: how many need the person's say.
 * Never scolds, and never says anything was guessed at.
 */
export function orgSays(who: "tim" | "frank", s: {done: boolean; review: number}): string {
  const {done, review} = s;
  const verb = review === 1 ? "needs" : "need";
  if (who === "frank") {
    if (done) return review > 0
      ? `I sorted the obvious stuff. ${things(review)} ${verb} your attention. Don't worry, I didn't go making guesses.`
      : "All sorted. Nothing needs your attention.";
    return review > 0
      ? `I'll sort the obvious stuff. ${things(review)} ${verb} your say first. I won't go making guesses.`
      : "Nothing tricky in here. Say the word and I'll sort it.";
  }
  if (done) return review > 0
    ? `That's the clear ones sorted. ${things(review)} ${verb} a look from you.`
    : "All sorted. Nothing needs a look from you.";
  return review > 0
    ? `I'll sort the clear ones. ${things(review)} ${verb} a quick look from you first.`
    : "These are all clear. Say the word and I'll sort them.";
}
