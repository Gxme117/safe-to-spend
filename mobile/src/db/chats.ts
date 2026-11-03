import type {Who} from "@/lib/ai/tools";
import type {Chat, ChatRow} from "@/lib/chats";
import {db} from "./open";

interface Row { id: string; who: Who; title: string; created: number; updated: number; body: string }

/** The chats last used since `since`, newest first, without what's in them. */
export async function listChats(since: number): Promise<ChatRow[]> {
  const d = await db();
  return d.getAllAsync<Row>("SELECT id, who, title, created, updated, body FROM chat WHERE updated >= ? ORDER BY updated DESC", since);
}

/** One whole chat, or null when it's gone. */
export async function loadChat<S, T>(id: string): Promise<Chat<S, T> | null> {
  const d = await db();
  const r = await d.getFirstAsync<Row & {said: string; transcript: string}>("SELECT * FROM chat WHERE id = ?", id);
  return r ? {...r, said: JSON.parse(r.said) as S[], transcript: JSON.parse(r.transcript) as T} : null;
}

/** Adds a chat, or replaces it as it is now. */
export async function saveChat(c: Chat): Promise<void> {
  const d = await db();
  await d.runAsync(
    "INSERT OR REPLACE INTO chat (id, who, title, created, updated, body, said, transcript) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    c.id, c.who, c.title, c.created, c.updated, c.body, JSON.stringify(c.said), JSON.stringify(c.transcript),
  );
}

export async function deleteChat(id: string): Promise<void> {
  const d = await db();
  await d.runAsync("DELETE FROM chat WHERE id = ?", id);
}

/** Deletes the chats last used before `before` (30 days ago). */
export async function pruneChats(before: number): Promise<void> {
  const d = await db();
  await d.runAsync("DELETE FROM chat WHERE updated < ?", before);
}
