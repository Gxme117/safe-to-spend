// One question to Tim or Frank, start to finish. The conversation goes to the accountant function, which asks Claude; Claude
// either answers or asks for tools, which run here and go back with their results, a few rounds at most. A web search, or a shop's
// page opened for a purchase, runs on Claude's side and comes back in his turn (lib/ai/web.ts). A price from the web only reaches
// your money through check_purchase, which reads it on the page (lib/ai/research.ts). The answer's £ figures
// are then checked (lib/ai/check.ts): one that doesn't trace back gets one more look, and is flagged if it still doesn't.
// The conversation only ever grows: nothing sent is changed later, so Claude's earlier thinking stays valid. Pure: the
// server, the tools' view of your money and where notes go are passed in.
import type Anthropic from "@anthropic-ai/sdk";
import {idOf, type Proposal} from "../billChange";
import {blocksOf, hasUnread, unreadIn, type Attachment} from "./attach";
import {mentionedOf} from "../briefing";
import {r2} from "../money";
import {checkNote, isKnown, knownIn, poundsIn, unchecked, unknownIn, webFigures, withoutWeb} from "./check";
import {appContext, DOING, isTool, runTool, type ToolEffect, type ToolEnv, type ToolName} from "./tools";
import {nextOf} from "./next";
import {CHECKING_IT, notSubscription, pagesIn, pickOf, PRICES_DOING, pricesLikely, totalOf, type Research} from "./research";
import {figuresOf, visualOf, type Visual} from "./visual";
import {answerBlocks, joinerOf, resultHosts, SEARCHING, searchedIn, searchWaiting, sourcesOf, type Source} from "./web";

type Message = Anthropic.Beta.Messages.BetaMessageParam;
type Block = Anthropic.Beta.Messages.BetaContentBlock;
type BlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** Everything said so far with one accountant, exactly as Claude saw it. */
export type Transcript = Message[];
/** What the function hands back: Claude's turn as it came, and what it cost in tokens. */
export interface Turn { content: Block[]; stop_reason: Anthropic.Beta.Messages.BetaStopReason | null; usage?: Anthropic.Beta.Messages.BetaUsage }

export interface Deps {
  send(messages: Transcript): Promise<Turn>;
  /** The tools' view: your money and notes as they are right now. */
  env(): ToolEnv;
  /** A note to save or remove, from remember or forget. (A change to your bills never comes here: it's a card on the answer.) */
  apply(effect: ToolEffect): void;
  /** What he's doing, for the line where the answer will go. */
  doing?(what: string): void;
  /** The sites his searches brought back so far, once each, as they come. */
  looked?(hosts: string[]): void;
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
  /** Something to buy he looked up, as a card (lib/ai/research.ts): only the offers a shop's own page backs. Only on an answer. */
  research?: Research;
  /** He looked up something to buy, and no shop's own page backed a price to go by: any price in his words is an estimate. */
  estimate?: true;
  /** Figures in `unchecked` with a photo or PDF in the conversation: most likely read off it, so they're said to be (lib/ai/attach.ts). */
  readFrom?: "photo" | "file";
}
/** `whole`: a briefing, said in full. What's shown is what he says, audio tags taken out; he marks the facts he mentioned.
 *  `attach`: photos and files you added to this question (lib/ai/attach.ts), before your words. */
