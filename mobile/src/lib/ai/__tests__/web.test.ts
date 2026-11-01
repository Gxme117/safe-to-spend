import type {Turn} from "../converse";
import {answerBlocks, searchedIn, searchWaiting, sourcesOf} from "../web";

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
