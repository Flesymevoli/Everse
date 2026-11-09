import { z } from "zod";
import type { Store } from "./store.js";
import type { SecretProtector } from "./secrets.js";
export const savedConnectionSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(100),
    baseUrl: z
      .string()
      .url()
      .max(2000)
      .refine((s) => {
        const u = new URL(s);
        return (
          ["https:", "http:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      }),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().max(4096).optional(),
  })
  .strict();
export class ConnectionVault {
  constructor(
    private store: Store,
    private protector: SecretProtector,
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,name TEXT NOT NULL,baseUrl TEXT NOT NULL,model TEXT NOT NULL,secret TEXT NOT NULL)",
    );
  }
  list() {
    return this.store.db
      .prepare(
        "SELECT id,name,baseUrl,model,secret != '' AS hasKey FROM connections",
      )
      .all()
      .map((r) => ({
        id: String(r.id),
        name: String(r.name),
        baseUrl: String(r.baseUrl),
        model: String(r.model),
        hasKey: Boolean(r.hasKey),
        saved: true,
      }));
  }
  async save(raw: unknown) {
    const p = savedConnectionSchema.parse(raw);
    const old = this.store.db
      .prepare("SELECT * FROM connections WHERE id=?")
      .get(p.id);
    // A retained key may never silently move to a different endpoint.
    if (
      old &&
      old.secret &&
      old.baseUrl !== p.baseUrl &&
      p.apiKey === undefined
    )
      throw new Error("修改 API 地址时请重新填写 Key，或先删除已保存的 Key");
    const secret =
      p.apiKey === undefined
        ? String(old?.secret ?? "")
        : p.apiKey
          ? await this.protector.protect(p.apiKey)
          : "";
    this.store.db
      .prepare(
        "INSERT INTO connections VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,baseUrl=excluded.baseUrl,model=excluded.model,secret=excluded.secret",
      )
      .run(p.id, p.name, p.baseUrl, p.model, secret);
    return this.list().find((v) => v.id === p.id)!;
  }
  delete(id: string) {
    this.store.db.prepare("DELETE FROM connections WHERE id=?").run(id);
  }
  clearKey(id: string) {
    this.store.db
      .prepare("UPDATE connections SET secret='' WHERE id=?")
      .run(id);
  }
  async config(id: string) {
    const r = this.store.db
      .prepare("SELECT * FROM connections WHERE id=?")
      .get(id);
    if (!r) throw new Error("API 连接不存在，请重新选择");
    return {
      mock: false,
      baseUrl: String(r.baseUrl),
      model: String(r.model),
      apiKey: r.secret ? await this.protector.unprotect(String(r.secret)) : "",
    };
  }
}
