import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { buildContext } from "../server/context.js";
import { importCard } from "../server/cards.js";
import { promptModuleSchema } from "../shared/prompt-modules.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const value = {
  name: "简洁文风",
  content: "采用简洁的句子",
  enabled: true,
  kind: "preset",
  position: "prefix",
  trigger: "always",
  scope: "global",
  priority: 0,
  order: 0,
};
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request("/api/" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
test("模块 CRUD、复制关闭、导入导出与重启持久化；不静默接受高级格式", async () => {
  const dir = mkdtempSync(join(tmpdir(), "everse-modules-"));
  let store = new Store(join(dir, "game.sqlite"));
  try {
    let app = createApp(store);
    const created = await post(app, "prompt-modules", value);
    assert.equal(created.status, 200);
    const { id } = await created.json();
    assert.equal(
      (
        await post(app, `prompt-modules/${id}`, {
          ...value,
          position: "suffix",
          content: "只写正文",
        })
      ).status,
      200,
    );
    const copy = await (
      await post(app, `prompt-modules/${id}/copy`, {})
    ).json();
    assert.equal(copy.enabled, false);
    assert.equal(copy.content, "只写正文");
    const file = await (await app.request("/api/prompt-modules/export")).json();
    assert.equal(file.modules.length, 2);
    assert.equal(
      (await post(app, "prompt-modules/import", { ...file, unexpected: true }))
        .status,
      400,
    );
    assert.equal(
      (
        await post(app, "prompt-modules", {
          ...value,
          trigger: "keyword",
          keys: ["雨"],
        })
      ).status,
      400,
    );
    assert.equal(
      (await post(app, "prompt-modules", { ...value, scope: "session" }))
        .status,
      400,
    );
    assert.equal((await post(app, "prompt-modules/import", file)).status, 200);
    assert.equal(
      (await post(app, `prompt-modules/${id}/delete`, {})).status,
      400,
    );
    assert.equal(
      (await post(app, `prompt-modules/${id}/delete`, { confirm: true }))
        .status,
      200,
    );
    store.close();
    store = new Store(join(dir, "game.sqlite"));
    app = createApp(store);
    const modules = await (await app.request("/api/prompt-modules")).json();
    assert.equal(modules.length, 3);
    assert.ok(modules.every((m: { enabled: boolean }) => !m.enabled));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("模块真实参与预算和请求；前后置与酒馆顺序独立，关闭完全移除", async () => {
  const card = importCard({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: { name: "灯", description: "守灯人" },
  }).card;
  const modules = [
    {
      ...promptModuleSchema.parse(value),
      id: "prefix",
      content: "{{char}}前置",
    },
    {
      ...promptModuleSchema.parse({
        ...value,
        name: "后置",
        position: "suffix",
        priority: 2,
      }),
      id: "suffix",
      content: "后置",
    },
    {
      ...promptModuleSchema.parse({ ...value, name: "关闭", enabled: false }),
      id: "off",
      content: "不应出现",
    },
  ];
  const preset = {
    prompts: [
      { identifier: "main", content: "酒馆主提示" },
      { identifier: "chatHistory", marker: true },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "chatHistory", enabled: true },
        ],
      },
    ],
  };
  const result = buildContext(card, [], "行动", 8192, 100, {
    promptModules: modules,
    preset,
  });
  assert.deepEqual(
    result.messages.map((m) => m.content),
    ["灯前置", "酒馆主提示", "行动", "后置"],
  );
  assert.equal(result.activeModules.length, 2);
  assert.throws(
    () => buildContext(card, [], "行动", 30, 0, { promptModules: modules }),
    /预算/,
  );
  const store = new Store(":memory:");
  try {
    const cardId = store.addCard({ card, warnings: [] }),
      id = store.create(cardId, [{ role: "assistant", content: "灯亮了" }]);
    const app = createApp(store);
    const mod = await (await post(app, "prompt-modules", value)).json();
    async function turn() {
      const response = await post(app, `sessions/${id}/turn`, {
        input: "向前",
        config: {
          baseUrl: "http://localhost",
          apiKey: "",
          model: "test",
          mock: true,
        },
      });
      return (await response.text())
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s));
    }
    let events = await turn();
    assert.ok(events.some((e) => e.type === "done"));
    assert.equal(
      events.find((e) => e.type === "prompt").prompt.messages[0].content,
      value.content,
    );
    await post(app, `prompt-modules/${mod.id}`, { ...value, enabled: false });
    events = await turn();
    assert.deepEqual(
      events.find((e) => e.type === "prompt").prompt.activeModules,
      [],
    );
    assert.ok(
      !events
        .find((e) => e.type === "prompt")
        .prompt.messages.some(
          (m: { content: string }) => m.content === value.content,
        ),
    );
  } finally {
    store.close();
  }
});
