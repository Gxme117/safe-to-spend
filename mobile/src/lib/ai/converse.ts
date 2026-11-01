// One question to Tim or Frank, start to finish. The conversation goes to the accountant function, which asks Claude; Claude
// either answers or asks for tools, which run here and go back with their results, a few rounds at most. A web search runs on
// Claude's side and comes back in his turn (lib/ai/web.ts). The answer's £ figures
// are then checked (lib/ai/check.ts): one that doesn't trace back gets one more look, and is flagged if it still doesn't.
// The conversation only ever grows: nothing sent is changed later, so Claude's earlier thinking stays valid. Pure: the
// server, the tools' view of your money and where notes go are passed in.
import type Anthropic from "@anthropic-ai/sdk";
import {idOf, type Proposal} from "../billChange";
import {mentionedOf} from "../briefing";
import {checkNote, knownIn, unchecked, webFigures, withoutWeb} from "./check";
import {appContext, DOING, isTool, runTool, type ToolEffect, type ToolEnv, type ToolName} from "./tools";
import {nextOf} from "./next";
import {figuresOf, visualOf, type Visual} from "./visual";
import {answerBlocks, searchedIn, searchWaiting, sourcesOf, type Source} from "./web";

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
  /** A note to save or remove, from remember or forget. (A change to your bills never comes here: it's a card on the answer.) */
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
  /** The picture he led with (lib/ai/visual.ts), only when every figure in it and the answer checked out. */
  visual?: Visual;
  /** What you might ask next (his <next>, lib/ai/next.ts), as chips under the answer. Only on an answer. */
  next?: string[];
  /** Changes to your bills he proposed, each a card for you to say yes to (lib/billChange.ts): the latest for each bill. Only on an answer. */
  proposals?: Proposal[];
  /** A briefing (`whole`): the facts he says he mentioned (lib/briefing.ts), and whether he said there was nothing worth saying. */
  mentioned?: string[];
  nothing?: true;
  /** He searched the web for this one, whether or not he used what he found (lib/ai/web.ts). */
  searched?: true;
  /** The pages his answer cites. Only on an answer. */
  sources?: Source[];
}
/** `whole`: a briefing, said in full. What's shown is what he says, audio tags taken out; he marks the facts he mentioned. */
export interface Options { whole?: boolean }

/** Cards on one answer, at most: a 4th is refused, so a change is never lost among many. */
export const MAX_CARDS = 3;
const TOO_MANY = {error: `That's ${MAX_CARDS} cards already in this answer: let them decide on those first.`};
// one card per bill: an add is "the same bill" by name
const target = (p: Proposal) => p.kind === "add" ? `add:${p.bill.name.toLowerCase()}` : idOf(p);

/** Rounds of lookups for one question. The last one tells him to answer with what he has. */
export const MAX_ROUNDS = 6;
const LAST_ROUND = "<app_context>That was the last lookup for this question: answer now with what you have.</app_context>";
/** Times one question's search can be paused and carried on (Claude's side pauses a long one) before he's stopped. */
export const MAX_PAUSES = 3;

// his words, for a phone screen: he's asked for plain text, but a stray **bold** or # heading shouldn't show its marks.
// A citation splits a sentence into several text blocks, spaces and all, so those go back together as they came
const plain = (blocks: Block[], words: (b: Anthropic.Beta.Messages.BetaTextBlock) => string = b => b.text) => {
  const texts = answerBlocks(blocks);
  return texts.map(words).join(texts.some(b => b.citations?.length) ? "" : "\n\n").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();
};

