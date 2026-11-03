import type {Turn} from "../converse";
import {answerBlocks, hostOf, joinerOf, resultHosts, searchedIn, searchWaiting, sourcesOf} from "../web";

const blocks = (...b: object[]) => b as unknown as Turn["content"];
const search = {type: "server_tool_use", id: "s1", name: "web_search", input: {query: "netflix uk price"}};
const found = {type: "web_search_tool_result", tool_use_id: "s1", content: [{type: "web_search_result", url: "https://www.netflix.com/gb", title: "Netflix", encrypted_content: "x"}]};
const cite = (url: string, title: string | null = "A page") => ({type: "web_search_result_location", url, title, encrypted_index: "i", cited_text: "Standard £12.99"});

test("his answer is what's after his last search: anything before it is him saying he'll look", () => {
  const text = (t: string) => ({type: "text", text: t});
  expect(answerBlocks(blocks(text("I'll look."), search, found, text("It's "), text("£12.99.")))).toEqual([text("It's "), text("£12.99.")]);
  expect(answerBlocks(blocks(text("No search.")))).toEqual([text("No search.")]);
});

test("the pages an answer cites: each once, by its address, with where it's from", () => {
  const out = sourcesOf(blocks(
    {type: "text", text: "It's ", citations: null},
    {type: "text", text: "£12.99", citations: [cite("https://www.netflix.com/gb", "Netflix UK"), cite("https://www.netflix.com/gb", "Netflix UK")]},
    {type: "text", text: "and £5.99", citations: [cite("https://WHICH.co.uk/reviews?x=1", null)]},
  ));
  expect(out).toEqual([
    {title: "Netflix UK", url: "https://www.netflix.com/gb", host: "netflix.com"},
    {title: "which.co.uk", url: "https://WHICH.co.uk/reviews?x=1", host: "which.co.uk"},
  ]);
});

test("nothing that isn't plainly a web page is offered as a link", () => {
  const out = sourcesOf(blocks({type: "text", text: "£1", citations: [cite("javascript:alert(1)"), cite("https://netflix.com@evil.example/"), cite("file:///etc/passwd")]}));
  expect(out).toEqual([]);
});

test("whether he searched: asking, or the result of one asked for in the turn before", () => {
  expect(searchedIn(blocks(search, found))).toBe(true);
  expect(searchedIn(blocks(found))).toBe(true);
  expect(searchedIn(blocks({type: "text", text: "No."}, {type: "tool_use", id: "t", name: "overview", input: {}}))).toBe(false);
});

test("a search is waiting when it hasn't brought back its result", () => {
  expect(searchWaiting(blocks(search, {type: "tool_use", id: "t", name: "overview", input: {}}))).toBe(true);
  expect(searchWaiting(blocks(search, found))).toBe(false);
  expect(searchWaiting(blocks({type: "tool_use", id: "t", name: "overview", input: {}}))).toBe(false);
});

test("the sites a search brought back: each once, in order, only plain web pages, none from a search that failed", () => {
  const results = (...urls: string[]) => ({type: "web_search_tool_result", tool_use_id: "s2", content: urls.map(url => ({type: "web_search_result", url, title: "x", encrypted_content: "x"}))});
  expect(resultHosts(blocks(search, found, results("https://www.argos.co.uk/p", "https://netflix.com/x", "javascript:alert(1)", "https://www.apple.com/uk")))).toEqual(["netflix.com", "argos.co.uk", "apple.com"]);
  expect(resultHosts(blocks({type: "web_search_tool_result", tool_use_id: "s3", content: {type: "web_search_tool_result_error", error_code: "unavailable"}}))).toEqual([]);
  expect(resultHosts(blocks({type: "text", text: "No search."}))).toEqual([]);
});

test("a shop's page he opens counts like a search: his answer is after it, it's looked for, and it can be waiting", () => {
  const opens = {type: "server_tool_use", id: "f1", name: "web_fetch", input: {url: "https://www.apple.com/uk"}};
  const page = {type: "web_fetch_tool_result", tool_use_id: "f1", content: {type: "web_fetch_result", url: "https://www.apple.com/uk", retrieved_at: null, content: {type: "document", source: {type: "text", media_type: "text/plain", data: "£899"}}}};
  const refused = {type: "web_fetch_tool_result", tool_use_id: "f1", content: {type: "web_fetch_tool_result_error", error_code: "url_not_accessible"}};
  const text = (t: string) => ({type: "text", text: t});
  expect(answerBlocks(blocks(text("I'll open it."), opens, page, text("It's £899.")))).toEqual([text("It's £899.")]);
  expect(answerBlocks(blocks(search, found, text("Opening it."), opens, refused, text("It wouldn't open.")))).toEqual([text("It wouldn't open.")]);
  for (const b of [opens, page, refused]) expect(searchedIn(blocks(b))).toBe(true);
  // a finished page isn't waiting, nor one that refused; asked for beside a tool, it is, until it comes back
  expect(searchWaiting(blocks(opens, page))).toBe(false);
  expect(searchWaiting(blocks(opens, refused))).toBe(false);
  expect(searchWaiting(blocks(search, found, opens, {type: "tool_use", id: "t", name: "check_purchase", input: {}}))).toBe(true);
  expect(resultHosts(blocks(search, found, opens, page))).toEqual(["netflix.com", "apple.com"]);
  expect(resultHosts(blocks(refused))).toEqual([]);
});

test("a page's host, and how his words go back together", () => {
  expect(hostOf("https://www.Argos.co.uk/product/1")).toBe("argos.co.uk");
  expect(hostOf("https://argos.co.uk@evil.example/")).toBeNull();
  expect(joinerOf([{type: "text", text: "a", citations: null}, {type: "text", text: "b", citations: null}])).toBe("\n\n");
  expect(joinerOf([{type: "text", text: "a", citations: null}, {type: "text", text: "£1", citations: [cite("https://x.example/")] as never}])).toBe("");
});
