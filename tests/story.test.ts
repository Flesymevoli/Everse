import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import {
  historyKey,
  parseStory,
  readStory,
  storyContext,
  originalEvidence,
} from "../server/story.js";
import { visibleStory, type StoryFact } from "../shared/story.js";
import type { Message } from "../server/context.js";
import { appendVariant, selectVariant } from "../shared/swipes.js";
import {
  recoverOpening,
  confirmPreparation,
  savePreparation,
} from "../server/preparation.js";

test("引用兼容中文排版但不接受改写；保存的依据仍是逐字原文", () => {
  const text = "雨停了。\n\n 林走进书店。";
  assert.equal(originalEvidence(text, "雨停了。林走进书店。"), text);
  assert.equal(originalEvidence("some thing", "something"), null);
  assert.equal(originalEvidence(text, "林离开了书店。"), null);
  const parsed = parseStory(
    envelope(text, [
      { ...fact("雨停了。林走进书店。"), evidence: "雨停了。林走进书店。" },
    ]),
    [],
  );
  assert.equal(parsed.story.changes[0].evidence, text);
  assert.equal(
    readStory([{ role: "assistant", content: text, story: parsed.story }]).facts
      .length,
    1,
  );
});
test("旧失败开场可零模型调用恢复；不合格状态不采纳，开始后禁止恢复覆盖", () => {
  const store = new Store(":memory:");
  try {
    const id = store.create("", []);
    savePreparation(store, id, {
      source: { name: "雨城", format: "text", text: "雨城侦探" },
      characterMode: "none",
      worldMode: "none",
      character: { name: "", description: "" },
      world: { name: "", description: "" },
      player: { name: "", description: "" },
      opening: "",
    });
    store.saveDraft(id, {
      raw: envelope("雨停了。\n\n林走进书店。", [fact("雨停了。林走进书店。")]),
      input: "",
      base: historyKey([]),
      error: "旧校验失败",
    });
    const good = recoverOpening(store, id);
    assert.match(good.warning, /校验通过/);
    store.saveDraft(id, {
      raw: envelope("雨停了。", [fact("林已离开")]),
      input: "",
      base: historyKey([]),
      error: "坏依据",
    });
    const recovered = recoverOpening(store, id);
    assert.equal(recovered.opening, "雨停了。");
    assert.match(recovered.warning, /尚未验证/);
    confirmPreparation(store, id, store.options(id).openingDraft);
    assert.equal(store.session(id).messages[0].content, "雨停了。");
    assert.equal(store.story(id).facts.length, 0);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM model_usage").get()!.n,
      0,
    );
    assert.throws(() => recoverOpening(store, id), /已有剧情/);
  } finally {
    store.close();
  }
});

const fact = (value: string, key = "场景"): StoryFact => ({
  key,
  kind: "scene",
  value,
  evidence: value,
});
const envelope = (text: string, changes: StoryFact[]) =>
  text + "\n<story_update>" + JSON.stringify({ changes }) + "</story_update>";
function reply(text: string, history: Message[]): Message {
  const result = parseStory(envelope(text, [fact(text)]), history);
  return { role: "assistant", content: result.text, story: result.story };
}
test("状态只采纳本轮原文引用；拒绝伪造依据、重复键和损坏协议，流式协议不显示", () => {
  assert.throws(() =>
    parseStory(envelope("店主计划远行", [fact("店主已经离开")]), []),
  );
  assert.throws(() =>
    parseStory(envelope("雨城", [fact("雨城"), fact("雨城")]), []),
  );
  assert.throws(() => parseStory("雨城<story_update>{", []));
  const raw = envelope("雨城", [fact("雨城")]);
  for (let n = "雨城\n".length; n < raw.length; n++)
    assert.equal(visibleStory(raw.slice(0, n)).trim(), "雨城");
  assert.equal(parseStory(raw, []).story.changes.length, 1);
});

