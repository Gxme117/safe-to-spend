// One question to Tim or Frank, start to finish. The conversation goes to the accountant function, which asks Claude; Claude
// either answers or asks for tools, which run here and go back with their results, a few rounds at most. A web search runs on
// Claude's side and comes back in his turn (lib/ai/web.ts). Something to buy: find_products asks the function's /shop (deps.shop)
// before the round's tools run, and its products are numbered p1, p2… in the chat (lib/ai/research.ts). Their prices are what
// things cost out in the world: they count only to the penny, as prices, and reach your money only through show_products' pick,
// with how sure each is. The answer's £ figures are then checked (lib/ai/check.ts): one that doesn't trace back gets one more
// look, and is flagged if it still doesn't.
// The conversation only ever grows: nothing sent is changed later, so Claude's earlier thinking stays valid. Pure: the
// server, the tools' view of your money and where notes go are passed in.
import type Anthropic from "@anthropic-ai/sdk";
import {idOf, type Proposal} from "../billChange";
import type {CategoryProposal} from "../types";
import {blocksOf, hasUnread, unreadIn, type Attachment} from "./attach";
import {mentionedOf} from "../briefing";
import {r2} from "../money";
import {checkNote, isKnown, knownIn, poundsIn, unchecked, unknownIn, webFigures, withoutWeb} from "./check";
import {appContext, DOING, isTool, runTool, shopArgs, type ToolEffect, type ToolEnv, type ToolName} from "./tools";
import {nextOf} from "./next";
import {callsOf, catalogueIn, CHECKING_IT, defaultCard, nextIdIn, notSubscription, PRICES_DOING, pricesLikely, SHOPPING, titleOf, totalOf, type Product, type Research,
  type ShopArgs, type Shopped} from "./research";
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
  /** Looks round the shops for find_products (the accountant function's /shop). Without it, find_products says it can't. */
  shop?(args: ShopArgs): Promise<Shopped>;
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
  /** Category changes he proposed, each a card for you to say yes to (lib/categoryChange.ts). Only on an answer. */
  categoryProposals?: CategoryProposal[];
  /** A briefing (`whole`): the facts he says he mentioned (lib/briefing.ts), and whether he said there was nothing worth saying. */
  mentioned?: string[];
  nothing?: true;
  /** He searched the web for this one, whether or not he used what he found (lib/ai/web.ts). */
  searched?: true;
  /** The pages his answer cites. Only on an answer. */
  sources?: Source[];
  /** Something to buy he looked up, as a card (lib/ai/research.ts): the products find_products found, or the ones show_products
   *  chose, each price labelled with how sure it is. Only on an answer. */
  research?: Research;
  /** He talked about what something costs with no card to show for it: any price in his words is an estimate. */
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
const TRYING: ToolName[] = ["show_products", "what_if", "overview", "upcoming", "forecast"];
// A price from the shops only reaches your money through show_products' pick, with how sure it is. No £ in what he's told: a
// tool's £ counts as known
const NOT_BACKED = {error: "That figure isn't one the app knows: not from your tools, their words, or a product find_products found. Prices go through find_products, and reach their money only through show_products with pick. Don't try it again."};
const USE_SHOW = {error: "That's a price find_products found. Try it against their money with show_products, that product's id as pick, so its price is labelled with how sure it is."};
const SUM_NOT_BACKED = {error: "A number in that sum isn't from your tools, their words or a product find_products found. Prices from the web go through find_products. Don't try this sum again."};
const RUN_IT = "<app_check>You talked about what something costs but didn't use find_products, so the prices haven't been looked up properly. Call find_products now; or say plainly you couldn't find a price, with no yes or no on one. Then give your whole answer again.</app_check>";
const SHOP_WAIT = {error: "Wait for find_products' results before show_products: you can't know the ids yet. Call it after, if the card needs changing or you want to try one."};
const ENOUGH_LOOKING = {error: "You've looked round the shops twice for this question: go with what you found."};
/** find_products a question, at most. */
export const MAX_FINDS = 2;
type Found = {products: Product[]; title: string; partial?: string};
// show_products first, so what_if can try its pick in the same round, and what_if before a sum, whose refusal the sum goes by
const rank = (name: string) => name === "show_products" ? 0 : name === "what_if" ? 1 : 2;

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
  const used: ToolName[] = [], cards = new Map<string, Proposal>(), catCards: CategoryProposal[] = [], hosts: string[] = [];
  let searched = false, attempted = false, refused = false, research: Research | null = null;
  // this question's last find_products: its card, unless show_products makes another
  let found: Found | null = null;
  const done = (text: string, ended?: Ended, bad: string[] = []): Answer => ({transcript: msgs, text, used, unchecked: bad, ...ended ? {ended} : {}, ...searched ? {searched: true as const} : {}});
  let rounds = 0, looked = false, pauses = 0, before: number | null = null, finds = 0;
  // a question for the shops: that's what the line says while he looks (no word comes back until he's done)
  const shopping = !opts.whole && pricesLikely(question);
  if (shopping) deps.doing?.(PRICES_DOING);
  const shoppedBefore = callsOf(transcript, "find_products").size > 0 || callsOf(transcript, "check_purchase").size > 0;
  // whether a price has to come from the shops' tools: for a purchase, or carrying one on ("And an Xbox?"), never a briefing or a subscription
  const buying = () => !opts.whole && (shopping || attempted || refused || ((searched || shoppedBefore) && notSubscription(question)));
  const gated = () => !opts.whole && (shopping || searched || attempted || shoppedBefore);
  // figures about your money: everything known but find_products' prices; those count only as prices, to the penny
  const known = () => knownIn(msgs, callsOf(msgs, "find_products"));
  const prices = () => [...catalogueIn(msgs).values()].flatMap(p => [...p.price === null ? [] : [p.price, totalOf(p)], ...typeof p.delivery === "number" ? [p.delivery] : []]);
  const exactly = (x: number, xs: number[]) => xs.some(p => Math.abs(p - x) < 0.005);
  // the pick's price and total this round, before its result is in the conversation (what_if after show_products, in one round)
  let picked: number[] = [];
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
      picked = [];
      const first = calls.find(call => isTool(call.name));
      // find_products first: /shop is asked for each, in turn, before anything else in the round runs. Its products are numbered
      // on from the conversation's, across every call in the round. A failure there is his to say, never a crash
      const finding = calls.filter(call => call.name === "find_products");
      const shopped = new Map<string, Pick<ToolEnv, "shopped" | "firstId"> | {refused: object}>();
      if (finding.length) {
        deps.doing?.(SHOPPING);
        let next = nextIdIn(catalogueIn(msgs));
        for (const call of finding) {
          if (finds >= MAX_FINDS) { shopped.set(call.id, {refused: ENOUGH_LOOKING}); continue; }
          finds++;
          let args: ShopArgs;
          // arguments that make no sense: the tool says what's wrong, nothing is looked up
          try { args = shopArgs(call.input); } catch { shopped.set(call.id, {}); continue; }
          const got: Shopped | {error: string} = deps.shop
            ? await deps.shop(args).catch((e: unknown) => ({error: e instanceof Error ? e.message : "failed"}))
            : {error: "can't look round the shops from here"};
          shopped.set(call.id, {shopped: got, firstId: next});
          if ("error" in got) continue;
          next += got.products.length;
          const fresh = [...new Set(got.products.map(p => p.host))].filter(h => h && !hosts.includes(h));
          if (fresh.length) { hosts.push(...fresh); deps.looked?.([...hosts]); }
        }
      }
      if (first && !finding.length) deps.doing?.((searched || attempted) && TRYING.includes(first.name as ToolName) ? CHECKING_IT : DOING[first.name as ToolName]);
      const env: ToolEnv = {now, ...deps.env(), catalogue: catalogueIn(msgs)};
      const run = (call: ToolUse): BlockParam => {
        const input = (call.input ?? {}) as {amount?: unknown; expression?: unknown};
        // show_products needs find_products' ids, which come with its results
        if (call.name === "show_products" && finding.length) return result(call, SHOP_WAIT, true);
        // a figure from nowhere never reaches the engine; a shop's price only through show_products, with its label
        if (call.name === "what_if" && gated() && typeof input.amount === "number" && !isKnown(r2(input.amount), [...known(), ...picked])) {
          refused = true;
          return result(call, exactly(r2(input.amount), prices()) ? USE_SHOW : NOT_BACKED, true);
        }
        // a sum may use shops' prices (the difference between two), never a figure from nowhere
        if (call.name === "calculate" && buying() && typeof input.expression === "string" && unknownIn(input.expression, [...known(), ...prices(), ...picked]).length) return result(call, SUM_NOT_BACKED, true);
        const s = shopped.get(call.id);
        if (s && "refused" in s) return result(call, s.refused, true);
        const out = runTool(call.name, call.input, s ? {...env, ...s} : env);
        if (out.effect && "propose" in out.effect) {
          const p = out.effect.propose, key = target(p);
          if (!cards.has(key) && (cards.size + catCards.length) >= MAX_CARDS) return result(call, TOO_MANY, true);
          cards.delete(key);
          cards.set(key, p);
        } else if (out.effect && "proposeCategory" in out.effect) {
          if ((cards.size + catCards.length) >= MAX_CARDS) return result(call, TOO_MANY, true);
          catCards.push(out.effect.proposeCategory);
        } else if (out.effect) deps.apply(out.effect);
        if (!out.error && isTool(call.name)) used.push(call.name);
        if (call.name === "find_products" && !out.error && out.products) {
          attempted = true;
          const got = s && "shopped" in s && s.shopped && !("error" in s.shopped) ? s.shopped : null;
          found = {products: out.products, title: titleOf(shopArgs(call.input)), ...got?.partial ? {partial: got.partial} : {}};
        }
        // the latest card he made is the one shown
        if (out.research) research = out.research;
        if (out.ran && out.research?.pick) {
          used.push("what_if");
          const p = out.research.products.find(x => x.id === out.research!.pick)!;
          picked = [p.price!, totalOf(p)];
        }
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
    const said = marks ? wholeOf(marks.text) : spokenOf(plain(turn.content)), {text: asked, next} = nextOf(said.text), {text, visual} = visualOf(asked);
    // a price he cites answers for itself, in the words that cite it; a shop's price find_products found, to the penny; everything
    // else, a picture's figures included, has to trace back as ever. A briefing has only the app's facts to go on
    const knownNow = known(), exact = prices();
    const rest = marks ? text : visualOf(nextOf(spokenOf(plain(turn.content, withoutWeb)).text).text).text;
    const bad = unchecked(visual ? `${rest}\n${figuresOf(visual)}` : rest, knownNow, exact);
    // talked about what something costs from the web without looking round the shops: one more look, for that too
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
    const sayIt = said.spoken && !bad.length && !unchecked(said.spoken, knownNow, [...web, ...exact]).length;
    // the card: the one show_products made, else what this question's find_products found. It takes the picture's place: one thing
    // leads an answer. Prices talked about with no card to show for them: what he says is only an estimate, and it says so
    const lastFound = found as Found | null, made = research as Research | null;
    const card = made ?? (lastFound?.products.length ? defaultCard(lastFound.products, lastFound.title, lastFound.partial) : null);
    const estimate = buying() && !card && (attempted || searched) && poundsIn(text).length > 0;
    return {...done(text, undefined, bad), ...sayIt ? {spoken: said.spoken} : {}, ...visual && !bad.length && !card ? {visual} : {}, ...next ? {next} : {},
      ...cards.size ? {proposals: [...cards.values()]} : {}, ...catCards.length ? {categoryProposals: catCards} : {}, ...marks ? {mentioned: marks.mentioned} : {}, ...sources.length ? {sources} : {},
      ...card ? {research: card} : {}, ...estimate ? {estimate: true as const} : {}, ...bad.length && unread ? {readFrom: unread} : {}};
  }
}
