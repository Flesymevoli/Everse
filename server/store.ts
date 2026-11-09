import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Card } from "./cards.js";
import type { Message } from "./context.js";
import { historyKey, readStory } from "./story.js";
import type { Correction } from "../shared/story.js";
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS director_revisions(id INTEGER PRIMARY KEY,sessionId TEXT NOT NULL,body TEXT NOT NULL)",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS document_plans(id TEXT PRIMARY KEY, body TEXT NOT NULL)",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS source_documents(id TEXT PRIMARY KEY, name TEXT NOT NULL, body BLOB NOT NULL)",
    );
    if (
      !this.db
        .prepare("PRAGMA table_info(source_documents)")
        .all()
        .some((row) => row.name === "extracted")
    )
      this.db.exec("ALTER TABLE source_documents ADD COLUMN extracted TEXT");
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS story_corrections(id INTEGER PRIMARY KEY, sessionId TEXT NOT NULL, anchor TEXT NOT NULL, count INTEGER NOT NULL, key TEXT NOT NULL, value TEXT);
      CREATE TABLE IF NOT EXISTS turn_drafts(sessionId TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_usage(id INTEGER PRIMARY KEY, sessionId TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS turn_receipts(sessionId TEXT NOT NULL, requestId TEXT NOT NULL, PRIMARY KEY(sessionId,requestId));`);
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
  worlds() {
    return this.db
      .prepare("SELECT * FROM assets WHERE kind='worlds'")
      .all()
      .map((r) => ({
        id: String(r.id),
        ...(JSON.parse(String(r.body)) as ReturnType<
          typeof import("./worlds.js").importWorld
        >),
      }));
  }
  addWorld(value: ReturnType<typeof import("./worlds.js").importWorld>) {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO assets VALUES (?,?,?,?)")
      .run(id, "worlds", value.world.data.name, JSON.stringify(value));
    return id;
  }
  updateAsset(id: string, kind: string, name: string, value: unknown) {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS asset_revisions(id INTEGER PRIMARY KEY,assetId TEXT NOT NULL,name TEXT NOT NULL,body TEXT NOT NULL)",
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db
        .prepare("SELECT name,body FROM assets WHERE id=? AND kind=?")
        .get(id, kind);
      if (!old) throw new Error("资源不存在");
      this.db
        .prepare(
          "INSERT INTO asset_revisions(assetId,name,body) VALUES (?,?,?)",
        )
        .run(id, old.name, old.body);
      this.db
        .prepare("UPDATE assets SET name=?,body=? WHERE id=? AND kind=?")
        .run(name, JSON.stringify(value), id, kind);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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
  updateCard(
    id: string,
    value: ReturnType<typeof import("./cards.js").importCard>,
  ) {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS card_revisions(id INTEGER PRIMARY KEY,cardId TEXT NOT NULL,body TEXT NOT NULL)",
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db.prepare("SELECT body FROM cards WHERE id=?").get(id);
      if (!old) throw new Error("角色卡不存在");
      this.db
        .prepare("INSERT INTO card_revisions(cardId,body) VALUES (?,?)")
        .run(id, old.body);
      this.db
        .prepare("UPDATE cards SET body=? WHERE id=?")
        .run(JSON.stringify(value), id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  sessions() {
    return this.db
      .prepare("SELECT id,cardId FROM sessions")
      .all()
      .map((row) => ({
        id: String(row.id),
        cardId: String(row.cardId),
        options: this.options(String(row.id)),
      }));
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
  corrections(id: string): Correction[] {
    return this.db
      .prepare(
        "SELECT id,anchor,count,key,value FROM story_corrections WHERE sessionId=? ORDER BY id",
      )
      .all(id) as unknown as Correction[];
  }
  story(id: string) {
    return readStory(this.session(id).messages, this.corrections(id));
  }
  correct(id: string, revision: string, key: string, value: string | null) {
    const messages = this.session(id).messages;
    if (this.story(id).revision !== revision)
      throw new Error("剧情或修正已变化，请刷新后再修正");
    if (!this.story(id).facts.some((f) => f.key === key))
      throw new Error("事实不存在");
    this.db
      .prepare(
        "INSERT INTO story_corrections(sessionId,anchor,count,key,value) VALUES (?,?,?,?,?)",
      )
      .run(id, historyKey(messages), messages.length, key, value);
  }
  copyCorrections(from: string, to: string) {
    this.db
      .prepare(
        "INSERT INTO story_corrections(sessionId,anchor,count,key,value) SELECT ?,anchor,count,key,value FROM story_corrections WHERE sessionId=?",
      )
      .run(to, from);
  }
  draft(
    id: string,
  ): { raw: string; input: string; base: string; error: string } | null {
    const row = this.db
      .prepare("SELECT body FROM turn_drafts WHERE sessionId=?")
      .get(id);
    return row ? JSON.parse(String(row.body)) : null;
  }
  saveDraft(id: string, value: NonNullable<ReturnType<Store["draft"]>>) {
    this.db
      .prepare(
        "INSERT INTO turn_drafts VALUES (?,?) ON CONFLICT(sessionId) DO UPDATE SET body=excluded.body",
      )
      .run(id, JSON.stringify(value));
  }
  commitTurn(id: string, base: string, messages: Message[], requestId: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (historyKey(this.session(id).messages) !== base)
        throw new Error("剧情已变化，本轮未覆盖存档");
      this.db
        .prepare("INSERT INTO turn_receipts VALUES (?,?)")
        .run(id, requestId);
      this.save(id, messages);
      this.db.prepare("DELETE FROM turn_drafts WHERE sessionId=?").run(id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