test("改写与候选使后续记忆失效；旧分支独立；玩家修正保留并可撤销", () => {
  const opening = reply("雨城", []);
  const history: Message[] = [opening, { role: "user", content: "走进去" }];
  const original = reply("书店", history);
  const alternative = reply("码头", history);
  const withVariants = appendVariant(original, alternative);
  const branch = [...history, original];
  const selected = [...history, withVariants];
  selected.push(
    { role: "user", content: "继续" },
    reply("灯塔", [...selected, { role: "user", content: "继续" }]),
  );
  assert.equal(readStory(branch).facts[0].value, "书店");
  assert.equal(readStory(selected).facts[0].value, "灯塔");
  selected[2] = selectVariant(withVariants, 0);
  assert.equal(readStory(selected).facts[0].value, "书店");
  assert.equal(readStory(selected).invalidated, 1);
  const corrections = [
    {
      id: 1,
      anchor: historyKey(branch),
      count: branch.length,
      key: "场景",
      value: "旧书店",
    },
  ];
  const next = [...branch, { role: "user" as const, content: "继续" }];
  next.push(reply("新的书店", next));
  assert.equal(readStory(next, corrections).facts[0].value, "旧书店");
  assert.equal(
    readStory(next, [...corrections, { ...corrections[0], id: 2, value: null }])
      .facts[0].value,
    "新的书店",
  );
  assert.equal(readStory(selected, corrections).facts[0].value, "旧书店");
  assert.equal(readStory(history, corrections).facts[0].value, "雨城");
});

test("检索有预算且不会静默丢弃玩家修正，原始事实不变", () => {
  const view = {
    revision: "",
    invalidated: 0,
    facts: Array.from({ length: 100 }, (_, i) => ({
      ...fact(`线索${i}` + "细节".repeat(30), `线索${i}`),
      kind: "fact" as const,
      source: i,
    })),
  };
  const before = JSON.stringify(view);
  const selected = storyContext(view, "线索3", [], 1500);
  assert.ok(selected.bytes <= 1500);
  assert.ok(selected.omitted > 0);
  assert.equal(JSON.stringify(view), before);
  assert.throws(
    () =>
      storyContext(
        { ...view, facts: view.facts.map((f) => ({ ...f, corrected: true })) },
        "",
        [],
        1500,
      ),
    /未静默丢弃/,
  );
});

