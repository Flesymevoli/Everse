import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  restoreConnections,
  serializeConnections,
  resolveConnection,
  removeConnection,
  type Connections,
} from "../src/connections.js";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";
import { importCard } from "../server/cards.js";
test("连接元信息持久化但 Key 和付费选择不保存；删除当前连接回到模拟", () => {
  const state: Connections = {
    profiles: [
      {
        id: "a",
        name: "甲",
        baseUrl: "https://example.com/v1",
        model: "model-a",
        apiKey: "test-only-a",
      },
      {
        id: "b",
        name: "乙",
        baseUrl: "http://localhost:8000/v1",
        model: "model-b",
        apiKey: "test-only-b",
      },
    ],
    selectedId: "b",
  };
  const saved = serializeConnections(state);
  assert.ok(!saved.includes("apiKey"));
  assert.ok(!saved.includes("test-only"));
  assert.ok(!saved.includes("selectedId"));
  const restored = restoreConnections(saved);
  assert.equal(restored.profiles.length, 2);
  assert.equal(restored.profiles[0].name, "甲");
  assert.equal(restored.profiles[1].apiKey, "");
  assert.equal(resolveConnection(restored).mock, true);
  assert.equal(removeConnection(state, "a").selectedId, "b");
  assert.equal(removeConnection(state, "b").selectedId, null);
  assert.equal(
    resolveConnection({ ...state, selectedId: "a" }).model,
    "model-a",
  );
  assert.equal(resolveConnection(state).apiKey, "test-only-b");
  assert.throws(
    () => resolveConnection({ ...state, selectedId: "missing" }),
    /不存在/,
  );
  assert.deepEqual(restoreConnections("broken"), {
    profiles: [],
    selectedId: null,
  });
  assert.equal(
    restoreConnections(
      JSON.stringify([{ ...state.profiles[0], apiKey: "injected" }]),
    ).profiles[0].apiKey,
    "",
  );
});
test("非法 URL 和模型明确拒绝，带凭据 URL 不写入存储", () => {
  for (const baseUrl of [
    "javascript:alert(1)",
    "https://user:pass@example.com/v1",
    "https://example.com/v1?api_key=secret",
    "https://example.com/v1#secret",
  ]) {
    const state: Connections = {
      profiles: [{ id: "a", name: "甲", baseUrl, model: "m", apiKey: "" }],
      selectedId: "a",
    };
    assert.throws(() => resolveConnection(state), /Base URL/);
    assert.equal(JSON.parse(serializeConnections(state))[0].baseUrl, "");
  }
  assert.throws(
    () =>
      resolveConnection({
        profiles: [
          {
            id: "a",
            name: "甲",
            baseUrl: "https://example.com/v1",
            model: " ",
            apiKey: "",
          },
        ],
        selectedId: "a",
      }),
    /模型 ID/,
  );
});
test("切换连接后实际 HTTP 发往不同服务并使用各自模型与 Key", async () => {
  const captured: { model: string; auth: string; path: string }[] = [];
  const servers = [0, 1].map(() =>
    createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += String(chunk);
      captured.push({
        model: JSON.parse(raw).model,
        auth: req.headers.authorization ?? "",
        path: req.url ?? "",
      });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        'data: {"choices":[{"delta":{"content":"本地模拟正文"}}]}\n\ndata: [DONE]\n\n',
      );
    }),
  );
  const store = new Store(":memory:");
  try {
    for (const server of servers)
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
    const profiles = servers.map((server, i) => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      return {
        id: String(i),
        name: "测试" + i,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "model-" + i,
        apiKey: "test-only-" + i,
      };
    });
    const app = createApp(store);
    const cardId = store.addCard(
      importCard({
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: { name: "测试" },
      }),
    );
    const id = store.create(cardId, []);
    for (const selectedId of ["0", "1"]) {
      const response = await app.request("/api/sessions/" + id + "/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: "继续",
          config: resolveConnection({ profiles, selectedId }),
        }),
      });
      const events = await response.text();
      assert.match(events, /"type":"done"/);
      assert.ok(!events.includes("test-only-"));
    }
    assert.deepEqual(captured, [
      {
        model: "model-0",
        auth: "Bearer test-only-0",
        path: "/v1/chat/completions",
      },
      {
        model: "model-1",
        auth: "Bearer test-only-1",
        path: "/v1/chat/completions",
      },
    ]);
    assert.ok(!JSON.stringify(store.session(id)).includes("test-only-"));
  } finally {
    store.close();
    await Promise.all(
      servers.map(
        (s) => new Promise<void>((resolve) => s.close(() => resolve())),
      ),
    );
  }
});
