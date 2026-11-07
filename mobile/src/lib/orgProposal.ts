// Pure display/outcome functions for the organisation preview card in Tim and Frank's chat.
// No imports from DB, store, or React.
import type {OrgPreview, OrgReport} from "./organise";

export interface PendingOrg { runId: string; apply: () => Promise<{report: OrgReport} | null> }
export interface OrgProposal { preview: OrgPreview }

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
