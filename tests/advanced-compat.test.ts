import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateBook } from "../server/worldbook.js";
import { buildContext } from "../server/context.js";
import { importCard } from "../server/cards.js";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";
import { importChat, exportChat } from "../server/chat-files.js";
import { selectVariant } from "../shared/swipes.js";
test("递归链、循环、排除、阻断、延迟与概率只抽取一次", () => {
  const entries = {
    a: { key: ["start"], content: "next" },
    b: { key: ["next"], content: "start" },
    c: { key: ["next"], content: "excluded", excludeRecursion: true },
    d: { key: ["next"], content: "delayed", delayUntilRecursion: 2 },
    e: { constant: true, content: "never", probability: 0 },
    f: { constant: true, content: "coin", probability: 50 },
  };
  let rolls = 0;
  const r = evaluateBook({ entries }, [], "start", 2, {
    recursive: true,
    random: () => {
      rolls++;
      return 0.9;
    },
  });
  assert.deepEqual(r.matched, ["a", "b", "d"]);
  assert.equal(rolls, 1);
  assert.deepEqual(r.failedProbability, ["e", "f"]);
  assert.deepEqual(
    evaluateBook(
      { entries: { ...entries, a: { ...entries.a, preventRecursion: true } } },
      [],
      "start",
      2,
      { recursive: true, random: () => 0.9 },
    ).matched,
    ["a"],
  );
  assert.deepEqual(
    evaluateBook({ entries }, [], "start", 2, { random: () => 0.1 }).matched,
    ["a", "f"],
  );
});
test("深度按原聊天计数，预设覆盖遵守 original、禁用与 forbid_overrides", () => {
  const card = importCard({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "灯",
      description: "人物",
      first_mes: "开场",
      system_prompt: "角色 {{original}}",
      post_history_instructions: "尾 {{original}}",
    },
  }).card;
  const preset = {
    prompts: [
      { identifier: "main", content: "基础" },
      { identifier: "jailbreak", content: "尾基础" },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "chatHistory", enabled: true },
          { identifier: "jailbreak", enabled: true },
        ],
      },
    ],
  };
  const worldbook = {
    entries: {
      a: { constant: true, content: "depth0", position: 4, depth: 0, role: 2 },
      b: { constant: true, content: "depth1", position: 4, depth: 1 },
      c: {
        constant: true,
        content: "depth99",
        position: 4,
        depth: 99,
        role: 1,
      },
    },
  };
  const context = buildContext(
    card,
    [{ role: "assistant", content: "开场" }],
    "行动",
    8192,
    128,
    { preset, worldbook, extraInstruction: "建议" },
  );
  assert.deepEqual(
    context.messages.map((m) => m.content),
    [
      "角色 基础",
      "depth99",
      "开场",
      "depth1",
      "行动",
      "depth0",
      "尾 尾基础",
      "建议",
    ],
  );
  assert.equal(context.messages[1].role, "user");
  assert.equal(context.messages[5].role, "assistant");
  assert.equal(
    buildContext(card, [], "行动", 8192, 128, {
      preset,
      preferCharacterPrompt: false,
    }).messages[0].content,
    "基础",
  );
  preset.prompts[0] = {
    ...preset.prompts[0],
    forbid_overrides: true,
  } as (typeof preset.prompts)[0];
  assert.equal(
    buildContext(card, [], "行动", 8192, 128, { preset }).messages[0].content,
    "基础",
  );
  preset.prompt_order[0].order[0].enabled = false;
  assert.ok(
    !buildContext(card, [], "行动", 8192, 128, { preset }).messages.some((m) =>
      m.content.includes("角色"),
    ),
  );
});
test("重新生成保留原文、Swipe 真正切换上下文、JSONL 往返及失败不覆盖", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    const post = (p: string, b: unknown) =>
      app.request(p, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
    const card = store.addCard(
      importCard({
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: { name: "灯", first_mes: "开场" },
      }),
    );
    const id = store.create(card, [
      { role: "assistant", content: "开场" },
      { role: "user", content: "行动" },
      { role: "assistant", content: "原文", raw: "完整原文" },
    ]);
    const path = "/api/sessions/" + id;
    const result = await post(path + "/turn", {
      mode: "regenerate",
      config: {
        mock: true,
        baseUrl: "http://127.0.0.1",
        apiKey: "",
        model: "mock",
      },
    });
    assert.match(await result.text(), /"type":"done"/);
    let messages = store.session(id).messages;
    assert.equal(messages.length, 3);
    assert.equal(messages[2].variants?.length, 2);
    assert.equal(messages[2].variants?.[0].raw, "完整原文");
    assert.equal(
      (await post(path + "/swipe", { messageIndex: 2, index: 0 })).status,
      200,
    );
    messages = store.session(id).messages;
    assert.equal(messages[2].content, "原文");
    const context = buildContext(store.cards()[0].card, messages, "下一轮");
    assert.ok(context.messages.some((m) => m.content === "原文"));
    const imported = importChat(exportChat(messages, {}, "灯"));
    assert.equal(
      selectVariant(imported.messages[2], 1).content,
      messages[2].variants?.[1].content,
    );
    const snapshot = JSON.stringify(messages);
    assert.equal(
      (await post(path + "/swipe", { messageIndex: 2, index: 99 })).status,
      400,
    );
    const failed = await post(path + "/turn", {
      mode: "regenerate",
      config: {
        mock: false,
        baseUrl: "http://127.0.0.1:1",
        apiKey: "",
        model: "test",
      },
    });
    assert.match(await failed.text(), /error/);
    assert.equal(JSON.stringify(store.session(id).messages), snapshot);
    store.edit(
      id,
      messages.map((m, i) => (i === 2 ? { ...m, content: "编辑" } : m)),
    );
    store.save(id, [...messages.slice(0, 2), selectVariant(messages[2], 1)]);
    assert.throws(() => store.undo(id), /新剧情/);
  } finally {
    store.close();
  }
});
