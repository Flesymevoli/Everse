import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { stream } from "hono/streaming";
import { z } from "zod";
import { importCard, expand } from "./cards.js";
import { buildContext } from "./context.js";
import { parseSuggestions, suggestionInstruction } from "./suggestions.js";
import { generate } from "./provider.js";
import type { Store } from "./store.js";
const turn = z.object({
  input: z.string().trim().min(1).max(20000),
  budget: z.number().int().min(2048).max(128000).default(8192),
  reserve: z.number().int().min(64).max(8192).default(1024),
  config: z.object({
    baseUrl: z.string().url(),
    apiKey: z.string().max(4096),
    model: z.string().min(1),
    mock: z.boolean(),
  }),
});
export function createApp(store: Store) {
  const app = new Hono();
  const busy = new Set<string>();
  const controllers = new Map<string, AbortController>();
  app.use("*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (
      origin &&
      !["http://127.0.0.1:5173", "http://localhost:5173"].includes(origin)
    )
      return c.json({ error: "来源不允许" }, 403);
    await next();
  });
  app.onError((e, c) =>
    c.json(
      { error: e instanceof z.ZodError ? "输入格式不正确" : e.message },
      400,
    ),
  );
  app.get("/api/cards", (c) => c.json(store.cards()));
  app.post("/api/cards", async (c) => {
    const result = importCard(await c.req.json());
    return c.json({ id: store.addCard(result), ...result });
  });
  app.get("/api/sessions", (c) => c.json(store.sessions()));
  app.post("/api/sessions", async (c) => {
    const { cardId } = z
      .object({ cardId: z.string() })
      .parse(await c.req.json());
    const item = store.cards().find((x) => x.id === cardId);
    if (!item) throw new Error("作品不存在");
    return c.json({
      id: store.create(
        cardId,
        item.card.data.first_mes
          ? [
              {
                role: "assistant",
                content: expand(item.card.data.first_mes, item.card.data.name),
              },
            ]
          : [],
      ),
    });
  });
  app.get("/api/sessions/:id", (c) => c.json(store.session(c.req.param("id"))));
  app.post("/api/sessions/:id/preferences", async (c) => {
    const id = c.req.param("id");
    const { suggestions } = z
      .object({ suggestions: z.boolean() })
      .parse(await c.req.json());
    if (busy.has(id)) return c.json({ error: "请在生成结束后修改设置" }, 409);
    store.setSuggestions(id, suggestions);
    return c.json({ suggestions });
  });
  app.post("/api/sessions/:id/stop", (c) => {
    controllers.get(c.req.param("id"))?.abort();
    return c.json({ stopped: true });
  });
  app.post("/api/sessions/:id/turn", async (c) => {
    const id = c.req.param("id");
    if (busy.has(id)) return c.json({ error: "该存档正在生成" }, 409);
    const body = turn.parse(await c.req.json());
    const session = store.session(id);
    const item = store.cards().find((x) => x.id === session.cardId);
    if (!item) throw new Error("作品不存在");
    const runtimeCard = session.suggestions
      ? {
          ...item.card,
          data: {
            ...item.card.data,
            post_history_instructions: [
              item.card.data.post_history_instructions,
              suggestionInstruction,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        }
      : item.card;
    const prompt = buildContext(
      runtimeCard,
      session.messages,
      body.input,
      body.budget,
      body.reserve,
    );
    // Recheck after the asynchronous body read before acquiring the turn.
    if (busy.has(id)) return c.json({ error: "该存档正在生成" }, 409);
    busy.add(id);
    const controller = new AbortController();
    controllers.set(id, controller);
    c.header("Content-Type", "application/x-ndjson");
    return stream(c, async (s) => {
      s.onAbort(() => controller.abort());
      try {
        await s.write(JSON.stringify({ type: "prompt", prompt }) + "\n");
        let reply = "";
        for await (const text of generate(
          body.config,
          prompt.messages,
          body.reserve,
          controller.signal,
        )) {
          reply += text;
          if (reply.length > 100000) throw new Error("回复过长");
          await s.write(JSON.stringify({ type: "delta", text }) + "\n");
        }
        if (!reply.trim()) throw new Error("模型返回空回复");
        controller.signal.throwIfAborted();
        const parsed = session.suggestions
          ? parseSuggestions(reply)
          : { text: reply, suggestions: [] };
        store.save(id, [
          ...session.messages,
          { role: "user", content: body.input },
          {
            role: "assistant",
            content: parsed.text,
            suggestions: parsed.suggestions,
            raw: reply,
          },
        ]);
        await s.write(JSON.stringify({ type: "done" }) + "\n");
      } catch {
        await s.write(
          JSON.stringify({
            type: "error",
            error:
              "生成未完成，本轮未保存。请检查 API 配置、输出预算和网络后重试。",
          }) + "\n",
        );
      } finally {
        busy.delete(id);
        controllers.delete(id);
      }
    });
  });
  return app;
}
