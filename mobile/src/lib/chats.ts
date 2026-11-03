import type {Who} from "@/lib/ai/tools";

/** Tim and Frank's recent chats, as in the ChatGPT app's side panel: kept on the phone for 30 days from when each was last used,
 *  listed newest first under Today, Yesterday, Previous 7 days and Previous 30 days, each named after your first question. */

export const KEEP_DAYS = 30;
const DAY = 86_400_000;

/** A chat as the list has it (what's said and the transcript are only read when it's opened). */
export type ChatRow = {id: string; who: Who; title: string; created: number; updated: number; body: string};
/** A whole chat: `said` is what's on screen, `transcript` what Claude saw, so you can carry on where you left off. */
export type Chat<S = unknown, T = unknown> = ChatRow & {said: S[]; transcript: T};

/** The least of what's on screen these rules need to know about. */
type Saidish = {id: number; mine: boolean; text: string; voiced?: unknown; cards?: {status: string}[]};

/** The chat's name: your first question, on one line, cut at a word if it's long. */
export function titleOf(question: string, max = 80): string {
  const t = question.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1), sp = cut.lastIndexOf(" ");
  return (sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, "") + "…";
}

/** The words of a chat, yours and his, for search. */
export const bodyOf = (said: Saidish[]) => said.map(s => s.text).join("\n");

/** When a chat last used before `before` is dropped. */
export const cutoff = (now: number) => now - KEEP_DAYS * DAY;

/** What's kept of what's on screen. His voice isn't (its recording is only in the phone's cache), and a card still waiting
 *  for your answer is closed as "Not answered", so an old proposal can never be tapped through. */
export function toSaved<S extends Saidish>(said: S[]): S[] {
  return said.map(({voiced: _voiced, ...s}) => ({
    ...s, ...(s.cards ? {cards: s.cards.map(k => k.status === "open" || k.status === "saving" ? {...k, status: "unanswered"} : k)} : {}),
  }) as S);
}

/** A kept chat back on screen, with new ids from `next` so they never clash with what's said from now on. */
export const fromSaved = <S extends Saidish>(said: S[], next: () => number): S[] => toSaved(said).map(s => ({...s, id: next()}));

const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
// local days between two times, by the calendar, so a chat at 23:59 yesterday is Yesterday at 00:01
const daysAgo = (t: number, now: number) => Math.round((midnight(now) - midnight(t)) / DAY);

export type ChatGroup = {label: "Today" | "Yesterday" | "Previous 7 days" | "Previous 30 days"; rows: ChatRow[]};

/** The list in ChatGPT's groups, newest first; anything past the 30 days is left out. */
export function groupsOf(rows: ChatRow[], now: number): ChatGroup[] {
  const groups: ChatGroup[] = [
    {label: "Today", rows: []}, {label: "Yesterday", rows: []}, {label: "Previous 7 days", rows: []}, {label: "Previous 30 days", rows: []},
  ];
  for (const r of [...rows].sort((a, b) => b.updated - a.updated)) {
    if (r.updated < cutoff(now)) continue;
    const d = daysAgo(r.updated, now);
    groups[d <= 0 ? 0 : d === 1 ? 1 : d <= 7 ? 2 : 3].rows.push(r);
  }
  return groups.filter(g => g.rows.length);
}

/** Whether a chat has what you're searching for, in its name or anything said in it. */
export function matches(row: ChatRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || row.title.toLowerCase().includes(q) || row.body.toLowerCase().includes(q);
}
