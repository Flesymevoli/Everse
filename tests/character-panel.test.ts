import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { parseNarrative, readStory, historyKey } from "../server/story.js";
import { editRevision } from "../server/text-edit.js";
import { settingContext, mergeSettingEdit } from "../server/setting-sync.js";
import { characterGroups } from "../shared/character-panel.js";
import { selectVariant } from "../shared/swipes.js";
import type { Message } from "../server/context.js";
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("作品面板字段来自同轮正文；物品复用键更新，手动修正保留分组，坏辅助状态不阻塞正文", () => {
  const store = new Store(":memory:");
  try {
    const first = "林是炼气三层。他收下12枚灵石。";
    const changes = [
      {
        key: "lin.realm",
        kind: "person",
        value: "炼气三层",
        evidence: "林是炼气三层",
        panel: { group: "character", entity: "林", label: "境界" },
      },
      {
        key: "lin.stone",
        kind: "fact",
        value: "12枚",
        evidence: "12枚灵石",
        panel: { group: "inventory", entity: "林", label: "灵石" },
      },
    ];
    const p = parseNarrative(
      first +
        "<story_update>" +
        JSON.stringify({ changes }) +
        "</story_update>",
      [],
    );
    const history: Message[] = [
      { role: "assistant", content: p.text, story: p.story },
    ];
    const next = "林用了3枚灵石，还剩9枚。";
    const q = parseNarrative(
      next +
        "<story_update>" +
        JSON.stringify({
          changes: [{ ...changes[1], value: "9枚", evidence: "还剩9枚" }],
        }) +
        "</story_update>",
      history,
    );
    history.push({ role: "assistant", content: q.text, story: q.story });
    const id = store.create("", history);
    const groups = characterGroups(store.story(id).facts);
    assert.equal(groups.characters[0].attributes[0].panel?.label, "境界");
    assert.equal(groups.characters[0].inventory.length, 1);
    assert.equal(groups.characters[0].inventory[0].value, "9枚");
    store.correct(id, store.story(id).revision, "lin.stone", "8枚");
    assert.equal(
      characterGroups(store.story(id).facts).characters[0].inventory[0].value,
      "8枚",
    );
    const updated = parseNarrative(
      "林又用掉1枚灵石，还剩7枚。<story_update>" +
        JSON.stringify({
          changes: [
            {
              key: "lin.stone",
              kind: "fact",
              value: "7枚",
              evidence: "还剩7枚",
            },
          ],
        }) +
        "</story_update>",
      history,
    );
    store.save(id, [
      ...history,
      { role: "assistant", content: updated.text, story: updated.story },
    ]);
    assert.equal(
      characterGroups(store.story(id).facts).characters[0].inventory[0].value,
      "7枚",
    );
    const malformed = parseNarrative(
      "故事仍在继续。<story_update>" +
        JSON.stringify({
          changes: [{ ...changes[0], panel: { group: "hp" } }],
        }) +
        "</story_update>",
      history,
    );
    assert.equal(malformed.text, "故事仍在继续。");
    assert.ok(malformed.warning);
  } finally {
    store.close();
  }
});

test("同步开关按确认写入：关闭不注入，开启实际进入后续请求，撤销/Swipe不串设定", async () => {
  const store = new Store(":memory:"),
    app = createApp(store),
    id = store.create("", [{ role: "assistant", content: "她离开了书店。" }]);
  store.setOptions(id, {
    storySource: { name: "雨城", format: "text", text: "雨城" },
    openingState: "started",
    storyTracking: false,
  });
  const select = () => ({
    index: 0,
    start: 0,
    end: store.session(id).messages[0].content.length,
    original: store.session(id).messages[0].content,
    revision: editRevision(store, id),
  });
  try {
    assert.equal(
      (
        await post(app, `sessions/${id}/edit-selection`, {
          selection: select(),
          replacement: "她还在书店。",
        })
      ).status,
      200,
    );
    assert.equal(settingContext(store.session(id).messages, "她").text, "");
    assert.equal(
      (
        await post(app, `sessions/${id}/edit-selection`, {
          selection: select(),
          replacement: "她留在书店等你。",
          syncSettings: true,
        })
      ).status,
      200,
    );
    assert.match(
      settingContext(store.session(id).messages, "书店").text,
      /她留在书店等你/,
    );
    const msg = store.session(id).messages[0];
    assert.equal(
      selectVariant(
        {
          ...msg,
          variants: [
            { content: msg.content, settingOverride: true },
            { content: "另一个候选" },
          ],
        },
        1,
      ).settingOverride,
      undefined,
    );
    const fork = await post(app, `sessions/${id}/branch`, { count: 1 });
    assert.match(
      settingContext(store.session((await fork.json()).id).messages, "书店")
        .text,
      /她留在/,
    );
    const turn = await post(app, `sessions/${id}/turn`, {
      input: "她在哪里？",
      config: {
        mock: true,
        model: "mock",
        baseUrl: "http://localhost",
        apiKey: "",
      },
    });
    const events = (await turn.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const prompt = events.find((e) => e.type === "prompt");
    assert.match(JSON.stringify(prompt), /玩家确认同步的正文修订/);
    assert.match(JSON.stringify(prompt), /她留在书店等你/);
    // Undo is intentionally limited to unchanged narrative; test on the edit-only branch.
    const undoId = store.create("", [
      { role: "assistant", content: "灯亮了。" },
    ]);
    const sel = {
      index: 0,
      start: 0,
      end: 4,
      original: "灯亮了。",
      revision: editRevision(store, undoId),
    };
    await post(app, `sessions/${undoId}/edit-selection`, {
      selection: sel,
      replacement: "灯灭了。",
      syncSettings: true,
    });
    assert.ok(store.session(undoId).messages[0].settingOverride);
    store.undo(undoId);
    assert.equal(settingContext(store.session(undoId).messages, "灯").text, "");
  } finally {
    store.close();
  }
});

test("长修订原文不丢失，按需上下文预算有界，不阻断叙事", () => {
  const content = "其他设定。".repeat(1500) + "银钥匙藏在旧书店。";
  const messages: Message[] = [
    { role: "assistant", content, settingOverride: true },
  ];
  const before = historyKey(messages);
  const result = settingContext(messages, "银钥匙旧书店", 1200);
  assert.ok(result.omitted > 0);
  assert.ok(result.selected.some((c) => c.text.includes("银钥匙")));
  assert.ok(
    result.selected.reduce((n, c) => n + c.text.length + 80, 0) <= 1200,
  );
  assert.equal(messages[0].content, content);
  assert.equal(historyKey(messages), before);
});

test("连续同步保留其他修订、替换已修订选区并明确记录删除", () => {
  const first = mergeSettingEdit(undefined, "她走了。", "她留下。");
  const second = mergeSettingEdit(first, "灯灭。", "灯亮。");
  assert.match(second, /她留下/);
  assert.match(second, /灯亮/);
  const third = mergeSettingEdit(second, "她留下。", "她等你。");
  assert.ok(!third.includes("她留下。"));
  assert.match(third, /灯亮/);
  assert.match(third, /她等你/);
  assert.match(mergeSettingEdit(undefined, "旧约定。", ""), /删除/);
});