test("一次开场加十轮：文本设定、真实回环 SSE、修正、重开、分支、幂等、失败草稿与用量", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yuno-story-"));
  const dbPath = join(dir, "test.sqlite");
  let store = new Store(dbPath);
  let app = createApp(store);
  const requests: { messages: Message[] }[] = [];
  let broken = false;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    const number = requests.length;
    const text = `雨城。林正在寻找失踪的友人。发现线索${number}。`;
    const output = broken
      ? "未提交的正文<story_update>{"
      : envelope(text, [
          fact("雨城", "地点"),
          { ...fact("林正在寻找失踪的友人。", "林/目标"), kind: "goal" },
          { ...fact(`发现线索${number}。`, `线索${number}`), kind: "fact" },
        ]);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    // The transport is real HTTP/SSE; no paid provider or credentials involved.
    res.end(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: output }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 80,
            prompt_tokens_details: { cached_tokens: 20 },
          },
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = {
    mock: false,
    model: "fixture",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "",
  };
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const id = store.create("", []);
    store.setOptions(id, { openingState: "preparing" });
    const path = `/api/sessions/${id}`;
    const draft = {
      source: { name: "雨城侦探", format: "txt", text: "雨城侦探" },
      characterMode: "none",
      worldMode: "none",
      character: { name: "", description: "" },
      world: { name: "", description: "" },
      player: { name: "", description: "" },
      opening: "",
    };
    const generated = await post(path + "/opening", { config, draft });
    assert.equal(generated.status, 200);
    const opening = ((await generated.json()) as { opening: string }).opening;
    assert.equal(
      (await post(path + "/start", { ...draft, opening })).status,
      200,
    );
    assert.equal(store.cards().length, 0);
    assert.equal(store.worlds().length, 0);
    assert.equal(store.story(id).facts.length, 3);
    const revision = store.story(id).revision;
    assert.equal(
      (
        await post(path + "/story/correct", {
          revision,
          key: "地点",
          value: "雨城旧城区",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post(path + "/story/correct", {
          revision,
          key: "地点",
          value: "过期修正",
        })
      ).status,
      400,
    );
    for (let n = 0; n < 10; n++) {
      const requestId = randomUUID();
      const response = await post(path + "/turn", {
        config,
        input: `寻找线索${n}`,
        requestId,
      });
      assert.match(await response.text(), /"type":"done"/);
      const count = requests.length;
      assert.match(
        await (
          await post(path + "/turn", {
            config,
            input: `寻找线索${n}`,
            requestId,
          })
        ).text(),
        /"replay":true/,
      );
      assert.equal(requests.length, count);
      assert.ok(
        requests.at(-1)!.messages.some((m) => m.content.includes("雨城旧城区")),
      );
    }
    assert.equal(requests.length, 11);
    assert.equal(store.session(id).messages.length, 21);
    assert.equal(
      store.story(id).facts.find((f) => f.key === "地点")?.value,
      "雨城旧城区",
    );
    assert.equal(
      store.story(id).facts.find((f) => f.key === "林/目标")?.kind,
      "goal",
    );
    const branchResponse = await post(path + "/branch", { count: 3 });
    const branch = (await branchResponse.json()) as { id: string };
    assert.equal(
      store.story(branch.id).facts.find((f) => f.key === "地点")?.value,
      "雨城旧城区",
    );
    assert.ok(!store.story(branch.id).facts.some((f) => f.key === "线索11"));
    const before = JSON.stringify(store.session(id).messages);
    broken = true;
    assert.match(
      await (await post(path + "/turn", { config, input: "坏协议" })).text(),
      /"type":"done"/,
    );
    assert.equal(
      JSON.stringify(store.session(id).messages.slice(0, -2)),
      before,
    );
    assert.equal(requests.length, 12);
    assert.match(store.session(id).messages.at(-1)!.warning!, /状态未更新/);
    assert.match(store.session(id).messages.at(-1)!.raw!, /未提交的正文/);
    const completed = JSON.stringify(store.session(id).messages);
    store.close();
    store = new Store(dbPath);
    app = createApp(store);
    assert.equal(JSON.stringify(store.session(id).messages), completed);
    assert.equal(store.draft(id), null);
    assert.equal(
      store.story(id).facts.find((f) => f.key === "地点")?.value,
      "雨城旧城区",
    );
    const usage = (await (await app.request(path + "/usage")).json()) as {
      usage: { input: number; output: number; cached: number };
      status: string;
    }[];
    assert.equal(usage.length, 12);
    assert.equal(usage.at(-1)!.status, "completed");
    assert.deepEqual(usage[0].usage, { input: 120, output: 80, cached: 20 });
    assert.equal(
      (await post(path + "/edit", { index: 2, content: "改写为离开雨城" }))
        .status,
      200,
    );
    assert.ok(store.story(id).invalidated > 0);
    assert.ok(!store.story(id).facts.some((f) => f.key === "线索11"));
    assert.ok(store.story(branch.id).facts.some((f) => f.key === "线索2"));
    assert.equal((await post(path + "/undo", {})).status, 200);
    assert.equal(JSON.stringify(store.session(id).messages), completed);
  } finally {
    store.close();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("事务写入失败回滚正文、状态和幂等回执，草稿仍可取回", () => {
  const store = new Store(":memory:");
  try {
    const id = store.create("", []),
      base = historyKey([]);
    store.saveDraft(id, { raw: "草稿", input: "", base, error: "未提交" });
    store.db.exec(
      "CREATE TRIGGER fail_story BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT,'fault injection'); END",
    );
    assert.throws(() =>
      store.commitTurn(id, base, [reply("雨城", [])], randomUUID()),
    );
    assert.equal(store.session(id).messages.length, 0);
    assert.equal(store.story(id).facts.length, 0);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM turn_receipts").get()!.n,
      0,
    );
    assert.equal(store.draft(id)!.raw, "草稿");
  } finally {
    store.close();
  }
});
