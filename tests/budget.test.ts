import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { importCard } from "../server/cards.js";
import { buildContext } from "../server/context.js";
import { resolveBudget } from "../server/budget.js";
import { importPreset } from "../server/preset.js";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";

test("自动预算保留长中文设定；仅裁剪请求历史；明确报告手动/预设冲突", () => {
  const card = importCard({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: { name: "测试", description: "中文背景".repeat(2000) },
  }).card;
  assert.throws(() => buildContext(card, [], "开场"), /本地配置/);
  const history = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 ? ("assistant" as const) : ("user" as const),
    content: "历史".repeat(1000),
  }));
  const original = structuredClone(history);
  const p = buildContext(card, history, "开场", 8192, 1024, {
    automaticBudget: true,
  });
  assert.ok(p.budget > 8192);
  assert.ok(p.omitted > 0);
  assert.deepEqual(history, original);
  assert.ok(p.messages.some((m) => m.content.includes(card.data.description)));
  assert.throws(() => resolveBudget(100, 200), /配置冲突/);
  assert.equal(resolveBudget(undefined, undefined).maxTokens, undefined);
  const preset = importPreset({
    openai_max_context: 1000000,
    openai_max_tokens: 64000,
  }).original;
  assert.equal(
    resolveBudget(undefined, undefined, preset as { openai_max_tokens: number })
      .maxTokens,
    64000,
  );
});

test("长设定开场真实 HTTP：自动省略输出限制，手动及预设大值传递；API 拒绝安全报告且不重试", async () => {
  const requests: Record<string, unknown>[] = [];
  let reject = false;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    requests.push(JSON.parse(raw));
    if (reject) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: "context_length_exceeded",
            message: "private-prompt-and-key",
          },
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      'data: {"choices":[{"delta":{"content":"开场成功"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const store = new Store(":memory:");
  const app = createApp(store);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const id = store.create("", []);
  const draft = {
    characterMode: "none",
    worldMode: "simple",
    cardId: "",
    worldId: "",
    character: { name: "", description: "" },
    world: { name: "世界", description: "中文背景".repeat(2000) },
    player: { name: "", description: "" },
    opening: "",
    presetId: null,
    worldbookId: null,
  };
  const config = {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "",
    model: "test",
    mock: false,
  };
  try {
    let r = await post(`/api/sessions/${id}/opening`, { draft, config });
    assert.equal(r.status, 200);
    assert.equal(requests.length, 1);
    assert.equal(Object.hasOwn(requests[0], "max_tokens"), false);
    const result = (await r.json()) as {
      opening: string;
      prompt: { budget: number };
    };
    assert.ok(result.prompt.budget > 8192);
    assert.equal(result.opening, "开场成功");
    r = await post(`/api/sessions/${id}/opening`, {
      draft,
      config,
      budget: 1000000,
      reserve: 64000,
    });
    assert.equal(r.status, 200);
    assert.equal(requests[1].max_tokens, 64000);
    reject = true;
    r = await post(`/api/sessions/${id}/opening`, { draft, config });
    assert.equal(r.status, 400);
    const text = await r.text();
    assert.match(text, /供应商报告上下文过长/);
    assert.ok(!text.includes("private-prompt-and-key"));
    assert.equal(requests.length, 3);
    assert.equal(store.session(id).messages.length, 0);
  } finally {
    store.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
