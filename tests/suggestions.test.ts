import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSuggestions, readingDraft } from "../server/suggestions.js";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
test("旧数据库增加偏好表后原文不变，重开仍记住开关", () => {
  const dir = mkdtempSync(join(tmpdir(), "suggestions-"));
  const path = join(dir, "test.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(
    "CREATE TABLE sessions(id TEXT PRIMARY KEY,cardId TEXT NOT NULL,messages TEXT NOT NULL); INSERT INTO sessions VALUES ('old','card','[]')",
  );
  legacy.close();
  let store = new Store(path);
  try {
    assert.equal(store.session("old").suggestions, false);
    store.setSuggestions("old", true);
    store.close();
    store = new Store(path);
    assert.equal(store.session("old").suggestions, true);
    assert.deepEqual(store.session("old").messages, []);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("停止生成不提交半轮", async () => {
  const store = new Store(":memory:");
  const app = createApp(store);
  const card = store.addCard({
    card: {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "人物",
        description: "",
        personality: "",
        scenario: "",
        first_mes: "",
        system_prompt: "",
        post_history_instructions: "",
      },
    },
    warnings: [],
  });
  const id = store.create(card, []);
  try {
    const response = await app.request("/api/sessions/" + id + "/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: "继续",
        config: {
          baseUrl: "http://127.0.0.1:1/v1",
          apiKey: "",
          model: "mock",
          mock: true,
        },
      }),
    });
    const reader = response.body!.getReader();
    await reader.read();
    await app.request("/api/sessions/" + id + "/stop", { method: "POST" });
    while (!(await reader.read()).done) {}
    assert.equal(store.session(id).messages.length, 0);
  } finally {
    store.close();
  }
});
test("建议只接受末尾边界内的 2～3 个短字符串，失败保留原文", () => {
  const raw = '正文\n<action_suggestions>["看看","等等"]</action_suggestions>';
  assert.deepEqual(parseSuggestions(raw), {
    text: "正文",
    suggestions: ["看看", "等等"],
  });
  for (const bad of [
    "正文",
    "正文\n<action_suggestions>invalid</action_suggestions>",
    '正文\n<action_suggestions>["一"]</action_suggestions>',
  ])
    assert.equal(parseSuggestions(bad).text, bad);
  assert.equal(readingDraft("正文\n<action_sug"), "正文");
});
test("旧存档默认关闭；启用持久化；同次生成建议；关闭无提示词", async () => {
  const store = new Store(":memory:");
  const app = createApp(store);
  const id = store.addCard({
    card: {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "人物",
        description: "",
        personality: "",
        scenario: "",
        first_mes: "",
        system_prompt: "",
        post_history_instructions: "",
      },
    },
    warnings: [],
  });
  const save = store.create(id, []);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const body = {
    input: "继续",
    config: {
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "",
      model: "mock",
      mock: true,
    },
  };
  try {
    assert.equal(store.session(save).suggestions, false);
    await post("/api/sessions/" + save + "/preferences", { suggestions: true });
    assert.equal(store.session(save).suggestions, true);
    const enabled = await (
      await post("/api/sessions/" + save + "/turn", body)
    ).text();
    assert.match(enabled, /action_suggestions/);
    assert.equal(store.session(save).messages.at(-1)?.suggestions?.length, 2);
    await post("/api/sessions/" + save + "/preferences", {
      suggestions: false,
    });
    const disabled = await (
      await post("/api/sessions/" + save + "/turn", body)
    ).text();
    assert.doesNotMatch(disabled, /action_suggestions/);
  } finally {
    store.close();
  }
});
