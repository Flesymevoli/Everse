import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Card } from "./cards.js";
import type { Message } from "./context.js";
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS session_options(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY, sessionId TEXT NOT NULL, messages TEXT NOT NULL);",
    );
    if (
      !this.db
        .prepare("PRAGMA table_info(revisions)")
        .all()
        .some((row) => row.name === "expected")
    )
      this.db.exec("ALTER TABLE revisions ADD COLUMN expected TEXT");
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
        ...(JSON.parse(String(r.body)) as {
          card: Card;
          warnings: string[];
          original?: unknown;
        }),
      }));
  }
  addCard(value: { card: Card; warnings: string[]; original?: unknown }) {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO cards VALUES (?,?)")
      .run(id, JSON.stringify(value));
    return id;
  }
  sessions() {
    return this.db
      .prepare("SELECT id,cardId FROM sessions")
      .all()
      .map((row) => ({ ...row, options: this.options(String(row.id)) }));
  }
  assets(kind: string) {
    return this.db
      .prepare("SELECT * FROM assets WHERE kind=?")
      .all(kind)
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        ...(JSON.parse(String(row.body)) as {
          original: unknown;
          warnings: string[];
        }),
      }));
  }
  addAsset(
    kind: string,
    name: string,
    value: { original: unknown; warnings: string[] },
  ) {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO assets VALUES (?,?,?,?)")
      .run(id, kind, name, JSON.stringify(value));
    return id;
  }
  options(id: string): import("./settings.js").SessionOptions {
    return JSON.parse(
      String(
        this.db.prepare("SELECT body FROM session_options WHERE id=?").get(id)
          ?.body ?? "{}",
      ),
    );
  }
  setOptions(id: string, options: import("./settings.js").SessionOptions) {
    this.session(id);
    this.db
      .prepare(
        "INSERT INTO session_options VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(id, JSON.stringify(options));
  }
  edit(id: string, messages: Message[]) {
    const old = this.session(id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO revisions(sessionId,messages,expected) VALUES (?,?,?)",
        )
        .run(id, JSON.stringify(old.messages), JSON.stringify(messages));
      this.save(id, messages);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  undo(id: string) {
    const revision = this.db
      .prepare(
        "SELECT id,messages,expected FROM revisions WHERE sessionId=? ORDER BY id DESC LIMIT 1",
      )
      .get(id);
    if (!revision) throw new Error("没有可撤销的编辑");
    const previous = JSON.parse(String(revision.messages)) as Message[];
    if (
      (revision.expected != null &&
        String(revision.expected) !==
          JSON.stringify(this.session(id).messages)) ||
      previous.length !== this.session(id).messages.length
    )
      throw new Error("编辑后已有新剧情，不能撤销覆盖；请先创建分支");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.save(id, JSON.parse(String(revision.messages)));
      this.db.prepare("DELETE FROM revisions WHERE id=?").run(revision.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  session(id: string) {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id=?").get(id);
    if (!r) throw new Error("存档不存在");
    return {
      id: String(r.id),
      cardId: String(r.cardId),
      options: this.options(id),
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
