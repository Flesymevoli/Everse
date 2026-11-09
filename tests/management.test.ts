import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { importBook, evaluateBook } from "../server/worldbook.js";
import { importPreset } from "../server/preset.js";
import { importChat, exportChat } from "../server/chat-files.js";
const world = {
  entries: {
    a: {
      key: ["tower"],
      keysecondary: ["light"],
      selective: true,
      selectiveLogic: 0,
      content: "秘密",
      position: 0,
      order: 200,
      matchWholeWords: true,
    },
    b: { key: [], constant: true, content: "尾部设定", position: 1 },
    c: { constant: true, content: "不能出现", position: 5 },
  },
};
const preset = {
  temperature: 0.3,
  top_p: 0.8,
  openai_max_tokens: 128,
  openai_max_context: 8192,
  prompts: [
    { identifier: "main", role: "system", content: "预设文风" },
    { identifier: "unused", content: "不要出现" },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "worldInfoBefore", enabled: true },
        { identifier: "charDescription", enabled: true },
        { identifier: "worldInfoAfter", enabled: true },
        { identifier: "chatHistory", enabled: true },
        { identifier: "unused", enabled: false },
      ],
    },
  ],
};
test("新资源与存档设置在数据库重开后保留，编辑备份可恢复", () => {
  const folder = mkdtempSync(join(tmpdir(), "narrative-management-"));
  let store = new Store(join(folder, "data.sqlite"));
  try {
    const id = store.create("old-card", [
      { role: "assistant", content: "旧原文" },
    ]);
    const bookId = store.addAsset("worldbooks", "测试", importBook(world));
    store.setOptions(id, {
      worldbookId: bookId,
      parameters: { temperature: 0 },
      name: "保留",
    });
    store.edit(id, [{ role: "assistant", content: "新原文" }]);
    store.close();
    store = new Store(join(folder, "data.sqlite"));
    assert.equal(store.session(id).options.parameters?.temperature, 0);
    assert.deepEqual(store.assets("worldbooks")[0].original, world);
    store.undo(id);
    assert.equal(store.session(id).messages[0].content, "旧原文");
    store.edit(id, [{ role: "assistant", content: "再编辑" }]);
    store.save(id, [
      ...store.session(id).messages,
      { role: "user", content: "新剧情" },
    ]);
    assert.throws(() => store.undo(id), /新剧情/);
    assert.equal(store.session(id).messages.length, 2);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
test("世界书扫描、整词、选择逻辑、位置及未支持字段提示", () => {
  assert.ok(importBook(world).warnings.some((w) => w.includes("跳过")));
  assert.deepEqual(evaluateBook(world, [], "tower light").matched, ["a", "b"]);
  assert.deepEqual(evaluateBook(world, [], "towers light").matched, ["b"]);
  assert.deepEqual(
    evaluateBook(world, [{ role: "user", content: "tower light" }], "别处", 1)
      .matched,
    ["b"],
  );
  for (const [logic, expected] of [
    [0, true],
    [1, true],
    [2, false],
    [3, false],
  ] as const) {
    const book = {
      entries: {
        a: {
          ...world.entries.a,
          keysecondary: ["light", "dark"],
          selectiveLogic: logic,
        },
      },
    };
    assert.equal(
      evaluateBook(book, [], "tower light").matched.length > 0,
      expected,
    );
  }
  assert.throws(() => importBook({ entries: { a: { content: 3 } } }));
  assert.throws(() => importPreset({ ...preset, temperature: 8 }));
});
test("资源绑定到真实回环 HTTP 请求，参数覆盖、聊天编辑撤销分支归档", async () => {
  let captured: Record<string, unknown> = {};
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const part of req) text += String(part);
    captured = JSON.parse(text);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      'data: {"choices":[{"delta":{"content":"测试正文"}}]}\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const card = (await (
      await post("/api/cards", {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: { name: "灯", description: "人物描述", first_mes: "开场" },
      })
    ).json()) as { id: string };
    const session = (await (
      await post("/api/sessions", { cardId: card.id })
    ).json()) as { id: string };
    const book = (await (
      await post("/api/worldbooks", { name: "测试书", original: world })
    ).json()) as { id: string };
    const style = (await (
      await post("/api/presets", { name: "测试预设", original: preset })
    ).json()) as { id: string };
    assert.deepEqual(
      await (
        await app.request("/api/worldbooks/" + book.id + "/export")
      ).json(),
      world,
    );
    assert.equal(
      (
        await post("/api/sessions/" + session.id + "/options", {
          worldbookId: "missing",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/api/sessions/" + session.id + "/options", {
          name: "第一章",
          worldbookId: book.id,
          presetId: style.id,
          parameters: { temperature: 0, seed: 42, stop: ["END"] },
        })
      ).status,
      200,
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await post("/api/sessions/" + session.id + "/turn", {
      input: "tower light",
      config: {
        baseUrl: "http://127.0.0.1:" + address.port + "/v1",
        apiKey: "",
        model: "test",
        mock: false,
      },
    });
    const events = await response.text();
    assert.match(events, /"type":"done"/);
    assert.equal(captured.temperature, 0);
    assert.equal(captured.top_p, 0.8);
    assert.equal(captured.seed, 42);
    assert.deepEqual(captured.stop, ["END"]);
    assert.equal(captured.max_tokens, 128);
    assert.deepEqual(
      (captured.messages as { content: string }[]).map((m) => m.content),
      ["预设文风", "秘密", "人物描述", "尾部设定", "开场", "tower light"],
    );
    const path = "/api/sessions/" + session.id;
    await post(path + "/edit", { index: 2, content: "修改正文" });
    assert.equal(store.session(session.id).messages[2].content, "修改正文");
    await post(path + "/undo", {});
    assert.equal(store.session(session.id).messages[2].content, "测试正文");
    const branch = (await (
      await post(path + "/branch", { count: 2 })
    ).json()) as { id: string };
    assert.equal(store.session(branch.id).messages.length, 2);
    assert.equal(store.session(session.id).messages.length, 3);
    await post(path + "/options", { archived: true });
    assert.equal(store.session(session.id).options.archived, true);
    assert.equal(store.session(branch.id).options.archived, false);
    const exported = await (await app.request(path + "/export")).text();
    const imported = (await (
      await post("/api/sessions/import", {
        cardId: card.id,
        name: "导入副本",
        text: exported,
      })
    ).json()) as { id: string };
    assert.equal(store.session(imported.id).messages[2].content, "测试正文");
  } finally {
    store.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("JSONL 保留头部、extra 与 swipe 数据，不将元数据发送给模型", () => {
  const header = { user_name: "读者", chat_metadata: { unknown: ["原样"] } };
  const rows = [
    {
      name: "角色",
      is_user: false,
      mes: "正文",
      swipe_id: 1,
      swipes: ["旧", "正文"],
      extra: { custom: true },
    },
  ];
  const parsed = importChat(
    [header, ...rows].map((row) => JSON.stringify(row)).join("\n"),
  );
  const exported = exportChat(parsed.messages, parsed.header, "角色")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(exported, [header, ...rows]);
  assert.throws(() => importChat('{"mes":"无头"}'));
});
