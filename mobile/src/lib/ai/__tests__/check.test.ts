import {checkNote, knownIn, poundsIn, unchecked, webFigures, withoutWeb} from "../check";

test("the £ amounts in a reply, however they're written", () => {
  expect(poundsIn("You've £1,234.56 now, £30 left today and £ 7.5 on snacks.")).toEqual([1234.56, 30, 7.5]);
  expect(poundsIn("Rent's £400. Then £12,50 euro-style")).toEqual([400, 12]);
  expect(poundsIn("No pounds here, just 30 quid and 26 Oct")).toEqual([]);
});

const tool = (content: object) => ({type: "tool_result" as const, tool_use_id: "t", content: JSON.stringify(content)});

test("what a reply may use: tool results (numbers, and £ in their sentences), and what the person said; never his own earlier words", () => {
  const known = knownIn([
    {role: "user", content: [{type: "text", text: "<app_context>Now: 2026-10-05</app_context>"}, {type: "text", text: "Can I spend 150 on trainers?"}]},
    {role: "assistant", content: [{type: "text", text: "You've got £999."}, {type: "tool_use", id: "t", name: "overview", input: {}}]},
    {role: "user", content: [tool({today_amount: {amount: 18, in_the_app: "£12 spent of today's £18"}, payday: "2026-10-30 Fri"})]},
  ]);
  expect(known).toEqual(expect.arrayContaining([150, 18, 12]));
  expect(known).not.toContain(999);
  // a date in a tool result is a string without a £: its digits don't count
  expect(known).not.toContain(30);
});

test("the app's own words: its context counts only for the £ in your notes, its check for nothing", () => {
  const known = knownIn([
    {role: "user", content: [{type: "text", text: "<app_context>\nNow: 2026-10-05 (Mon 5 October 2026), 14:05.\n- [n_tv] Saving for a TV (£600).\n</app_context>"}, {type: "text", text: "Hi"}]},
    {role: "assistant", content: "You've £512.40."},
    {role: "user", content: [{type: "text", text: "<app_check>These figures in your last answer don't match any tool result or calculation: £512.40.</app_check>"}]},
  ]);
  expect(known).toEqual([600]);
});

test("a reply checks out when every figure traces back: to the penny, or rounded when he gives whole pounds", () => {
  const known = [429.6, 18, -20, 115];
  expect(unchecked("About £430 is held for bills. £18 today.", known)).toEqual([]);
  expect(unchecked("You're £20 past your groceries budget.", known)).toEqual([]);
  expect(unchecked("That's £115 a week.", known)).toEqual([]);
  expect(unchecked("£0 left today.", known)).toEqual([]);
  expect(unchecked("£429.60 exactly.", known)).toEqual([]);
});

test("a figure from nowhere is caught, once, as it would be written", () => {
  expect(unchecked("You'll have £512.40 left, or £512.40 after that, and £18 today.", [18])).toEqual(["£512.40"]);
  expect(unchecked("£429 is held.", [429.6])).toEqual(["£429"]);
  expect(unchecked("£1,500 a month.", [])).toEqual(["£1,500"]);
});

test("the app's note when a figure doesn't check out", () => {
  expect(checkNote(["£512.40", "£3"])).toBe("<app_check>These figures in your last answer don't match any tool result, calculation or citation: £512.40, £3. Check them with the tools, then give your whole answer again.</app_check>");
});

describe("a price on the web", () => {
  const cited = (text: string, ...quotes: string[]) => ({text, citations: quotes.map(cited_text => ({type: "web_search_result_location", cited_text}))});

  test("counts only where the block's own citation quotes it", () => {
    expect(webFigures(cited("Standard is £12.99 a month.", "Standard with ads £5.99, Standard £12.99, Premium £18.99"))).toEqual([12.99]);
    expect(webFigures(cited("Standard is £13 a month.", "Standard £12.99"))).toEqual([]);
    expect(webFigures({text: "Standard is £12.99 a month."})).toEqual([]);
    expect(webFigures({text: "Standard is £12.99 a month.", citations: null})).toEqual([]);
  });

  test("taken out of what has to trace back; anything his citation doesn't quote stays in", () => {
    expect(withoutWeb(cited("Standard is £12.99, you pay £10.99.", "Standard £12.99"))).toBe("Standard is , you pay £10.99.");
    expect(withoutWeb({text: "£12.99."})).toBe("£12.99.");
  });

  test("never rounded, and never vouches for anything but itself", () => {
    expect(unchecked("It's £12.99 a month.", [], [12.99])).toEqual([]);
    expect(unchecked("It's £13 a month.", [], [12.99])).toEqual(["£13"]);
    // a price he cited isn't known: it's no use for anything said about your money
    const known = knownIn([{role: "assistant", content: [cited("Standard is £12.99.", "Standard £12.99")]} as never]);
    expect(known).toEqual([]);
  });
});