export interface Options { whole?: boolean; attach?: Attachment[] }

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
// the lookups that try something against your money, once he's found what it costs
const TRYING: ToolName[] = ["check_purchase", "what_if", "overview", "upcoming", "forecast"];
// A price from the web only reaches your money through check_purchase. No £ in what he's told: a tool's £ counts as known
const NOT_BACKED = {error: "That price isn't one check_purchase confirmed on a shop's own page, nor a figure the app knows. Prices from the web go through check_purchase, once you've opened the shops' pages. If no page confirms it, it's an estimate: say so, with no yes or no on it, and don't try it again."};
const SUM_NOT_BACKED = {error: "A number in that sum isn't from your tools, their words or a price check_purchase confirmed. Prices from the web go through check_purchase. A price no page confirmed is an estimate: don't work out what it would do to their money, and don't try this sum again."};
const RUN_IT = "<app_check>You looked up what it costs but didn't run check_purchase, so the price hasn't been checked. Run it now with every shop's page you opened that shows the product and a price (a shop's own listing or category page counts), opening them with web_fetch first if you haven't; or say plainly you couldn't confirm a price, with no yes or no. Then give your whole answer again.</app_check>";
// check_purchase first, so what_if can try what it backed in the same round, and what_if before a sum, whose refusal the sum goes by
const rank = (name: string) => name === "check_purchase" ? 0 : name === "what_if" ? 1 : 2;

