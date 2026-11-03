// What Tim and Frank found on the web. Anthropic runs the search while Claude answers, so the phone never fetches a page and the
// pages come back encrypted: all it can read is what he cites, and where it came from. A shop's page he opens for a purchase is
// the exception: Anthropic fetches that too, but its text comes back readable (lib/ai/research.ts checks prices on it). Pure.
import type Anthropic from "@anthropic-ai/sdk";

type Block = Anthropic.Beta.Messages.BetaContentBlock;
type Words = Anthropic.Beta.Messages.BetaTextBlock;

export interface Source { title: string; url: string; host: string }

const isWords = (b: Block): b is Words => b.type === "text";
// http(s) only, and never one with a login in it, where what it looks like isn't where it goes
const HOST = /^https?:\/\/(?:www\.)?([^/?#:@]+)(?=[/?#:]|$)/i;

/** A page's host ("argos.co.uk"), or null for anything that isn't a plain http(s) address. */
export const hostOf = (url: string): string | null => HOST.exec(url)?.[1].toLowerCase() ?? null;

/** What his text blocks go back together with: a citation splits a sentence into several, spaces and all, so those join as they
 *  came; uncited ones are paragraphs. */
export const joinerOf = (texts: readonly Words[]) => texts.some(b => b.citations?.length) ? "" : "\n\n";

/** What the line where his answer will go says while a search runs. */
export const SEARCHING = "Looking on the web…";

const isWebResult = (b: Block) => b.type === "web_search_tool_result" || b.type === "web_fetch_tool_result";

/** His answer's text blocks: what's after his last search or page. Anything before it is him saying he'll look. */
export function answerBlocks(blocks: Block[]): Words[] {
  return blocks.slice(blocks.map(isWebResult).lastIndexOf(true) + 1).filter(isWords);
}

/** Every page his answer cites, once, in the order he cites them. */
export function sourcesOf(blocks: Block[]): Source[] {
  const seen = new Map<string, Source>();
  for (const {citations} of answerBlocks(blocks)) {
    for (const c of citations ?? []) {
      if (c.type !== "web_search_result_location" || seen.has(c.url)) continue;
      const host = hostOf(c.url);
      if (host) seen.set(c.url, {title: c.title || host, url: c.url, host});
    }
  }
  return [...seen.values()];
}

/** The sites a search brought back, and any page he opened, once each, in order: what he's looking at while he works. */
export function resultHosts(blocks: Block[]): string[] {
  const hosts = blocks.flatMap(b => {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) return b.content.flatMap(r => r.type === "web_search_result" ? [hostOf(r.url)] : []);
    return b.type === "web_fetch_tool_result" && b.content.type === "web_fetch_result" ? [hostOf(b.content.url)] : [];
  });
  return [...new Set(hosts.filter((h): h is string => !!h))];
}

/** Whether this turn searched the web or opened a page, or brought back one asked for in the turn before it. */
export const searchedIn = (blocks: Block[]) =>
  blocks.some(b => isWebResult(b) || (b.type === "server_tool_use" && (b.name === "web_search" || b.name === "web_fetch")));

/** A search or a page Claude asked for that hasn't run yet: asked alongside the phone's tools, it runs on the next request. Until
 *  then only those tools' results may follow it: anything else, a note or the next question, and Claude's side refuses the
 *  conversation. */
export function searchWaiting(blocks: Block[]): boolean {
  const done = new Set(blocks.flatMap(b => b.type === "web_search_tool_result" || b.type === "web_fetch_tool_result" ? [b.tool_use_id] : []));
  return blocks.some(b => b.type === "server_tool_use" && !done.has(b.id));
}
