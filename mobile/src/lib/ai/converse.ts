// One question to Tim or Frank, start to finish. The conversation goes to the accountant function, which asks Claude; Claude
// either answers or asks for tools, which run here and go back with their results, a few rounds at most. The answer's £ figures
// are then checked (lib/ai/check.ts): one that doesn't trace back gets one more look, and is flagged if it still doesn't.
// The conversation only ever grows: nothing sent is changed later, so Claude's earlier thinking stays valid. Pure: the
// server, the tools' view of your money and where notes go are passed in.
import type Anthropic from "@anthropic-ai/sdk";
import {checkNote, knownIn, unchecked} from "./check";
import {appContext, DOING, isTool, runTool, type ToolEffect, type ToolEnv, type ToolName} from "./tools";

type Message = Anthropic.Beta.Messages.BetaMessageParam;
type Block = Anthropic.Beta.Messages.BetaContentBlock;
type BlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** Everything said so far with one accountant, exactly as Claude saw it. */
export type Transcript = Message[];
/** What the function hands back: Claude's turn as it came. */
export interface Turn { content: Block[]; stop_reason: Anthropic.Beta.Messages.BetaStopReason | null }

export interface Deps {
  send(messages: Transcript): Promise<Turn>;
  /** The tools' view: your money and notes as they are right now. */
  env(): ToolEnv;
  /** A note to save or remove, from remember or forget. */
  apply(effect: ToolEffect): void;
  /** What he's doing, for the line where the answer will go. */
  doing?(what: string): void;
}

/** How a question ended when it didn't end in an answer: declined, cut off, or still looking things up after every round. */
export type Ended = "refused" | "cut-off" | "went-round";
export interface Answer {
  transcript: Transcript;
  text: string;
  used: ToolName[];        // the tools that answered, in order
  unchecked: string[];     // £ figures still not traced back after the second look
  ended?: Ended;
  /** His line to say out loud (his <say>, audio tags and all), only when every figure in it and the answer checked out. */
  spoken?: string;
}

/** Rounds of lookups for one question. The last one tells him to answer with what he has. */
export const MAX_ROUNDS = 6;
const LAST_ROUND = "<app_context>That was the last lookup for this question: answer now with what you have.</app_context>";

// his words, for a phone screen: he's asked for plain text, but a stray **bold** or # heading shouldn't show its marks
const plain = (blocks: Block[]) => blocks.flatMap(b => b.type === "text" ? [b.text] : []).join("\n\n")
  .replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();

// Tim and Frank end their answers with the line they say out loud, as <say>…</say>: it's taken out of what's shown, and so is any
// [audio tag] that strayed into the written answer (they're for his voice, never to read)
const SAY = /<say>([\s\S]*?)<\/say>/g;
const TAG = /[ \t]*\[[^\]\n]{1,40}\]/g;
export function spokenOf(text: string): {text: string; spoken?: string} {
  const said = [...text.matchAll(SAY)].pop()?.[1].replace(/\s+/g, " ").trim();
  const shown = text.replace(SAY, "").replace(TAG, "").replace(/^[ \t]+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return said ? {text: shown, spoken: said} : {text: shown};
}

const result = (call: ToolUse, content: unknown, error?: boolean): ToolResult =>
  ({type: "tool_result", tool_use_id: call.id, content: JSON.stringify(content), ...error ? {is_error: true} : {}});

export async function converse(transcript: Transcript, question: string, deps: Deps, now: Date): Promise<Answer> {
  // the date and time each time; your notes at the start of a conversation
  const msgs: Transcript = [...transcript, {role: "user", content: [
    {type: "text", text: appContext(now, transcript.length ? null : deps.env().notes)},
    {type: "text", text: question},
  ]}];
  const used: ToolName[] = [];
  const done = (text: string, ended?: Ended, bad: string[] = []): Answer => ({transcript: msgs, text, used, unchecked: bad, ...ended ? {ended} : {}});
  let rounds = 0, looked = false;
  for (;;) {
    const turn = await deps.send(msgs);
    msgs.push({role: "assistant", content: turn.content as unknown as BlockParam[]});
    const calls = turn.content.filter((b): b is ToolUse => b.type === "tool_use");
    // stopped before the tools could run: each still gets an answer, so the conversation stays one Claude can carry on
    const stop = turn.stop_reason === "refusal" ? "refused" : turn.stop_reason === "max_tokens" ? "cut-off" : rounds >= MAX_ROUNDS && calls.length ? "went-round" : null;
    if (stop) {
      if (calls.length) msgs.push({role: "user", content: calls.map(call => result(call, {error: "Stopped before this ran."}, true))});
      return done(spokenOf(plain(turn.content)).text, stop);
    }
    if (calls.length) {
      rounds++;
      const first = calls.find(call => isTool(call.name));
      if (first) deps.doing?.(DOING[first.name as ToolName]);
      const env = deps.env();
      const results: BlockParam[] = calls.map(call => {
        const out = runTool(call.name, call.input, env);
        if (out.effect) deps.apply(out.effect);
        if (!out.error && isTool(call.name)) used.push(call.name);
        return result(call, out.result, out.error);
      });
      msgs.push({role: "user", content: rounds === MAX_ROUNDS ? [...results, {type: "text", text: LAST_ROUND}] : results});
      continue;
    }
    // only the written answer gets a second look; a figure in what he'd say out loud that doesn't trace back and he just
    // doesn't say it, so his voice never costs a round
    const {text, spoken} = spokenOf(plain(turn.content)), known = knownIn(msgs), bad = unchecked(text, known);
    if (bad.length && !looked) {
      looked = true;
      msgs.push({role: "user", content: [{type: "text", text: checkNote(bad)}]});
      continue;
    }
    const sayIt = spoken && !bad.length && !unchecked(spoken, known).length;
    return {...done(text, undefined, bad), ...sayIt ? {spoken} : {}};
  }
}