// Tim and Frank end their answers with the line they say out loud, as <say>…</say>: it's taken out of what's shown, and so is any
// [audio tag] that strayed into the written answer (they're for his voice, never to read)
const SAY = /<say>([\s\S]*?)<\/say>/g;
const TAG = /[ \t]*\[[^\]\n]{1,40}\]/g;
export function spokenOf(text: string): {text: string; spoken?: string} {
  const said = [...text.matchAll(SAY)].pop()?.[1].replace(/\s+/g, " ").trim();
  const shown = text.replace(SAY, "").replace(TAG, "").replace(/^[ \t]+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return said ? {text: shown, spoken: said} : {text: shown};
}

// A briefing is said whole: what's shown is the same words, its audio tags taken out, and what's said is them with the tags in
// (the picture's and <next>'s tags out of both)
function wholeOf(text: string): {text: string; spoken?: string} {
  const said = visualOf(nextOf(text).text).text.replace(SAY, "").replace(/\s+/g, " ").trim();
  return said ? {text: spokenOf(text).text, spoken: said} : {text: spokenOf(text).text};
}

const result = (call: ToolUse, content: unknown, error?: boolean): ToolResult =>
  ({type: "tool_result", tool_use_id: call.id, content: JSON.stringify(content), ...error ? {is_error: true} : {}});

export async function converse(transcript: Transcript, question: string, deps: Deps, now: Date, context: string[] = [], opts: Options = {}): Promise<Answer> {
  // the date and time each time; your notes at the start of a conversation; what you did with his cards since
  const msgs: Transcript = [...transcript, {role: "user", content: [
    {type: "text", text: appContext(now, transcript.length ? null : deps.env().notes, context)},
    {type: "text", text: question},
  ]}];
  const used: ToolName[] = [], cards = new Map<string, Proposal>();
  let searched = false;
  const done = (text: string, ended?: Ended, bad: string[] = []): Answer => ({transcript: msgs, text, used, unchecked: bad, ...ended ? {ended} : {}, ...searched ? {searched: true as const} : {}});
  let rounds = 0, looked = false, pauses = 0, before: number | null = null;
  for (;;) {
    const turn = await deps.send(msgs);
    before ??= msgs.length;
    msgs.push({role: "assistant", content: turn.content as unknown as BlockParam[]});
    searched ||= searchedIn(turn.content);
    // a long search paused: his turn goes back as it came, and carries on. Paused too often and those turns all go, so the
    // conversation stays one Claude can carry on
    if (turn.stop_reason === "pause_turn") {
      if (++pauses <= MAX_PAUSES) continue;
      msgs.length = before;
      return done("", "went-round");
    }
    before = null;
    const calls = turn.content.filter((b): b is ToolUse => b.type === "tool_use"), waiting = searchWaiting(turn.content);
    // stopped before the tools could run: each still gets an answer, so the conversation stays one Claude can carry on. A search
    // still waiting to run can't be left behind (the next question would be refused), so that turn goes instead
    const stop = turn.stop_reason === "refusal" ? "refused" : turn.stop_reason === "max_tokens" ? "cut-off" : rounds >= MAX_ROUNDS && calls.length ? "went-round" : null;
    if (stop) {
      if (waiting) msgs.pop();
      else if (calls.length) msgs.push({role: "user", content: calls.map(call => result(call, {error: "Stopped before this ran."}, true))});
      return done(visualOf(nextOf(spokenOf(plain(turn.content)).text).text).text, stop);
    }
    if (calls.length) {
      rounds++;
      const first = calls.find(call => isTool(call.name));
      if (first) deps.doing?.(DOING[first.name as ToolName]);
      const env = deps.env();
      const results: BlockParam[] = calls.map(call => {
        const out = runTool(call.name, call.input, env);
        if (out.effect && "propose" in out.effect) {
          const p = out.effect.propose, key = target(p);
          if (!cards.has(key) && cards.size >= MAX_CARDS) return result(call, TOO_MANY, true);
          cards.delete(key);
          cards.set(key, p);
        } else if (out.effect) deps.apply(out.effect);
        if (!out.error && isTool(call.name)) used.push(call.name);
        return result(call, out.result, out.error);
      });
      // with a search waiting, only the results may go: it runs on this next request, and the note would end his turn before it could
      msgs.push({role: "user", content: rounds === MAX_ROUNDS && !waiting ? [...results, {type: "text", text: LAST_ROUND}] : results});
      continue;
    }
    // only the written answer gets a second look; a figure in what he'd say out loud that doesn't trace back and he just
    // doesn't say it, so his voice never costs a round
    // the picture he leads with is checked with it, and only drawn when it all checks out: a picture lends a figure more weight
    // than a sentence
    const marks = opts.whole ? mentionedOf(plain(turn.content)) : null;
    if (marks?.nothing && !marks.text) return {...done(""), mentioned: [], nothing: true};
    const said = marks ? wholeOf(marks.text) : spokenOf(plain(turn.content)), {text: asked, next} = nextOf(said.text), {text, visual} = visualOf(asked), known = knownIn(msgs);
    // a price he cites answers for itself, in the words that cite it; everything else, a picture's figures included, has to trace
    // back as ever. A briefing has only the app's facts to go on
    const rest = marks ? text : visualOf(nextOf(spokenOf(plain(turn.content, withoutWeb)).text).text).text;
    const bad = unchecked(visual ? `${rest}\n${figuresOf(visual)}` : rest, known);
    if (bad.length && !looked) {
      looked = true;
      msgs.push({role: "user", content: [{type: "text", text: checkNote(bad)}]});
      continue;
    }
    // what he says out loud repeats his answer, so a price it cited can be said too
    const web = marks ? [] : answerBlocks(turn.content).flatMap(webFigures), sources = sourcesOf(turn.content);
    const sayIt = said.spoken && !bad.length && !unchecked(said.spoken, known, web).length;
    return {...done(text, undefined, bad), ...sayIt ? {spoken: said.spoken} : {}, ...visual && !bad.length ? {visual} : {}, ...next ? {next} : {},
      ...cards.size ? {proposals: [...cards.values()]} : {}, ...marks ? {mentioned: marks.mentioned} : {}, ...sources.length ? {sources} : {}};
  }
}
