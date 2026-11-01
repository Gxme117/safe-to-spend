// How long each stage of a question takes, from the moment you press Send: one line for the dev log (never shown, never
// sent), so the slow part of an answer is a number, not a feeling.
import type {Turn} from "./converse";

export interface Stopwatch { mark(label: string): void; line(): string }

/** Marks each stage as it happens, in seconds since it was started. */
export function stopwatch(now: () => number = Date.now): Stopwatch {
  const start = now(), marks: string[] = [];
  return {
    mark: label => { marks.push(`${label} ${((now() - start) / 1000).toFixed(1)}s`); },
    line: () => marks.join(" · "),
  };
}

/** What a round of a question was, for the log: the lookups it asked for, or that it was his answer. */
export function roundOf(n: number, turn: Turn): string {
  const tools = turn.content.flatMap(b => b.type === "tool_use" || b.type === "server_tool_use" ? [b.name] : []);
  return `round ${n} (${tools.length ? tools.join(", ") : "answer"})`;
}