// his words, for a phone screen: he's asked for plain text, but a stray **bold** or # heading shouldn't show its marks.
// A citation splits a sentence into several text blocks, spaces and all, so those go back together as they came
const plain = (blocks: Block[], words: (b: Anthropic.Beta.Messages.BetaTextBlock) => string = b => b.text) => {
  const texts = answerBlocks(blocks);
  return texts.map(words).join(joinerOf(texts)).replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();
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
  // photos and files you added go before your words; a photo with no words has none (an empty one is refused)
  const attach = opts.attach ?? [];
  const msgs: Transcript = [...transcript, {role: "user", content: [
    {type: "text", text: appContext(now, transcript.length ? null : deps.env().notes, context)},
    ...blocksOf(attach),
    ...question.trim() ? [{type: "text" as const, text: question}] : [],
  ]}];
  // something in the conversation only he could read (a photo, a PDF): a figure from it can't be checked here
  const unread = unreadIn(msgs);
  const used: ToolName[] = [], cards = new Map<string, Proposal>(), hosts: string[] = [];
  let searched = false, attempted = false, refused = false, research: Research | null = null;
  const done = (text: string, ended?: Ended, bad: string[] = []): Answer => ({transcript: msgs, text, used, unchecked: bad, ...ended ? {ended} : {}, ...searched ? {searched: true as const} : {}});
  let rounds = 0, looked = false, pauses = 0, before: number | null = null, checked = 0;
  // a question for the shops: that's what the line says while he searches (no word comes back until he's done)
  const shopping = !opts.whole && pricesLikely(question);
  if (shopping) deps.doing?.(PRICES_DOING);
  const checkedBefore = transcript.some(m => m.role === "assistant" && Array.isArray(m.content) && m.content.some(b => b.type === "tool_use" && b.name === "check_purchase"));
  // whether a price has to come through check_purchase: for a purchase, or carrying one on ("And an Xbox?"), never a briefing or a subscription
  const buying = () => !opts.whole && (shopping || attempted || refused || (searched && checkedBefore && notSubscription(question)));
  const gated = () => !opts.whole && (shopping || searched || checkedBefore);
  // the figures that can reach the engine or a sum: what's known, and what a page has backed this round
  const trusted = () => [...knownIn(msgs), ...(research?.offers ?? []).flatMap(o => [o.price, totalOf(o)])];
  for (;;) {
    const turn = await deps.send(msgs);
    before ??= msgs.length;
    msgs.push({role: "assistant", content: turn.content as unknown as BlockParam[]});
    searched ||= searchedIn(turn.content);
    const fresh = resultHosts(turn.content).filter(h => !hosts.includes(h));
    if (fresh.length) { hosts.push(...fresh); deps.looked?.([...hosts]); }
    // a long search paused: his turn goes back as it came, and carries on. Paused too often and those turns all go, so the
    // conversation stays one Claude can carry on
    if (turn.stop_reason === "pause_turn") {
      if (++pauses <= MAX_PAUSES) { deps.doing?.(SEARCHING); continue; }
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
      if (first) deps.doing?.(searched && TRYING.includes(first.name as ToolName) ? CHECKING_IT : DOING[first.name as ToolName]);
      const env: ToolEnv = {now, ...deps.env(), ...calls.some(call => call.name === "check_purchase") ? {pages: pagesIn(msgs, transcript.length), checked} : {}};
      const run = (call: ToolUse): BlockParam => {
        const input = (call.input ?? {}) as {amount?: unknown; expression?: unknown};
        // a price nothing has backed never reaches the engine, nor a sum about your money
        if (call.name === "what_if" && gated() && typeof input.amount === "number" && !isKnown(r2(input.amount), trusted())) {
          refused = true;
          return result(call, NOT_BACKED, true);
        }
        if (call.name === "calculate" && buying() && typeof input.expression === "string" && unknownIn(input.expression, trusted()).length) return result(call, SUM_NOT_BACKED, true);
        const out = runTool(call.name, call.input, env);
        if (out.effect && "propose" in out.effect) {
          const p = out.effect.propose, key = target(p);
          if (!cards.has(key) && cards.size >= MAX_CARDS) return result(call, TOO_MANY, true);
          cards.delete(key);
          cards.set(key, p);
        } else if (out.effect) deps.apply(out.effect);
        if (!out.error && isTool(call.name)) used.push(call.name);
        if (call.name === "check_purchase" && !out.error && !out.waiting) { attempted = true; checked++; }
        // the card he's backed: a later try that does worse doesn't take it away
        if (out.research && (pickOf(out.research) || !pickOf(research))) research = out.research;
        if (out.ran) used.push("what_if");
        return result(call, out.result, out.error);
      };
      const ran = new Map([...calls].sort((a, b) => rank(a.name) - rank(b.name)).map(call => [call.id, run(call)]));
      const results = calls.map(call => ran.get(call.id)!);
      // with a search waiting, only the results may go: it runs on this next request, and the note would end his turn before it could
      msgs.push({role: "user", content: rounds === MAX_ROUNDS && !waiting ? [...results, {type: "text", text: LAST_ROUND}] : results});
      if (waiting) deps.doing?.(SEARCHING);
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
    // back as ever, a price check_purchase backed being a tool's figure like any other. A briefing has only the app's facts to go on
    const rest = marks ? text : visualOf(nextOf(spokenOf(plain(turn.content, withoutWeb)).text).text).text;
    const bad = unchecked(visual ? `${rest}\n${figuresOf(visual)}` : rest, known);
    // looked up what something costs, never had it checked and gives figures anyway: one more look, for that too
    const unasked = buying() && searched && !attempted && poundsIn(text).length > 0;
    // a photo or PDF with this question: a figure he read off it can't trace back here, so another look would only cost a round
    const recheck = bad.length > 0 && !hasUnread(attach);
    if ((recheck || unasked) && !looked) {
      looked = true;
      msgs.push({role: "user", content: [...recheck ? [{type: "text" as const, text: checkNote(bad)}] : [], ...unasked ? [{type: "text" as const, text: RUN_IT}] : []]});
      continue;
    }
    // what he says out loud repeats his answer, so a price it cited can be said too
    const web = marks ? [] : answerBlocks(turn.content).flatMap(webFigures), sources = sourcesOf(turn.content);
    const sayIt = said.spoken && !bad.length && !unchecked(said.spoken, known, web).length;
    // the card takes the picture's place: one thing leads an answer. No price backed: what he says is only an estimate, and it says so
    const estimate = buying() && searched && !pickOf(research) && (attempted || poundsIn(text).length > 0);
    return {...done(text, undefined, bad), ...sayIt ? {spoken: said.spoken} : {}, ...visual && !bad.length && !research ? {visual} : {}, ...next ? {next} : {},
      ...cards.size ? {proposals: [...cards.values()]} : {}, ...marks ? {mentioned: marks.mentioned} : {}, ...sources.length ? {sources} : {},
      ...research ? {research} : {}, ...estimate ? {estimate: true as const} : {}, ...bad.length && unread ? {readFrom: unread} : {}};
  }
}
