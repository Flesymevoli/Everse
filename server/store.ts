import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Card } from "./cards.js";
import type { Message } from "./context.js";
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS preferences(id TEXT PRIMARY KEY, suggestions INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, cardId TEXT NOT NULL, messages TEXT NOT NULL);",
    );
  }
  cards() {
    return this.db
      .prepare("SELECT * FROM cards")
      .all()
      .map((r) => ({
        id: String(r.id),
        ...(JSON.parse(String(r.body)) as { card: Card; warnings: string[] }),
      }));
  }
  addCard(value: { card: Card; warnings: string[] }) {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO cards VALUES (?,?)")
      .run(id, JSON.stringify(value));
    return id;
  }
  sessions() {
    return this.db.prepare("SELECT id,cardId FROM sessions").all();
  }
  session(id: string) {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id=?").get(id);
    if (!r) throw new Error("存档不存在");
    return {
      id: String(r.id),
      cardId: String(r.cardId),
      suggestions: Boolean(
        this.db
          .prepare("SELECT suggestions FROM preferences WHERE id=?")
          .get(id)?.suggestions,
      ),
      messages: JSON.parse(String(r.messages)) as Message[],
    };
  }
  create(cardId: string, messages: Message[]) {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(id, cardId, JSON.stringify(messages));
    return id;
  }
  save(id: string, messages: Message[]) {
    this.db
      .prepare("UPDATE sessions SET messages=? WHERE id=?")
      .run(JSON.stringify(messages), id);
  }
  setSuggestions(id: string, enabled: boolean) {
    this.session(id);
    this.db
      .prepare(
        "INSERT INTO preferences VALUES (?,?) ON CONFLICT(id) DO UPDATE SET suggestions=excluded.suggestions",
      )
      .run(id, Number(enabled));
  }
  close() {
    this.db.close();
  }
}
