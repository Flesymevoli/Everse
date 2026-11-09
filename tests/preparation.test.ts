import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import type { Preparation } from "../shared/preparation.js";
const config = {
  mock: true,
  model: "mock",
  baseUrl: "http://localhost",
  apiKey: "",
};
const draft: Preparation = {
  characterMode: "simple",
  worldMode: "simple",
  cardId: "",
  worldId: "",
  character: { name: "店主", description: "喜欢读书" },
  world: { name: "雨城", description: "只在深夜营业的书店" },
  player: { name: "小雨", description: "寻找旧友" },
  opening: "{{user}}推开门。",
  presetId: null,
  worldbookId: null,
};
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("从零存档：保存准备/重开/确认开场/首轮互动；不覆盖原有资源或重复开局", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yuno-prep-"));
  let store = new Store(join(dir, "test.sqlite"));
  try {
    let app = createApp(store);
    const created = (await (
      await post(app, "/api/sessions", { prepare: true })
    ).json()) as { id: string };
    const path = "/api/sessions/" + created.id;
    assert.equal(store.session(created.id).options.openingState, "preparing");
    assert.equal(
      (await post(app, path + "/turn", { input: "提前发送", config })).status,
      400,
    );
    assert.equal(
      (await post(app, path + "/start", { ...draft, opening: " " })).status,
      400,
    );
    assert.equal(store.cards().length, 0);
    assert.equal((await post(app, path + "/preparation", draft)).status, 200);
    store.close();
    store = new Store(join(dir, "test.sqlite"));
    app = createApp(store);
    assert.deepEqual(store.session(created.id).options.openingDraft, draft);
    assert.equal((await post(app, path + "/start", draft)).status, 200);
    assert.equal(store.session(created.id).messages[0].content, "小雨推开门。");
    assert.equal(store.session(created.id).options.player?.name, "小雨");
    assert.equal(store.cards().length, 1);
    assert.equal(store.worlds().length, 1);
    assert.equal((await post(app, path + "/start", draft)).status, 400);
    assert.equal(store.cards().length, 1);
    const response = await post(app, path + "/turn", {
      input: "问店主好",
      config,
    });
    const events = await response.text();
    assert.match(events, /"type":"done"/);
    assert.match(events, /寻找旧友/);
    assert.equal(store.session(created.id).messages.length, 3);
    const snapshot = JSON.stringify(store.session(created.id));
    assert.equal((await post(app, path + "/preparation", draft)).status, 400);
    assert.equal(JSON.stringify(store.session(created.id)), snapshot);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("现有角色备选开场与玩家身份仅存当前存档，原始卡片和预设保留", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    const original = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "灯",
        first_mes: "默认",
        alternate_greetings: ["{{user}}抬头看到{{char}}。"],
        description: "角色描述",
        extensions: { untouched: true },
      },
    };
    const card = (await (await post(app, "/api/cards", original)).json()) as {
      id: string;
    };
    const session = (await (
      await post(app, "/api/sessions", { cardId: card.id, prepare: true })
    ).json()) as { id: string };
    const d = {
      ...draft,
      characterMode: "existing",
      cardId: card.id,
      worldMode: "none",
      opening: original.data.alternate_greetings[0] + " 自定义补充。",
    };
    assert.equal(
      (await post(app, "/api/sessions/" + session.id + "/start", d)).status,
      200,
    );
    assert.equal(
      store.session(session.id).messages[0].content,
      "小雨抬头看到灯。 自定义补充。",
    );
    assert.deepEqual(store.cards()[0].original, original);
    assert.equal(
      (
        await post(app, "/api/sessions/" + session.id + "/greeting", {
          index: 0,
        })
      ).status,
      400,
    );
  } finally {
    store.close();
  }
});
test("主动生成只保存准备草稿；取消/失败保留原文，无自动付费重试", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    const session = (await (
      await post(app, "/api/sessions", { prepare: true })
    ).json()) as { id: string };
    const path = "/api/sessions/" + session.id;
    const response = await post(app, path + "/opening", { draft, config });
    assert.equal(response.status, 200);
    const result = (await response.json()) as { opening: string };
    assert.match(result.opening, /模拟回复/);
    assert.equal(store.session(session.id).messages.length, 0);
    assert.equal(store.session(session.id).options.openingState, "preparing");
    assert.equal(
      store.session(session.id).options.openingDraft?.opening,
      result.opening,
    );
    const failed = await post(app, path + "/opening", {
      draft,
      config: { ...config, mock: false, baseUrl: "http://127.0.0.1:1" },
    });
    assert.equal(failed.status, 400);
    assert.equal(
      store.session(session.id).options.openingDraft?.opening,
      draft.opening,
    );
    assert.equal(store.session(session.id).messages.length, 0);
    const pending = post(app, path + "/opening", { draft, config });
    await new Promise((r) => setTimeout(r, 20));
    await post(app, path + "/stop", {});
    assert.equal((await pending).status, 400);
    assert.equal(
      store.session(session.id).options.openingDraft?.opening,
      draft.opening,
    );
  } finally {
    store.close();
  }
});
test("新建作品进入准备；旧空白存档可补开场；历史存档不可重写", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    const created = (await (
      await post(app, "/api/creations", {
        kind: "worlds",
        description: "背景",
        opening: "",
        prepare: true,
      })
    ).json()) as { sessionId: string };
    assert.equal(
      store.session(created.sessionId).options.openingState,
      "preparing",
    );
    const old = store.create("", []);
    assert.equal(
      (await post(app, "/api/sessions/" + old + "/start", draft)).status,
      200,
    );
    const legacy = store.create("", [{ role: "assistant", content: "旧故事" }]);
    assert.equal(
      (await post(app, "/api/sessions/" + legacy + "/start", draft)).status,
      400,
    );
    assert.equal(store.session(legacy).messages[0].content, "旧故事");
  } finally {
    store.close();
  }
});
test("字段错误明确指出回复预算/模型字段，不回显 API Key", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    const id = store.create("", []);
    const invalid = await post(app, "/api/sessions/" + id + "/opening", {
      draft,
      config,
      reserve: 0,
    });
    assert.equal(invalid.status, 400);
    assert.match(
      ((await invalid.json()) as { error: string }).error,
      /回复上限.*64/,
    );
    const invalidKey = await post(app, "/api/sessions/" + id + "/opening", {
      draft,
      config: { ...config, apiKey: "not-real-sensitive-value".repeat(300) },
    });
    const text = await invalidKey.text();
    assert.match(text, /API Key/);
    assert.ok(!text.includes("not-real-sensitive-value"));
  } finally {
    store.close();
  }
});
