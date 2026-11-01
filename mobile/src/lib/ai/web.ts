// What Tim and Frank found on the web. Anthropic runs the search while Claude answers, so the phone never fetches a page and the
// pages come back encrypted: all it can read is what he cites, and where it came from. Pure.
import type Anthropic from "@anthropic-ai/sdk";

type Block = Anthropic.Beta.Messages.BetaContentBlock;
type Words = Anthropic.Beta.Messages.BetaTextBlock;

export interface Source { title: string; url: string; host: string }

const isWords = (b: Block): b is Words => b.type === "text";
// http(s) only, and never one with a login in it, where what it looks like isn't where it goes
const HOST = /^https?:\/\/(?:www\.)?([^/?#:@]+)(?=[/?#:]|$)/i;

/** His answer's text blocks: what's after his last search. Anything before it is him saying he'll look. */
export function answerBlocks(blocks: Block[]): Words[] {
  return blocks.slice(blocks.map(b => b.type).lastIndexOf("web_search_tool_result") + 1).filter(isWords);
}

/** Every page his answer cites, once, in the order he cites them. */
export function sourcesOf(blocks: Block[]): Source[] {
  const seen = new Map<string, Source>();
  for (const {citations} of answerBlocks(blocks)) {
    for (const c of citations ?? []) {
      if (c.type !== "web_search_result_location" || seen.has(c.url)) continue;
      const host = HOST.exec(c.url)?.[1].toLowerCase();
      if (host) seen.set(c.url, {title: c.title || host, url: c.url, host});
    }
  }
  return [...seen.values()];
}

/** Whether this turn searched the web, or brought back a search asked for in the turn before it. */
export const searchedIn = (blocks: Block[]) =>
  blocks.some(b => b.type === "web_search_tool_result" || (b.type === "server_tool_use" && b.name === "web_search"));

/** A search Claude asked for that hasn't run yet: asked alongside the phone's tools, it runs on the next request. Until then only
 *  those tools' results may follow it: anything else, a note or the next question, and Claude's side refuses the conversation. */
export function searchWaiting(blocks: Block[]): boolean {
  const done = new Set(blocks.flatMap(b => b.type === "web_search_tool_result" ? [b.tool_use_id] : []));
  return blocks.some(b => b.type === "server_tool_use" && !done.has(b.id));
}
