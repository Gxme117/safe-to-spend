import {calc, hero} from "../../calc";
import {ctx} from "../../__tests__/fixtures";
import {converse, MAX_ROUNDS, type Deps, type Transcript, type Turn} from "../converse";
import type {Note, ToolEffect} from "../tools";

// Claude's side, scripted: each turn as the function would hand it back
const said = (text: string, stop: Turn["stop_reason"] = "end_turn"): Turn =>
  ({content: [{type: "thinking", thinking: "", signature: "sig"}, {type: "text", text}], stop_reason: stop} as unknown as Turn);
let ids = 0;
const asks = (...calls: [string, object][]): Turn =>
  ({content: [{type: "thinking", thinking: "", signature: "sig"}, ...calls.map(([name, input]) => ({type: "tool_use", id: `tu_${++ids}`, name, input}))], stop_reason: "tool_use"} as unknown as Turn);

const x = ctx(), perDay = (() => { const h = hero(x, calc(x)); if (h.kind !== "number") throw new Error("no number"); return h.perDay; })();
const tv: Note = {id: "n_tv", kind: "goal", text: "Saving for a TV", amount: 600, at: "2026-10-01", who: "tim"};
const NOW = new Date(2026, 9, 5, 14, 5);

function server(...turns: Turn[]) {
  const sent: Transcript[] = [], effects: ToolEffect[] = [], doing: string[] = [];
  const deps: Deps = {
    send: jest.fn(async (m: Transcript) => { sent.push(JSON.parse(JSON.stringify(m))); const t = turns.shift(); if (!t) throw new Error("no more turns"); return t; }),
    env: () => ({ctx: x, notes: [tv], who: "frank", newId: () => "n_new"}),
    apply: e => { effects.push(e); },
    doing: d => { doing.push(d); },
  };
  return {deps, sent, effects, doing};
}
// every request is the one before it with more on the end: nothing sent is ever changed
const growsOnly = (sent: Transcript[]) => sent.every((m, i) => i === 0 || JSON.stringify(m.slice(0, sent[i - 1].length)) === JSON.stringify(sent[i - 1]));

test("a question: he looks something up, the tool runs here, and he answers with the engine's figure", async () => {
  const s = server(asks(["overview", {}]), said(`You can spend £${perDay} today.`));
  const a = await converse([], "What can I spend today?", s.deps, NOW);
  expect(a).toMatchObject({text: `You can spend £${perDay} today.`, used: ["overview"], unchecked: []});
  expect(a.ended).toBeUndefined();
  expect(s.doing).toEqual(["Checking your numbers…"]);
  // the first message: the date, his notes (the start of a conversation), then the question
  const first = s.sent[0][0].content as {text: string}[];
  expect(first[0].text).toContain("Now: 2026-10-05");
  expect(first[0].text).toContain("[n_tv] Saving for a TV (£600)");
  expect(first[1].text).toBe("What can I spend today?");
  // the tool's answer went back as data, and his turns exactly as they came
  const results = s.sent[1][2].content as {type: string; tool_use_id: string; content: string}[];
  expect(results[0]).toMatchObject({type: "tool_result", tool_use_id: "tu_" + ids});
  expect(JSON.parse(results[0].content).today_amount.amount).toBe(perDay);
  expect(a.transcript).toHaveLength(4);
  expect(growsOnly([...s.sent, a.transcript])).toBe(true);
});

test("the next question carries on the same conversation: just the date, no notes again", async () => {
  const s = server(asks(["overview", {}]), said(`£${perDay}.`), said("Nothing's due before payday apart from rent."));
  const a = await converse([], "What can I spend?", s.deps, NOW);
  const b = await converse(a.transcript, "And bills?", s.deps, NOW);
  const q2 = b.transcript[a.transcript.length].content as {text: string}[];
  expect(q2[0].text).toBe("<app_context>\nNow: 2026-10-05 (Mon 5 October 2026), 14:05.\n</app_context>");
  expect(b.transcript.slice(0, a.transcript.length)).toEqual(a.transcript);
});

test("two tools in one round are answered together, in one message; one that goes wrong says so", async () => {
  const s = server(asks(["calculate", {expression: "600 / 0"}], ["calculate", {expression: "600 / 4"}]), said("That's £150 a week."));
  const a = await converse([], "How much a week for a £600 TV over 4 weeks?", s.deps, NOW);
  const results = s.sent[1][2].content as {is_error?: boolean; content: string}[];
  expect(results).toHaveLength(2);
  expect(results[0]).toMatchObject({is_error: true, content: JSON.stringify({error: "That divides by zero."})});
  expect(results[1].is_error).toBeUndefined();
  expect(a).toMatchObject({used: ["calculate"], unchecked: []});
});

test("a note he makes goes to the store", async () => {
  const s = server(asks(["remember", {kind: "goal", text: "Holiday in May", amount: 900, by: null}]), said("Noted."));
  await converse([], "I want to save £900 for a holiday in May", s.deps, NOW);
  expect(s.effects).toEqual([{add: expect.objectContaining({id: "n_new", text: "Holiday in May", amount: 900, who: "frank"})}]);
});

