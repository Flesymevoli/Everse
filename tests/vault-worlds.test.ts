import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { Store } from "../server/store.js";
import { ConnectionVault } from "../server/connection-vault.js";
import { windowsProtector } from "../server/secrets.js";
import { createApp } from "../server/app.js";
import { importWorld } from "../server/worlds.js";
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test(
  "Windows DPAPI: 加密后重开可用、替换删除、密钥不回传且不明文落盘",
  { skip: process.platform !== "win32" },
  async () => {
    const folder = mkdtempSync(join(tmpdir(), "yuno-vault-"));
    const path = join(folder, "test.sqlite");
    let store = new Store(path);
    try {
      let vault = new ConnectionVault(store, windowsProtector);
      const key = "local-test-credential-not-a-real-key";
      const profile = {
        id: "one",
        name: "本地测试",
        baseUrl: "http://127.0.0.1:1234/v1",
        model: "test",
      };
      const saved = await vault.save({ ...profile, apiKey: key });
      assert.equal(saved.hasKey, true);
      assert.ok(!JSON.stringify(vault.list()).includes(key));
      assert.ok(
        !String(
          store.db.prepare("SELECT secret FROM connections").get()?.secret,
        ).includes(key),
      );
      store.close();
      assert.ok(!readFileSync(path).includes(Buffer.from(key)));
      store = new Store(path);
      vault = new ConnectionVault(store, windowsProtector);
      assert.equal((await vault.config("one")).apiKey, key);
      await assert.rejects(
        vault.save({ ...profile, baseUrl: "http://127.0.0.1:5678/v1" }),
        /重新填写/,
      );
      await vault.save({ ...profile, model: "next" });
      assert.equal((await vault.config("one")).apiKey, key);
      await vault.save({ ...profile, apiKey: "replacement-local-test" });
      assert.equal(
        (await vault.config("one")).apiKey,
        "replacement-local-test",
      );
      vault.clearKey("one");
      assert.equal((await vault.config("one")).apiKey, "");
      vault.delete("one");
      assert.deepEqual(vault.list(), []);
    } finally {
      store.close();
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
test("保存连接只在后端解密：请求不能覆盖目标地址；跨站与非 JSON 写入被拒绝", async () => {
  const protector = {
    protect: async (v: string) => "encrypted:" + v,
    unprotect: async (v: string) => v.slice(10),
  };
  let captured = "";
  let model = "";
  const server = createServer(async (req, res) => {
    captured = req.headers.authorization ?? "";
    let text = "";
    for await (const chunk of req) text += chunk;
    model = JSON.parse(text).model;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      'data: {"choices":[{"delta":{"content":"本地正文"}}]}\n\ndata: [DONE]\n\n',
    );
  });
  const store = new Store(":memory:");
  try {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    assert.ok(addr && typeof addr !== "string");
    const app = createApp(store, protector);
    assert.equal(
      (
        await app.request("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "{}",
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await app.request("/api/connections", {
          headers: { origin: "https://other.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await app.request("http://rebind.example/api/connections")).status,
      403,
    );
    const body = {
      id: "test",
      name: "测试",
      baseUrl: `http://127.0.0.1:${addr.port}/v1`,
      model: "saved-model",
      apiKey: "fake-test-token",
    };
    const saved = await post(app, "/api/connections", body);
    assert.ok(!(await saved.text()).includes("fake-test-token"));
    const world = (await (
      await post(app, "/api/worlds", {
        original: { spec: "yuno_world_v1", data: { name: "世界" } },
      })
    ).json()) as { id: string };
    const session = (await (
      await post(app, "/api/sessions", { worldId: world.id })
    ).json()) as { id: string };
    const turn = await post(app, "/api/sessions/" + session.id + "/turn", {
      input: "开始",
      connectionId: "test",
      config: {
        baseUrl: "http://127.0.0.1:1",
        model: "wrong",
        apiKey: "wrong",
        mock: false,
      },
    });
    const events = await turn.text();
    assert.match(events, /"type":"done"/);
    assert.ok(!events.includes("fake-test-token"));
    assert.equal(captured, "Bearer fake-test-token");
    assert.equal(model, "saved-model");
  } finally {
    store.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("世界与角色组合、纯世界、旧存档、分支和重开保持兼容", async () => {
  const folder = mkdtempSync(join(tmpdir(), "yuno-worlds-"));
  let store = new Store(join(folder, "test.sqlite"));
  try {
    let app = createApp(store);
    const world = (await (
      await post(app, "/api/worlds", {
        original: {
          spec: "yuno_world_v1",
          data: {
            name: "海岛",
            description: "海岛常年下雪",
            first_mes: "世界开场",
            worldbook: {
              entries: { a: { constant: true, content: "港口封闭" } },
            },
          },
        },
      })
    ).json()) as { id: string };
    const character = (await (
      await post(app, "/api/cards", {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: { name: "阿明", description: "修灯的人", first_mes: "角色开场" },
      })
    ).json()) as { id: string };
    const legacy = (await (
      await post(app, "/api/sessions", { cardId: character.id })
    ).json()) as { id: string };
    assert.equal(store.session(legacy.id).messages[0].content, "角色开场");
    const joined = (await (
      await post(app, "/api/sessions", {
        cardId: character.id,
        worldId: world.id,
      })
    ).json()) as { id: string };
    assert.equal(store.session(joined.id).messages[0].content, "世界开场");
    const result = await post(app, "/api/sessions/" + joined.id + "/turn", {
      input: "看看",
      config: {
        baseUrl: "http://localhost",
        model: "mock",
        apiKey: "",
        mock: true,
      },
    });
    const events = (await result.text())
      .trim()
      .split("\n")
      .map((v) => JSON.parse(v));
    assert.ok(events.some((e) => e.type === "done"));
    const texts = events[0].prompt.messages
      .map((m: { content: string }) => m.content)
      .join("\n");
    for (const text of ["海岛常年下雪", "港口封闭", "修灯的人"])
      assert.ok(texts.includes(text));
    const branch = (await (
      await post(app, "/api/sessions/" + joined.id + "/branch", { count: 3 })
    ).json()) as { id: string };
    assert.equal(store.session(branch.id).options.worldId, world.id);
    assert.equal((await post(app, "/api/sessions", {})).status, 400);
    assert.equal(
      (
        await post(app, "/api/sessions", {
          cardId: character.id,
          worldId: "missing",
        })
      ).status,
      400,
    );
    store.close();
    store = new Store(join(folder, "test.sqlite"));
    assert.equal(store.session(joined.id).options.worldId, world.id);
    assert.equal(store.session(joined.id).messages.length, 3);
    assert.equal(store.worlds()[0].world.data.description, "海岛常年下雪");
    const raw = {
      entries: { one: { constant: true, content: "几个字", future: true } },
    };
    const imported = importWorld(raw, "极简世界");
    assert.deepEqual(imported.original, raw);
    assert.ok(imported.warnings.some((w) => w.includes("future")));
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
test("角色卡编辑保留高级字段和原聊天，下一轮使用新设定", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    const original = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "旧名字",
        description: "旧设定",
        first_mes: "原开场",
        extensions: { custom: { keep: ["原值"] } },
        system_prompt: "作者指令",
      },
    };
    const card = (await (await post(app, "/api/cards", original)).json()) as {
      id: string;
    };
    const session = (await (
      await post(app, "/api/sessions", { cardId: card.id })
    ).json()) as { id: string };
    assert.equal(
      (
        await post(app, "/api/cards/" + card.id + "/edit", {
          name: "新名字",
          description: "新设定",
          first_mes: "新开场",
          personality: "沉静",
          scenario: "山上",
        })
      ).status,
      200,
    );
    const exported = (await (
      await app.request("/api/cards/" + card.id + "/export")
    ).json()) as typeof original;
    assert.deepEqual(exported.data.extensions, original.data.extensions);
    assert.equal(exported.data.system_prompt, "作者指令");
    assert.equal(store.session(session.id).messages[0].content, "原开场");
    const response = await post(app, "/api/sessions/" + session.id + "/turn", {
      input: "继续",
      config: {
        mock: true,
        baseUrl: "http://localhost",
        apiKey: "",
        model: "mock",
      },
    });
    const text = await response.text();
    assert.match(text, /新设定/);
    assert.match(text, /沉静/);
    assert.match(text, /"type":"done"/);
    const next = (await (
      await post(app, "/api/sessions", { cardId: card.id })
    ).json()) as { id: string };
    assert.equal(store.session(next.id).messages[0].content, "新开场");
    assert.equal(
      (await post(app, "/api/cards/" + card.id + "/edit", { name: " " }))
        .status,
      400,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS count FROM card_revisions").get()
        ?.count,
      1,
    );
  } finally {
    store.close();
  }
});
