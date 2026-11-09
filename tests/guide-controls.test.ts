import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { preparationSchema } from "../shared/preparation.js";
import { textSuggestions } from "../server/suggestions.js";
const config = {
  mock: true,
  model: "mock",
  baseUrl: "http://localhost",
  apiKey: "",
};
const draft = preparationSchema.parse({
  characterMode: "none",
  worldMode: "none",
  character: {},
  world: {},
  player: { name: "", description: "" },
  opening: "雨落在石桥。",
  source: {
    name: "桥镇",
    format: "text",
    text: "开局请选择身份：药师或旅人。",
  },
});
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("作品引导：实际本地模型请求、依据校验、缓存、保存答案、开场与后续生效", async () => {
  const store = new Store(":memory:"),
    app = createApp(store),
    id = store.create("", []),
    path = `/api/sessions/${id}`;
  let calls = 0,
    bad = false;
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
    }
    calls++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const content = JSON.stringify({
      questions: [
        {
          question: "请选择身份",
          choices: ["药师", "旅人"],
          evidence: bad ? "作者未写过的要求" : draft.source!.text,
        },
      ],
    });
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number },
    real = {
      ...config,
      mock: false,
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
    };
  try {
    const response = await post(app, path + "/guide", { draft, config: real });
    assert.equal(response.status, 200);
    const { guide } = await response.json();
    assert.equal(guide.questions[0].evidence, draft.source!.text);
    guide.answers[0] = "药师，擅长辨认山草";
    const prepared = { ...draft, guide };
    assert.equal(
      (await post(app, path + "/guide", { draft: prepared, config: real }))
        .status,
      200,
    );
    assert.equal(calls, 1);
    bad = true;
    assert.equal(
      (await post(app, path + "/guide", { draft, config: real })).status,
      400,
    );
    assert.equal(calls, 2);
    const changed = {
      ...prepared,
      source: { ...draft.source!, text: "设定已经改变" },
    };
    assert.equal((await post(app, path + "/start", changed)).status, 400);
    const opening = await post(app, path + "/opening", {
      draft: prepared,
      config,
    });
    assert.equal(opening.status, 200);
    const generated = await opening.json();
    assert.match(JSON.stringify(generated.prompt), /擅长辨认山草/);
    assert.doesNotMatch(generated.opening, /<action_suggestions>/);
    assert.equal(
      (
        await post(app, path + "/start", {
          ...prepared,
          opening: generated.opening,
        })
      ).status,
      200,
    );
    assert.equal(store.session(id).messages[0].suggestions?.length, 2);
    assert.equal(store.session(id).suggestions, true);
    const turn = await post(app, path + "/turn", { input: "看看桥头", config });
    assert.match(await turn.text(), /擅长辨认山草/);
  } finally {
    store.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("故事引导与改名：下一轮使用、并发版本保护、正文不改、清除生效", async () => {
  const store = new Store(":memory:"),
    app = createApp(store),
    id = store.create("", []),
    path = `/api/sessions/${id}`;
  try {
    await post(app, path + "/start", draft);
    const before = JSON.stringify(store.session(id).messages);
    assert.equal(
      (await post(app, path + "/options", { name: "桥边夜话" })).status,
      200,
    );
    const director = {
      characters: "店主是退隐医师",
      playerState: "背包里有银针",
      world: "小镇没有魔法",
      direction: "下一段寻找失踪旅人",
    };
    assert.equal(
      (await post(app, path + "/director", { revision: 0, director })).status,
      200,
    );
    assert.equal(JSON.stringify(store.session(id).messages), before);
    assert.equal(store.session(id).options.name, "桥边夜话");
    assert.equal(
      (await post(app, path + "/director", { revision: 0, director })).status,
      409,
    );
    const response = await post(app, path + "/turn", { input: "继续", config });
    assert.equal(
      (await post(app, path + "/director", { revision: 1, director })).status,
      409,
    );
    const events = await response.text();
    for (const v of Object.values(director)) assert.ok(events.includes(v));
    assert.equal(
      (await post(app, path + "/director", { revision: 1, director: {} }))
        .status,
      200,
    );
    const next = await (
      await post(app, path + "/turn", { input: "再继续", config })
    ).text();
    assert.doesNotMatch(next, /退隐医师/);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM director_revisions").get()?.n,
      2,
    );
  } finally {
    store.close();
  }
});
test("作者行动列表可交互但不把叙事列表误识别，坏格式保留原文", () => {
  assert.deepEqual(
    textSuggestions("正文\n\n**可选行动**\n\n- 走进书店\n- 留在原地"),
    ["走进书店", "留在原地"],
  );
  assert.deepEqual(
    textSuggestions("正文\n行动选项：\nA. 询问\nB. 等待\nC. 离开\nD. 观察"),
    ["询问", "等待", "离开", "观察"],
  );
  assert.deepEqual(textSuggestions("正文\n1. 苹果\n2. 橘子"), []);
  assert.deepEqual(
    textSuggestions("正文\n可选行动\n- 询问\n- 等待\n接着他离开了。"),
    [],
  );
});

test("自定义存档名：保存准备与确认沿用，重命名同步准备而不修改原设定", async () => {
  const store = new Store(":memory:"),
    app = createApp(store),
    id = store.create("", []),
    path = `/api/sessions/${id}`;
  try {
    assert.equal(
      (
        await post(app, path + "/preparation", {
          ...draft,
          name: "  雨夜第一章  ",
        })
      ).status,
      200,
    );
    assert.equal(store.session(id).options.name, "雨夜第一章");
    assert.equal(store.session(id).options.openingDraft?.name, "雨夜第一章");
    assert.equal(
      (await post(app, path + "/options", { name: "桥镇纪事" })).status,
      200,
    );
    const saved = store.session(id).options.openingDraft!;
    assert.equal(saved.name, "桥镇纪事");
    assert.deepEqual(saved.source, draft.source);
    assert.equal((await post(app, path + "/start", saved)).status, 200);
    assert.equal(store.session(id).options.name, "桥镇纪事");
  } finally {
    store.close();
  }
});
