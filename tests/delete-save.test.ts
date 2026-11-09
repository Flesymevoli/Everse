import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("删除存档需明确确认，事务清理关联记录且保留其他存档和共享资料", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store),
      id = store.create("", [{ role: "assistant", content: "第一份" }]),
      other = store.create("", [{ role: "assistant", content: "第二份" }]);
    store.setOptions(id, { name: "删除验收" });
    store.setSuggestions(id, true);
    for (const target of [id, other]) {
      for (const table of ["director_revisions", "model_usage", "turn_drafts"])
        store.db
          .prepare(`INSERT INTO ${table}(sessionId,body) VALUES (?,?)`)
          .run(target, "{}");
      store.db
        .prepare("INSERT INTO revisions(sessionId,messages) VALUES (?,?)")
        .run(target, "[]");
      store.db
        .prepare("INSERT INTO turn_receipts VALUES (?,?)")
        .run(target, "receipt");
      store.db
        .prepare(
          "INSERT INTO story_corrections(sessionId,anchor,count,key,value) VALUES (?,?,?,?,?)",
        )
        .run(target, "a", 0, "k", "v");
    }
    store.db
      .prepare("INSERT INTO source_documents(id,name,body) VALUES (?,?,?)")
      .run("doc", "共用设定", Buffer.from("设定"));
    const before = store.session(other);
    assert.equal(
      (await post(app, `/api/sessions/${id}/delete`, {})).status,
      400,
    );
    assert.equal(store.sessions().length, 2);
    assert.equal(
      (await post(app, `/api/sessions/${id}/delete`, { confirm: true })).status,
      200,
    );
    assert.deepEqual(store.session(other), before);
    assert.equal(store.sessions().length, 1);
    for (const table of [
      "director_revisions",
      "model_usage",
      "turn_drafts",
      "turn_receipts",
      "revisions",
      "story_corrections",
    ]) {
      assert.equal(
        store.db
          .prepare(`SELECT count(*) n FROM ${table} WHERE sessionId=?`)
          .get(id)!.n,
        0,
      );
      assert.equal(
        store.db
          .prepare(`SELECT count(*) n FROM ${table} WHERE sessionId=?`)
          .get(other)!.n,
        1,
      );
    }
    for (const table of ["preferences", "session_options", "sessions"])
      assert.equal(
        store.db.prepare(`SELECT count(*) n FROM ${table} WHERE id=?`).get(id)!
          .n,
        0,
      );
    assert.ok(
      store.db.prepare("SELECT id FROM source_documents WHERE id=?").get("doc"),
    );
    assert.equal(
      (await post(app, `/api/sessions/${id}/delete`, { confirm: true })).status,
      404,
    );
  } finally {
    store.close();
  }
});
test("删除中途失败回滚所有记录", () => {
  const store = new Store(":memory:");
  try {
    const id = store.create("", []);
    store.setOptions(id, { name: "保留" });
    store.db.exec(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'test failure'); END",
    );
    assert.throws(() => store.deleteSession(id), /test failure/);
    assert.equal(store.session(id).options.name, "保留");
  } finally {
    store.close();
  }
});
test("正在生成的存档拒绝删除，停止后可删除", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    const world = (await (
      await post(app, "/api/worlds", {
        original: {
          spec: "yuno_world_v1",
          data: { name: "测试", first_mes: "开场" },
        },
      })
    ).json()) as { id: string };
    const save = (await (
      await post(app, "/api/sessions", { worldId: world.id })
    ).json()) as { id: string };
    const response = await post(app, `/api/sessions/${save.id}/turn`, {
      input: "继续",
      config: {
        mock: true,
        model: "mock",
        baseUrl: "http://localhost",
        apiKey: "",
      },
    });
    const reader = response.body!.getReader();
    await reader.read();
    assert.equal(
      (await post(app, `/api/sessions/${save.id}/delete`, { confirm: true }))
        .status,
      409,
    );
    await post(app, `/api/sessions/${save.id}/stop`, {});
    while (!(await reader.read()).done) {}
    assert.equal(
      (await post(app, `/api/sessions/${save.id}/delete`, { confirm: true }))
        .status,
      200,
    );
    assert.equal(store.worlds().length, 1);
  } finally {
    store.close();
  }
});
