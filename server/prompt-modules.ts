import { Hono } from "hono";
import { z } from "zod";
import {
  promptModuleSchema,
  promptModuleFileSchema,
  type PromptModule,
} from "../shared/prompt-modules.js";
import type { Store } from "./store.js";
const kind = "prompt-modules";
export function readPromptModules(store: Store) {
  return store
    .assets(kind)
    .map((asset) => ({
      ...promptModuleSchema.parse(asset.original),
      id: asset.id,
    }));
}
export function promptModuleRoutes(store: Store) {
  const app = new Hono();
  const add = (value: PromptModule) =>
    store.addAsset(kind, value.name, { original: value, warnings: [] });
  app.get("/", (c) => c.json(readPromptModules(store)));
  app.post("/", async (c) => {
    const value = promptModuleSchema.parse(await c.req.json());
    return c.json({ ...value, id: add(value) });
  });
  app.post("/import", async (c) => {
    const file = promptModuleFileSchema.parse(await c.req.json());
    store.db.exec("SAVEPOINT import_prompt_modules");
    try {
      const ids = file.modules.map((value) =>
        add({ ...value, enabled: false }),
      );
      store.db.exec("RELEASE import_prompt_modules");
      return c.json({
        ids,
        warning: "已导入，默认关闭。检查内容后启用；没有覆盖现有模块。",
      });
    } catch (error) {
      store.db.exec(
        "ROLLBACK TO import_prompt_modules; RELEASE import_prompt_modules",
      );
      throw error;
    }
  });
  app.get("/export", (c) => {
    c.header(
      "Content-Disposition",
      'attachment; filename="everse-prompt-modules.json"',
    );
    return c.json({
      format: "everse_prompt_modules_v1",
      modules: readPromptModules(store).map(({ id: _id, ...module }) => module),
    });
  });
  app.post("/:id", async (c) => {
    const value = promptModuleSchema.parse(await c.req.json());
    store.updateAsset(c.req.param("id"), kind, value.name, {
      original: value,
      warnings: [],
    });
    return c.json({ ...value, id: c.req.param("id") });
  });
  app.post("/:id/copy", async (c) => {
    const source = readPromptModules(store).find(
      (m) => m.id === c.req.param("id"),
    );
    if (!source) return c.json({ error: "模块不存在" }, 404);
    const { id: _id, ...value } = source;
    const copy = {
      ...value,
      enabled: false,
      name: value.name.slice(0, 94) + " · 副本",
    };
    return c.json({ ...copy, id: add(copy) });
  });
  app.post("/:id/delete", async (c) => {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(await c.req.json());
    const result = store.db
      .prepare("DELETE FROM assets WHERE id=? AND kind=?")
      .run(c.req.param("id"), kind);
    if (!result.changes) return c.json({ error: "模块不存在" }, 404);
    return c.json({ deleted: true });
  });
  return app;
}
