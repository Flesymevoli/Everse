import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { createWork } from "../server/creation.js";
import { readPlayer } from "../shared/player.js";
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("引导创建复用世界书和角色卡；玩家身份不作为模型角色，开场原样保存且可继续编辑", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    for (const kind of ["worlds", "characters"] as const) {
      const response = await post(app, "/api/creations", {
        kind,
        name: "测试作品",
        description: "海边背景",
        opening: "{{user}}推开门。",
        player: { name: "小雨", description: "第一次到海边的旅人" },
        worldbook:
          kind === "worlds"
            ? {
                entries: {
                  one: {
                    constant: true,
                    content: "灯塔设定",
                    custom: { keep: true },
                  },
                },
              }
            : undefined,
        scenario: "原样场景",
        personality: "沉静",
        start: true,
      });
      assert.equal(response.status, 200);
      const created = (await response.json()) as {
        id: string;
        sessionId: string;
      };
      assert.equal(
        store.session(created.sessionId).messages[0].content,
        "小雨推开门。",
      );
      const data =
        kind === "worlds"
          ? store.worlds().find((w) => w.id === created.id)!.world.data
          : store.cards().find((c) => c.id === created.id)!.card.data;
      assert.equal(data.name, "测试作品");
      assert.equal(readPlayer(data)?.name, "小雨");
      assert.equal(data.description, "海边背景");
      const turn = await post(
        app,
        "/api/sessions/" + created.sessionId + "/turn",
        {
          input: "看看",
          config: {
            mock: true,
            baseUrl: "http://localhost",
            model: "mock",
            apiKey: "",
          },
        },
      );
      const events = (await turn.text())
        .trim()
        .split("\n")
        .map((v) => JSON.parse(v));
      assert.equal(events.at(-1).type, "done");
      const prompt = events[0].prompt.messages
        .map((m: { content: string }) => m.content)
        .join("\n");
      assert.match(prompt, /玩家身份（用户扮演）：小雨/);
      assert.match(prompt, /第一次到海边的旅人/);
      assert.match(prompt, /海边背景/);
      const before = store.session(created.sessionId).messages;
      const path = kind === "worlds" ? "worlds" : "cards";
      assert.equal(
        (
          await post(app, `/api/${path}/${created.id}/edit`, {
            name: "更名",
            description: "修改背景",
            first_mes: "新开场",
            player: { name: "阿澄", description: "保留的玩家" },
          })
        ).status,
        200,
      );
      assert.deepEqual(store.session(created.sessionId).messages, before);
      const exported = (await (
        await app.request(`/api/${path}/${created.id}/export`)
      ).json()) as { data: unknown };
      assert.equal(readPlayer(exported.data)?.name, "阿澄");
    }
  } finally {
    store.close();
  }
});
test("极简创建不强制复杂字段；仅保存不建存档；失败原子回滚不留下半成品", () => {
  const store = new Store(":memory:");
  try {
    const saved = createWork(store, {
      kind: "characters",
      description: "几个字",
      start: false,
    });
    assert.equal(saved.sessionId, undefined);
    assert.equal(store.cards()[0].card.data.name, "未命名角色");
    assert.equal(store.sessions().length, 0);
    const minimal = createWork(store, { kind: "worlds" });
    assert.ok(minimal.sessionId);
    assert.deepEqual(store.session(minimal.sessionId).messages, []);
    const counts = [
      store.cards().length,
      store.worlds().length,
      store.sessions().length,
    ];
    assert.throws(() =>
      createWork(store, {
        kind: "worlds",
        worldbook: { entries: { bad: { content: 3 } } },
      }),
    );
    assert.deepEqual(
      [store.cards().length, store.worlds().length, store.sessions().length],
      counts,
    );
    store.db.exec(
      "CREATE TRIGGER fail_new_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'test rollback'); END",
    );
    assert.throws(
      () => createWork(store, { kind: "characters", start: true }),
      /test rollback/,
    );
    assert.deepEqual(
      [store.cards().length, store.worlds().length, store.sessions().length],
      counts,
    );
  } finally {
    store.close();
  }
});
