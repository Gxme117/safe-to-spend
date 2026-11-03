import {openDatabaseAsync, type SQLiteDatabase} from "expo-sqlite";
import {migrate} from "./schema";

let opening: Promise<SQLiteDatabase> | null = null;
/** Opens money.db once and migrates it before anything reads it. */
export const db = () => (opening ??= openDatabaseAsync("money.db").then(async d => { await migrate(d); return d; }));
