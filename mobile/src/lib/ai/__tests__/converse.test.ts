import {calc, hero} from "../../calc";
import {ctx} from "../../__tests__/fixtures";
import {converse, MAX_PAUSES, MAX_ROUNDS, type Deps, type Transcript, type Turn} from "../converse";
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
    env: () => ({ctx: x, notes: [tv], who: "frank", newId: () => "n_new", regulars: {scan: null, answers: {}}}),
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
  expect(check[0].text).toContain("<app_check>These figures in your last answer don't match any tool result, calculation or citation: £512.40.");
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

describe("photos and files you add (lib/ai/attach.ts)", () => {
  const receipt = {kind: "image" as const, name: "IMG_1.jpg", data: "aGk=", thumb: "data:image/jpeg;base64,aGk="};

  test("they go before your words; a photo with no words has no words block", async () => {
    const s = server(said("That's a Tesco shop."));
    await converse([], "", s.deps, NOW, [], {attach: [receipt]});
    const first = s.sent[0][0].content as {type: string; source?: {type: string; media_type: string}}[];
    expect(first.map(b => b.type)).toEqual(["text", "image"]);
    expect(first[1].source).toEqual({type: "base64", media_type: "image/jpeg", data: "aGk="});
  });

  test("a figure read off a photo sent with this question isn't given a second look, and is said to be from it", async () => {
    const s = server(said("That receipt comes to £42.99."));
    const a = await converse([], "What did I spend here?", s.deps, NOW, [], {attach: [receipt]});
    expect(a).toMatchObject({text: "That receipt comes to £42.99.", unchecked: ["£42.99"], readFrom: "photo"});
    expect(s.deps.send).toHaveBeenCalledTimes(1);
  });

  test("a later question in the same chat gets the second look as ever, still labelled from the photo if it doesn't trace back", async () => {
    const s = server(said("£42.99 on that one."), said("Still £42.99."), said("Still £42.99."));
    const a = await converse([], "What did I spend here?", s.deps, NOW, [], {attach: [receipt]});
    const b = await converse(a.transcript, "And again?", s.deps, NOW);
    expect(b).toMatchObject({unchecked: ["£42.99"], readFrom: "photo"});
    expect(s.deps.send).toHaveBeenCalledTimes(3);
  });

  test("a CSV the phone read counts as your words", async () => {
    const s = server(said("Your biggest was £86.20."));
    const a = await converse([], "What was my biggest?", s.deps, NOW, [], {attach: [{kind: "text", name: "march.csv", data: "date,amount\n2026-03-02,86.20\n"}]});
    expect(a.unchecked).toEqual([]);
    expect(a.readFrom).toBeUndefined();
    const first = s.sent[0][0].content as {type: string; source?: {type: string}}[];
    expect(first[1]).toMatchObject({type: "document", source: {type: "text", media_type: "text/plain"}, title: "march.csv"});
  });
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

test("what you might ask next comes out of his words; cut off, the tag still never shows", async () => {
  let s = server(asks(["overview", {}]), said(`£${perDay} today.\n<next>What about tomorrow? | Is rent covered?</next>\n<say>[calmly] £${perDay} today.</say>`));
  let a = await converse([], "What can I spend?", s.deps, NOW);
  expect(a).toMatchObject({text: `£${perDay} today.`, next: ["What about tomorrow?", "Is rent covered?"], spoken: `[calmly] £${perDay} today.`});
  s = server(said("Not that one. <next>Why not?</next>", "refusal"));
  a = await converse([], "Help me with crypto", s.deps, NOW);
  expect(a).toMatchObject({text: "Not that one.", ended: "refused"});
  expect(a.next).toBeUndefined();
});

test("the picture he leads with comes out of the words, and is kept when its figures check out", async () => {
  const pic = `<figure label="Spent so far">£1,284</figure>\n<split>£650 rent | £634 everything else</split>`;
  const s = server(asks(["calculate", {expression: "650 + 634"}]), said(`${pic}\n\nThe rest is mostly food.`));
  const a = await converse([], "I paid 650 rent and 634 on the rest. Total?", s.deps, NOW);
  expect(a).toMatchObject({text: "The rest is mostly food.", unchecked: [],
    visual: {label: "Spent so far", amount: 1284, parts: [{amount: 650, name: "rent"}, {amount: 634, name: "everything else"}]}});
});

test("a picture's figure that doesn't trace back gets the second look; still from nowhere, the picture goes and it's flagged", async () => {
  const pic = `<figure label="Spent so far">£1,284</figure>`;
  let s = server(said(`${pic}\nMostly food.`), asks(["calculate", {expression: "650 + 634"}]), said(`${pic}\nMostly food.`));
  let a = await converse([], "Rent was 650, the rest 634. Where did it go?", s.deps, NOW);
  expect((s.sent[1][s.sent[1].length - 1].content as {text: string}[])[0].text).toContain("£1,284");
  expect(a.visual).toMatchObject({amount: 1284});
  s = server(said(`${pic}\nMostly food.`), said(`${pic}\nMostly food.`));
  a = await converse([], "Where did it go?", s.deps, NOW);
  expect(a).toMatchObject({text: "Mostly food.", unchecked: ["£1,284"]});
  expect(a.visual).toBeUndefined();
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

describe("changes to bills: only ever cards on the answer, never made by him", () => {
  const gym = {name: "Gym", amount: 30, how_often: "monthly", day_of_month: 3, next_date: null, varies: null, from_regular: null};

  test("a proposal rides on the answer and never reaches apply; he's told nothing is saved", async () => {
    const s = server(asks(["add_bill", gym]), said("Here's the card for your gym: check it and tap Add."));
    const a = await converse([], "Add my gym, £30 on the 3rd", s.deps, NOW);
    expect(a.proposals).toEqual([expect.objectContaining({kind: "add", bill: expect.objectContaining({name: "Gym", amount: 30, day: 3})})]);
    expect(s.effects).toEqual([]);
    const result = JSON.parse((s.sent[1][2].content as {content: string}[])[0].content);
    expect(result).toMatchObject({saved: false, card: expect.stringMatching(/^Add Gym: £30 every month; 3rd of every month\./)});
  });

  test("one card per bill (the latest wins), at most 3; none on an answer that ended early", async () => {
    const s = server(asks(["add_bill", gym], ["add_bill", {...gym, amount: 35}]), said("Check the card."));
    const a = await converse([], "Gym is £35 actually", s.deps, NOW);
    expect(a.proposals!.map(p => p.kind === "add" && p.bill.amount)).toEqual([35]);
    const four = server(asks(...["A", "B", "C", "D"].map(n => ["add_bill", {...gym, name: n}] as [string, object])), said("Check the cards."));
    const b = await converse([], "Add four bills", four.deps, NOW);
    expect(b.proposals).toHaveLength(3);
    expect(JSON.parse((four.sent[1][2].content as {content: string}[])[3].content).error).toMatch(/3 cards already/);
    const cut = server(asks(["add_bill", gym]), said("Here's", "max_tokens"));
    expect((await converse([], "Add my gym", cut.deps, NOW)).proposals).toBeUndefined();
  });

  test("what you did with his cards goes in front of your next message, and its £ figures count as known", async () => {
    const s = server(said("Good, your £30 gym is in."));
    const a = await converse([], "Thanks", s.deps, NOW, ["They tapped yes on your card: Add Gym (£30 every month). It's saved."]);
    expect((s.sent[0][0].content as {text: string}[])[0].text).toContain("They tapped yes on your card: Add Gym (£30 every month).");
    expect(a.unchecked).toEqual([]);
  });
});

describe("a search on the web: Claude's side runs it and it comes back in his turn", () => {
  const NETFLIX = "https://www.netflix.com/gb";
  const search = {type: "server_tool_use", id: "s1", name: "web_search", input: {query: "netflix uk price"}};
  const found = {type: "web_search_tool_result", tool_use_id: "s1", content: [{type: "web_search_result", url: NETFLIX, title: "Netflix", encrypted_content: "secret", page_age: "1 October 2026"}]};
  const words = (text: string) => ({type: "text", text});
  const cites = (text: string, cited_text = "Standard £12.99 a month") =>
    ({type: "text", text, citations: [{type: "web_search_result_location", url: NETFLIX, title: "Netflix", encrypted_index: "i", cited_text}]});
  const turn = (stop: Turn["stop_reason"], ...content: object[]) => ({content, stop_reason: stop} as unknown as Turn);

  test("a sentence split by its citation goes back together, what he said before looking doesn't show, and the page is kept", async () => {
    const s = server(turn("end_turn", words("I'll look that up."), search, found, words("Netflix lists Standard at "), cites("£12.99 a month"), words(", ads or not.")));
    const a = await converse([], "How much is Netflix now?", s.deps, NOW);
    expect(a).toMatchObject({text: "Netflix lists Standard at £12.99 a month, ads or not.", unchecked: [], searched: true,
      sources: [{title: "Netflix", url: NETFLIX, host: "netflix.com"}]});
    // one go: no second look for a price his citation quotes
    expect(s.sent).toHaveLength(1);
    // what came back goes back exactly as it came, or Claude's side refuses it
    expect(a.transcript[1].content).toEqual([words("I'll look that up."), search, found, words("Netflix lists Standard at "), cites("£12.99 a month"), words(", ads or not.")]);
  });

  test("an answer that didn't search says nothing about the web", async () => {
    const a = await converse([], "Hi", server(said("Morning.")).deps, NOW);
    expect(a.searched).toBeUndefined();
    expect(a.sources).toBeUndefined();
  });

  test("a price with no citation has to trace back like any other: a second look, then flagged", async () => {
    const answer = () => turn("end_turn", search, found, words("Netflix is £12.99 a month."));
    const s = server(answer(), answer());
    const a = await converse([], "How much is Netflix now?", s.deps, NOW);
    expect(s.sent).toHaveLength(2);
    expect(a).toMatchObject({unchecked: ["£12.99"], searched: true});
    expect(a.sources).toBeUndefined();
  });

  test("a price the citation doesn't quote, or one he rounded, isn't vouched for", async () => {
    const answer = (price: string) => () => turn("end_turn", search, found, cites(`Netflix is ${price} a month.`));
    for (const [price, bad] of [["£14.99", "£14.99"], ["£13", "£13"]]) {
      const make = answer(price), s = server(make(), make());
      expect((await converse([], "How much is Netflix now?", s.deps, NOW)).unchecked).toEqual([bad]);
    }
  });

  test("a price on a page can't vouch for a figure about your money, even in the same answer", async () => {
    const answer = () => turn("end_turn", search, found, cites("Netflix lists Standard at £12.99."), words(" You have £12.99 left today."));
    const s = server(answer(), answer());
    const a = await converse([], "Netflix?", s.deps, NOW);
    expect(a.unchecked).toEqual(["£12.99"]);
  });

  test("nor does what he found earlier count later on: it has to be cited again", async () => {
    const s = server(turn("end_turn", search, found, cites("Netflix is £12.99.")), said("So £12.99 left."), said("So £12.99 left."));
    const a = await converse([], "Netflix?", s.deps, NOW);
    const b = await converse(a.transcript, "And what's left?", s.deps, NOW);
    expect(b.unchecked).toEqual(["£12.99"]);
  });

  test("your own figure and a cited price sit side by side, and he can say out loud what he cited", async () => {
    const s = server(asks(["overview", {}]), turn("end_turn", search, found, cites("Netflix lists Standard at £12.99."), words(` You've £${perDay} today.\n<say>[flatly] £12.99 a month, and £${perDay} today.</say>`)));
    const a = await converse([], "Netflix?", s.deps, NOW);
    expect(a).toMatchObject({text: `Netflix lists Standard at £12.99. You've £${perDay} today.`, unchecked: [], spoken: `[flatly] £12.99 a month, and £${perDay} today.`});
  });

  test("no picture of a web price: a picture's figures have to trace back to your own", async () => {
    const answer = () => turn("end_turn", search, found, words('<figure label="Netflix">£12.99</figure>\n'), cites("Standard is £12.99."));
    const s = server(answer(), answer());
    const a = await converse([], "Netflix?", s.deps, NOW);
    expect(a.unchecked).toEqual(["£12.99"]);
    expect(a.visual).toBeUndefined();
    expect(a.spoken).toBeUndefined();
  });

  test("a paused search goes back as it came and carries on, without a word added", async () => {
    const paused = turn("pause_turn", words("Looking."), search);
    const s = server(paused, turn("end_turn", found, cites("Netflix is £12.99.")));
    const a = await converse([], "Netflix?", s.deps, NOW);
    expect(a).toMatchObject({text: "Netflix is £12.99.", unchecked: [], searched: true});
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1]).toHaveLength(2);
    expect(s.sent[1][1]).toEqual({role: "assistant", content: paused.content});
    expect(growsOnly([...s.sent, a.transcript])).toBe(true);
  });

  test("paused too often: he stops, nothing half-finished shows, and the next question can carry on", async () => {
    const turns = Array.from({length: MAX_PAUSES + 1}, () => turn("pause_turn", words("Still looking."), search));
    const s = server(...turns, said("Morning."));
    const a = await converse([], "Everything?", s.deps, NOW);
    expect(a).toMatchObject({ended: "went-round", text: ""});
    expect(s.deps.send).toHaveBeenCalledTimes(MAX_PAUSES + 1);
    expect(a.transcript[a.transcript.length - 1].role).toBe("user");
    expect((await converse(a.transcript, "Hi", s.deps, NOW)).text).toBe("Morning.");
  });

  test("a search and a phone tool asked for together: only the tool's result goes back, and the search runs next", async () => {
    const s = server(turn("tool_use", search, {type: "tool_use", id: "tu_x", name: "overview", input: {}}), turn("end_turn", found, cites("Netflix is £12.99."), words(` You've £${perDay} today.`)));
    const a = await converse([], "Netflix?", s.deps, NOW);
    expect(a).toMatchObject({text: `Netflix is £12.99. You've £${perDay} today.`, used: ["overview"], unchecked: [], searched: true});
    expect((s.sent[1][2].content as {type: string}[]).map(b => b.type)).toEqual(["tool_result"]);
  });

  test("on the last round with a search waiting, the note that it's the last doesn't go with the results: Claude's side would refuse it", async () => {
    const tools = Array.from({length: MAX_ROUNDS - 1}, () => asks(["overview", {}]));
    const s = server(...tools, turn("tool_use", search, {type: "tool_use", id: "tu_y", name: "overview", input: {}}), turn("end_turn", found, words("Done.")));
    await converse([], "Everything?", s.deps, NOW);
    const last = s.sent[MAX_ROUNDS][s.sent[MAX_ROUNDS].length - 1].content as {type: string}[];
    expect(last.map(b => b.type)).toEqual(["tool_result"]);
  });

  test("stopped with a search waiting: that turn goes, so the next question isn't refused", async () => {
    const s = server(turn("max_tokens", search, {type: "tool_use", id: "tu_z", name: "overview", input: {}}), said("Morning."));
    const a = await converse([], "Netflix?", s.deps, NOW);
    expect(a.ended).toBe("cut-off");
    expect(a.transcript[a.transcript.length - 1].role).toBe("user");
    expect(JSON.stringify(a.transcript)).not.toContain("srvtoolu");
    expect((await converse(a.transcript, "Hi", s.deps, NOW)).text).toBe("Morning.");
  });
});

describe("buying something: he finds its prices, tries one against your money and shows them as a card, all in one question", () => {
  const ARGOS = "https://www.argos.co.uk/product/iphone-17-256gb", APPLE = "https://www.apple.com/uk/shop/buy-iphone/iphone-17";
  const search = {type: "server_tool_use", id: "s9", name: "web_search", input: {query: "buy iphone 17 256gb uk"}};
  const found = {type: "web_search_tool_result", tool_use_id: "s9",
    content: [ARGOS, APPLE, "https://www.currys.co.uk/iphone-17"].map(url => ({type: "web_search_result", url, title: "iPhone 17", encrypted_content: "secret"}))};
  const words = (text: string) => ({type: "text", text});
  const turn = (stop: Turn["stop_reason"], ...content: object[]) => ({content, stop_reason: stop} as unknown as Turn);
  // a page he asks to open, and the page as it comes back
  const opens = (id: string, url: string) => ({type: "server_tool_use", id, name: "web_fetch", input: {url}});
  const page = (id: string, url: string, data: string) => ({type: "web_fetch_tool_result", tool_use_id: id,
    content: {type: "web_fetch_result", url, retrieved_at: "2026-10-05T13:00:00Z", content: {type: "document", title: "Buy iPhone 17", source: {type: "text", media_type: "text/plain", data}}}});
  const PAGES = [opens("f1", APPLE), page("f1", APPLE, "iPhone 17 256GB £899.00 Free delivery"), opens("f2", ARGOS), page("f2", ARGOS, "Apple iPhone 17 256GB £879.00")];
  const tool = (name: string, input: object) => ({type: "tool_use", id: `tu_b${++ids}`, name, input});
  const tries = (amount: number) => tool("what_if", {amount});
  const sums = (expression: string) => tool("calculate", {expression});
  const apple = {seller: "Apple", url: APPLE, price: 899, condition: "new", delivery: 0, pick: false}, argos = {seller: "Argos", url: ARGOS, price: 879, condition: "new", delivery: null, pick: true};
  const checks = (...offers: object[]) => tool("check_purchase", {product: "iPhone 17, 256GB", assumed: "The newest standard model", identifies: ["iPhone 17", "256GB"], offers});
  const watched = (s: ReturnType<typeof server>) => { const hosts: string[][] = []; s.deps.looked = h => { hosts.push(h); }; return hosts; };
  // the result one tool got: the nth in a request's last message
  const resultOf = (sent: Transcript, n = 0) => { const r = (sent[sent.length - 1].content as {content: string; is_error?: boolean}[])[n]; return {...r, body: JSON.parse(r.content)}; };
  const IPHONE = "Can I afford a new iPhone?";

  test("one question, two requests: he searches, opens the pages and checks them, and the engine runs on the price they back", async () => {
    const s = server(turn("tool_use", search, found, ...PAGES, checks(apple, argos)),
      said("At £879 it'd come out of what's held back, so not today.\n<say>[flatly] Apple wants £899.00. Argos, £879.00. Not today.</say>"));
    const hosts = watched(s);
    const a = await converse([], IPHONE, s.deps, NOW);
    expect(s.sent).toHaveLength(2);
    const r = resultOf(s.sent[1]).body;
    expect(r.confirmed).toEqual([{seller: "Apple", price: 899, condition: "new", delivery: "free"}, {seller: "Argos", price: 879, condition: "new", went_by: true}]);
    expect(r.went_by).toEqual({seller: "Argos", price: 879, with_delivery: 879});
    expect(r.what_if.amount).toBe(879);
    expect(r.overview.in_savings_pots).toBeDefined();
    expect(a).toMatchObject({text: "At £879 it'd come out of what's held back, so not today.", unchecked: [], searched: true, used: ["check_purchase", "what_if"],
      spoken: "[flatly] Apple wants £899.00. Argos, £879.00. Not today."});
    expect(a.research).toEqual({product: "iPhone 17, 256GB", note: "The newest standard model", offers: [
      expect.objectContaining({seller: "Apple", price: 899, delivery: "free", url: APPLE, host: "apple.com", checked: "2026-10-05T13:00:00Z"}),
      expect.objectContaining({seller: "Argos", price: 879, url: ARGOS, pick: true}),
    ]});
    expect(a.estimate).toBeUndefined();
    // what the line where his answer goes said, and the sites he looked at
    expect(s.doing).toEqual(["Looking up prices…", "Checking it against your money…"]);
    expect(hosts).toEqual([["argos.co.uk", "apple.com", "currys.co.uk"]]);
    // the card rides on the answer, not through what saves notes
    expect(s.effects).toEqual([]);
    expect(growsOnly([...s.sent, a.transcript])).toBe(true);
  });

  test("what the pages don't back he's told, by name and why, with nothing to lean on; nothing backed, no engine, and his words are an estimate", async () => {
    const blog = "https://www.lewislovelock.com/blog/iphone-17-price";
    const s = server(turn("tool_use", search, {...found, content: [{type: "web_search_result", url: blog, title: "x", encrypted_content: "x"}]},
      opens("f1", blog), page("f1", blog, "Amazon has the iPhone 17 256GB at £779.00"), checks({seller: "Amazon UK £1", url: blog, price: 779, condition: "new", delivery: null, pick: true})),
    said("I couldn't confirm a shop's price, so no verdict yet."));
    const a = await converse([], IPHONE, s.deps, NOW);
    const r = resultOf(s.sent[1]);
    expect(r.is_error).toBeUndefined();
    expect(r.body.not_confirmed).toEqual([{seller: "Amazon UK 1", why: "an article, not a shop page", you_went_by_it: true}]);
    expect(r.body.do_next).toMatch(/give it as an estimate/);
    expect(r.body.what_if).toBeUndefined();
    // neither what he said it costs, nor anything else of his, is now a figure he can state
    expect(r.content).not.toContain("£");
    expect(r.content).not.toContain("779");
    expect(a).toMatchObject({text: "I couldn't confirm a shop's price, so no verdict yet.", unchecked: [], used: ["check_purchase"], estimate: true});
    expect(a.research).toBeUndefined();
  });

  test("a card is still shown for what was backed, with no price to go by if his kind was turned away; words about the rest get the second look", async () => {
    const answer = () => said("Currys has it at £849, though that's from nowhere.");
    const s = server(turn("tool_use", search, found, ...PAGES, checks({...argos, condition: "refurbished", pick: false}, {...apple, price: 1, pick: true})), answer(), answer());
    const a = await converse([], IPHONE, s.deps, NOW);
    expect(s.sent).toHaveLength(3);
    expect(a.unchecked).toEqual(["£849"]);
    expect(a.research?.offers.map(o => o.seller)).toEqual(["Argos"]);
    expect(a.estimate).toBe(true);
  });

  test("a shop he opened and left out: with nothing to go by he's asked once for it, then it's settled, no new search", async () => {
    const s = server(turn("tool_use", search, found, ...PAGES, checks({...apple, price: 1, pick: true})),
      {content: [checks({...apple, price: 2, pick: true})], stop_reason: "tool_use"} as unknown as Turn, said("I couldn't confirm a price."));
    const a = await converse([], IPHONE, s.deps, NOW);
    expect(s.sent).toHaveLength(3);
    expect(resultOf(s.sent[1]).body).toMatchObject({opened_not_passed: ["argos.co.uk"], do_next: expect.stringMatching(/Call check_purchase once more/)});
    expect(resultOf(s.sent[2]).body.do_next).toMatch(/Don't call this again/);
    expect(a.estimate).toBe(true);
  });

  test("the engine never tries a price nothing backed: before any search, or on a follow-up; a figure the app knows, or you gave, is fine", async () => {
    const s = server(asks(["what_if", {amount: 799}]), said("I'll need to look that up."));
    const a = await converse([], IPHONE, s.deps, NOW);
    const r = resultOf(s.sent[1]);
    expect(r.is_error).toBe(true);
    expect(r.content).not.toMatch(/£|799/);
    expect(a.used).toEqual([]);
    // a follow-up with no search of its own: a backed price runs, one from nowhere doesn't
    const t = server(turn("tool_use", search, found, ...PAGES, checks(apple, argos)), said("Not today."), turn("tool_use", tries(1234), tries(899)), said("Later, then."));
    const first = await converse([], IPHONE, t.deps, NOW);
    await converse(first.transcript, "And if I wait till payday?", t.deps, NOW);
    expect(resultOf(t.sent[3], 0).is_error).toBe(true);
    expect(resultOf(t.sent[3], 1).body.amount).toBe(899);
    // your own figure, with a search or not
    const y = server(turn("tool_use", search, found, tries(850)), said("Not today."));
    expect((await converse([], "Currys has it at £850. Could I buy an iPhone?", y.deps, NOW)).used).toEqual(["what_if"]);
    // and nothing's gated on a question that has nothing to do with buying
    const n = server(asks(["what_if", {amount: 123.45}]), said("Fine."));
    expect((await converse([], "Can I spend some on trainers?", n.deps, NOW)).used).toEqual(["what_if"]);
  });

  test("nor a sum: a buying question can't work out what a price nothing backed does to your money", async () => {
    const s = server(turn("tool_use", search, found, sums("32640 - 346.51"), sums("879 / 4")), said("I couldn't confirm that."));
    await converse([], "Could I buy a BMW?", s.deps, NOW);
    expect(resultOf(s.sent[1], 0).is_error).toBe(true);
    expect(resultOf(s.sent[1], 0).content).not.toMatch(/£|32640/);
    // once it's backed, the sums on it run
    const t = server(turn("tool_use", search, found, ...PAGES, checks(apple, argos)), turn("tool_use", sums("879 / 4"), sums("(899 - 879) * 12")), said("Not today."));
    await converse([], IPHONE, t.deps, NOW);
    expect(resultOf(t.sent[2], 0).body.result).toBe(219.75);
    expect(resultOf(t.sent[2], 1).body.result).toBe(240);
    // what_if refused marks it, even on words that don't look like buying, and in any order: the sum beside it is refused too
    const u = server(turn("tool_use", search, found, sums("1099 - 346"), tries(1099)), said("I couldn't confirm that."));
    await converse([], "Thinking of a PS5, would that fit?", u.deps, NOW);
    expect(resultOf(u.sent[1], 0).is_error).toBe(true);
    // carrying on a purchase counts; a subscription doesn't, nor does it need a shop's page
    const v = server(turn("tool_use", search, found, ...PAGES, checks(apple, argos)), said("Not today."), turn("tool_use", search, found, sums("450 - 346")), said("I couldn't confirm that."));
    const first = await converse([], IPHONE, v.deps, NOW);
    await converse(first.transcript, "And an Xbox Series X?", v.deps, NOW);
    expect(resultOf(v.sent[3], 0).is_error).toBe(true);
    const d = server(turn("tool_use", search, found, sums("(9.99 - 5.99) * 12")), said("About £48 a year."));
    const disney = await converse([], "What's the cheapest UK plan for Disney Plus now, and what would that save me a year on the £9.99 I pay?", d.deps, NOW);
    expect(resultOf(d.sent[1]).body.result).toBe(48);
    expect(disney).toMatchObject({unchecked: []});
    expect(disney.estimate).toBeUndefined();
    expect(d.sent).toHaveLength(2);
  });

  test("called together, check_purchase goes first, so what it backs can be tried; results go back in the order he asked", async () => {
    const what = tries(899), check = checks(apple, argos);
    const s = server(turn("tool_use", search, found, ...PAGES, what, check), said("Not today."));
    await converse([], IPHONE, s.deps, NOW);
    const sent = s.sent[1][s.sent[1].length - 1].content as {tool_use_id: string; is_error?: boolean}[];
    expect(sent.map(r => r.tool_use_id)).toEqual([what.id, check.id]);
    expect(sent[0].is_error).toBeUndefined();
  });

  test("a page asked for beside it hasn't opened yet: he's told to call again, and it isn't counted against him", async () => {
    const s = server(turn("tool_use", search, found, opens("f1", APPLE), checks({...apple, pick: true})),
      turn("tool_use", page("f1", APPLE, "iPhone 17 256GB £899.00"), checks({...apple, pick: true})), said("Not today."));
    const a = await converse([], IPHONE, s.deps, NOW);
    const r = resultOf(s.sent[1]);
    expect(r.body).toEqual({do_next: expect.stringMatching(/still opening/)});
    expect((s.sent[1][2].content as {type: string}[]).map(b => b.type)).toEqual(["tool_result"]);
    expect(s.doing).toContain("Looking on the web…");
    expect(a.research?.offers.map(o => o.seller)).toEqual(["Apple"]);
    expect(a.used).toEqual(["check_purchase", "check_purchase", "what_if"]);
  });

  test("a later try that does worse doesn't take away the card he had", async () => {
    const s = server(turn("tool_use", search, found, ...PAGES, checks(apple, argos)), turn("tool_use", checks({...apple, url: "https://www.apple.com/uk/other", pick: true})), said("Not today."));
    const a = await converse([], IPHONE, s.deps, NOW);
    expect(a.research?.offers.map(o => o.seller)).toEqual(["Apple", "Argos"]);
    expect(a.estimate).toBeUndefined();
  });

  test("looked up what it costs and never had it checked: one more look says so, and only one", async () => {
    const s = server(turn("end_turn", search, found, words("It's about £799.")), said("Around £799, I couldn't confirm it."));
    const a = await converse([], IPHONE, s.deps, NOW);
    expect(s.sent).toHaveLength(2);
    const note = (s.sent[1][s.sent[1].length - 1].content as {text: string}[]).map(b => b.text).join("\n");
    expect(note).toContain("didn't run check_purchase");
    expect(a).toMatchObject({unchecked: ["£799"], estimate: true});
    // a question he didn't search for isn't asked again
    const q = server(said("Which model did you mean?"));
    const back = await converse([], IPHONE, q.deps, NOW);
    expect(q.sent).toHaveLength(1);
    expect(back.estimate).toBeUndefined();
  });

  test("his second look keeps the card he had, and his words stand on what it backed", async () => {
    const s = server(turn("tool_use", search, found, ...PAGES, checks(apple, argos)), said("You've £5,000 spare."), said("At £879, not today."));
    const a = await converse([], IPHONE, s.deps, NOW);
    expect(a).toMatchObject({text: "At £879, not today.", unchecked: []});
    expect(a.research?.offers.map(o => o.seller)).toEqual(["Apple", "Argos"]);
  });

  test("the card takes the picture's place", async () => {
    const s = server(turn("tool_use", search, found, ...PAGES, checks(apple, argos)), said(`<figure label="Today">£${perDay}</figure>\nNot today.`));
    const a = await converse([], IPHONE, s.deps, NOW);
    expect(a.unchecked).toEqual([]);
    expect(a.visual).toBeUndefined();
    expect(a.research).toBeDefined();
  });

  test("while a page or a search waits, or carries on, the line says he's looking; the sites come as they're found", async () => {
    const s = server(turn("pause_turn", search, found), turn("tool_use", ...PAGES, checks(apple, argos)), said("Not today."));
    const hosts = watched(s);
    await converse([], IPHONE, s.deps, NOW);
    expect(s.doing).toEqual(["Looking up prices…", "Looking on the web…", "Checking it against your money…"]);
    expect(hosts).toEqual([["argos.co.uk", "apple.com", "currys.co.uk"]]);
  });

  test("a briefing is never gated, nor a question that isn't for the shops", async () => {
    const brief = '<app_brief kind="daily">\n{"kind":"daily","facts":[{"id":"f1","what":"could buy","amount":10}]}\n</app_brief>';
    const b = server(asks(["calculate", {expression: "777 * 3"}], ["what_if", {amount: 777}]), said("Morning. <mentioned>f1</mentioned>"));
    await converse([], brief, b.deps, NOW, [], {whole: true});
    expect(resultOf(b.sent[1], 0).is_error).toBeUndefined();
    expect(resultOf(b.sent[1], 1).is_error).toBeUndefined();
    const s = server(said("Morning."));
    await converse([], "How much did I spend on takeaways?", s.deps, NOW);
    expect(s.doing).toEqual([]);
  });
});

describe("a briefing (said whole)", () => {
  const brief = '<app_brief kind="daily">\n{"kind":"daily","facts":[{"id":"f1","what":"bill_due","status":"new","name":"Phone","amount":42,"due":"2026-10-06 Tue"}]}\n</app_brief>';

  test("what's shown is what he says, tags out; what's said keeps them; his marks come out of both", async () => {
    const s = server(said("[flatly] Morning. Phone bill, £42, goes tomorrow.\n<next>What else is due?</next>\n<mentioned>f1</mentioned>"));
    const a = await converse([], brief, s.deps, NOW, [], {whole: true});
    expect(a).toMatchObject({text: "Morning. Phone bill, £42, goes tomorrow.", spoken: "[flatly] Morning. Phone bill, £42, goes tomorrow.",
      mentioned: ["f1"], next: ["What else is due?"], unchecked: []});
    expect(a.nothing).toBeUndefined();
    // the facts went as the question, after the date and his notes, so the conversation carries on from them
    expect((s.sent[0][0].content as {text: string}[])[1].text).toBe(brief);
  });

  test("the facts' figures count as a tool's; one from nowhere gets the second look and isn't said", async () => {
    const s = server(said("Phone bill, £45, tomorrow. <mentioned>f1</mentioned>"), said("Phone bill, £45, tomorrow. <mentioned>f1</mentioned>"));
    const a = await converse([], brief, s.deps, NOW, [], {whole: true});
    expect(a.unchecked).toEqual(["£45"]);
    expect(a.spoken).toBeUndefined();
    // the date in a fact isn't a £ figure he can use
    const d = server(said("£2026 today."), said("£2026 today."));
    expect((await converse([], brief, d.deps, NOW, [], {whole: true})).unchecked).toEqual(["£2,026"]);
  });

  test("nothing worth saying", async () => {
    const a = await converse([], brief, server(said("<nothing/>")).deps, NOW, [], {whole: true});
    expect(a).toMatchObject({text: "", mentioned: [], nothing: true});
  });
});
