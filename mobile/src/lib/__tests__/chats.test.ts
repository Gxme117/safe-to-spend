import {bodyOf, cutoff, fromSaved, groupsOf, matches, titleOf, toSaved, type ChatRow} from "@/lib/chats";

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 11, 3, 0, 1); // just after midnight, so the day edges matter
const row = (id: string, updated: number, extra: Partial<ChatRow> = {}): ChatRow =>
  ({id, who: "tim", title: id, created: updated, updated, body: "", ...extra});

test("each chat is named after your first question, on one line", () => {
  expect(titleOf("  Can I afford\n a holiday?  ")).toBe("Can I afford a holiday?");
  const long = titleOf("What would happen to my daily number if I paid off the whole of my credit card this month instead of next?");
  expect(long.length).toBeLessThanOrEqual(80);
  expect(long.endsWith("…")).toBe(true);
  expect(long).not.toMatch(/\s…$/); // cut at a word
});

test("chats are grouped as ChatGPT does, by the calendar day, newest first", () => {
  const groups = groupsOf([
    row("yesterday late", at(2026, 11, 2, 23, 59)),
    row("today", at(2026, 11, 3, 0, 0)),
    row("2 days ago", at(2026, 11, 1)),
    row("7 days ago", at(2026, 10, 27)),
    row("8 days ago", at(2026, 10, 26)),
    row("29 days ago", at(2026, 10, 5)),
    row("31 days ago", at(2026, 10, 3)),
  ], NOW);
  expect(groups.map(g => [g.label, g.rows.map(r => r.id)])).toEqual([
    ["Today", ["today"]],
    ["Yesterday", ["yesterday late"]],
    ["Previous 7 days", ["2 days ago", "7 days ago"]],
    ["Previous 30 days", ["8 days ago", "29 days ago"]],
  ]);
});

test("empty groups aren't shown", () => {
  expect(groupsOf([row("today", NOW)], NOW).map(g => g.label)).toEqual(["Today"]);
  expect(groupsOf([], NOW)).toEqual([]);
});

test("a chat is kept 30 days from when it was last used", () => {
  expect(cutoff(NOW)).toBe(NOW - 30 * 86_400_000);
});

test("search finds a chat by its name or anything said in it, whatever the case", () => {
  const r = row("Can I afford a holiday?", NOW, {title: "Can I afford a holiday?", body: "Can I afford a holiday?\nYes, if you wait till payday."});
  expect(matches(r, "")).toBe(true);
  expect(matches(r, "HOLIDAY")).toBe(true);
  expect(matches(r, "payday")).toBe(true);
  expect(matches(r, "rent")).toBe(false);
});

test("what's kept leaves out his voice and closes a card still waiting for you", () => {
  const said = [
    {id: 4, mine: true, text: "Add Netflix"},
    {id: 5, mine: false, text: "Here it is.", voiced: {line: "Here.", take: {uri: "file:///cache/x.mp3"}},
      cards: [{status: "open"}, {status: "done"}, {status: "saving"}]},
  ];
  const kept = toSaved(said);
  expect(kept[1]).not.toHaveProperty("voiced");
  expect(kept[1].cards!.map(k => k.status)).toEqual(["unanswered", "done", "unanswered"]);
  expect(bodyOf(said)).toBe("Add Netflix\nHere it is.");
  let n = 100;
  expect(fromSaved(kept, () => n++).map(s => s.id)).toEqual([100, 101]);
});