test("a figure that doesn't trace back gets one more look; checked out, it's shown as normal", async () => {
  const s = server(asks(["overview", {}]), said("You'll have £512.40 left."), asks(["calculate", {expression: "1000 - 487.6"}]), said("You'll have £512.40 left."));
  const a = await converse([], "What's left after rent?", s.deps, NOW);
  expect(a.unchecked).toEqual([]);
  const check = s.sent[2][4].content as {text: string}[];
  expect(check[0].text).toContain("<app_check>These figures in your last answer don't match any tool result or calculation: £512.40.");
  expect(growsOnly([...s.sent, a.transcript])).toBe(true);
});

test("still from nowhere after the second look: shown, but flagged", async () => {
  const s = server(said("About £999."), said("About £999."));
  const a = await converse([], "Roughly?", s.deps, NOW);
  expect(a).toMatchObject({text: "About £999.", unchecked: ["£999"]});
  expect(s.deps.send).toHaveBeenCalledTimes(2);
});

test("a figure the person gave, or one of his notes, counts as known", async () => {
  const s = server(said("A £150 pair of trainers, with £600 for the TV still to save."));
  const a = await converse([], "Can I spend 150 on trainers?", s.deps, NOW);
  expect(a.unchecked).toEqual([]);
});

test("still looking things up after every round: the last round says to answer, then it stops and every call still gets an answer", async () => {
  const turns = Array.from({length: MAX_ROUNDS + 1}, () => asks(["overview", {}]));
  const s = server(...turns);
  const a = await converse([], "Everything?", s.deps, NOW);
  expect(a.ended).toBe("went-round");
  expect(s.deps.send).toHaveBeenCalledTimes(MAX_ROUNDS + 1);
  const lastRound = s.sent[MAX_ROUNDS][s.sent[MAX_ROUNDS].length - 1].content as {type: string; text?: string}[];
  expect(lastRound[lastRound.length - 1].text).toContain("That was the last lookup");
  // the conversation ends on answers to his last calls, so it can carry on
  const end = a.transcript[a.transcript.length - 1];
  expect(end.role).toBe("user");
  expect((end.content as {is_error?: boolean}[])[0].is_error).toBe(true);
});

test("declined or cut off: said so, and the conversation stays one Claude can carry on", async () => {
  expect((await converse([], "Hmm", server(said("", "refusal")).deps, NOW)).ended).toBe("refused");
  const cut = await converse([], "Hmm", server({...asks(["overview", {}]), stop_reason: "max_tokens"}).deps, NOW);
  expect(cut.ended).toBe("cut-off");
  expect(cut.transcript[cut.transcript.length - 1].role).toBe("user");
});

test("Frank's line to say out loud comes out of what's shown, and only when its figures check out", async () => {
  const line = `[sighs] Fine... £${perDay} a day. [dryly] Don't spend it on fees.`;
  let s = server(asks(["overview", {}]), said(`You can spend £${perDay} today.\n\n<say>${line}</say>`));
  let a = await converse([], "What can I spend?", s.deps, NOW);
  expect(a).toMatchObject({text: `You can spend £${perDay} today.`, spoken: line, unchecked: []});
  // none, and nothing's said
  s = server(said("What's it for?"));
  expect((await converse([], "Can I buy something?", s.deps, NOW)).spoken).toBeUndefined();
  // a figure only in what he'd say that doesn't trace back: he doesn't say it, and it never costs another round
  s = server(asks(["overview", {}]), said(`£${perDay} today.\n<say>[sighs] £777, roughly.</say>`));
  a = await converse([], "What can I spend?", s.deps, NOW);
  expect(s.sent).toHaveLength(2);
  expect(a).toMatchObject({text: `£${perDay} today.`, unchecked: []});
  expect(a.spoken).toBeUndefined();
});

test("audio tags that stray into the written answer never show", async () => {
  const s = server(asks(["overview", {}]), said(`[sighs] Right. £${perDay} today. [dryly] Rent's out Friday.\n[grumbles] That's it.\n\n<say>[sighs] Fine.</say>`));
  const a = await converse([], "What can I spend?", s.deps, NOW);
  expect(a).toMatchObject({text: `Right. £${perDay} today. Rent's out Friday.\nThat's it.`, spoken: "[sighs] Fine."});
});

test("cut off or declined, nothing's said out loud and the tag never shows", async () => {
  const s = server(said("Not that one. <say>[flatly] No.</say>", "refusal"));
  const a = await converse([], "Help me with crypto", s.deps, NOW);
  expect(a).toMatchObject({text: "Not that one.", ended: "refused"});
  expect(a.spoken).toBeUndefined();
});

test("he's asked for plain text: a stray **bold** or heading loses its marks", async () => {
  const a = await converse([], "Hi", server(said("## Today\n**Yes**, go for it.")).deps, NOW);
  expect(a.text).toBe("Today\nYes, go for it.");
});

test("when the server can't be reached, the question fails and the conversation before it is untouched", async () => {
  const s = server();
  const before: Transcript = [];
  await expect(converse(before, "Hi", s.deps, NOW)).rejects.toThrow("no more turns");
  expect(before).toEqual([]);
});
