import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { importWorld } from "../server/worlds.js";
import { createPreparedSession } from "../server/preparation.js";

const draft = {
  name: "确认后创建",
  source: { name: "雨城", format: "text", text: "下雨的城市" },
  characterMode: "none",
  worldMode: "none",
  cardId: "",
  worldId: "",
  character: { name: "", description: "" },
  world: { name: "", description: "" },
  player: { name: "", description: "" },
  opening: "",
  presetId: null,
  worldbookId: null,
};
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
test("确认新建一次性提交；无效设定和事务失败不残留空存档", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    assert.equal(
      (
        await post(app, "/api/sessions/prepare", {
          draft: { ...draft, characterMode: "existing", cardId: "missing" },
          begin: true,
        })
      ).status,
      400,
    );
    assert.equal(store.sessions().length, 0);
    store.db.exec(
      "CREATE TRIGGER fail_create BEFORE INSERT ON preferences BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
    );
    assert.equal(
      (await post(app, "/api/sessions/prepare", { draft, begin: true })).status,
      400,
    );
    assert.equal(store.sessions().length, 0);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM session_options").get()!.n,
      0,
    );
    store.db.exec("DROP TRIGGER fail_create");
    const result = await post(app, "/api/sessions/prepare", {
      draft,
      begin: true,
    });
    assert.equal(result.status, 200);
    const { id } = await result.json();
    assert.equal(store.session(id).options.openingState, "started");
    assert.equal(store.session(id).messages.length, 0);
    const later = createPreparedSession(store, draft, false);
    assert.equal(store.session(later.id).options.openingState, "preparing");
    assert.equal(store.sessions().length, 2);
  } finally {
    store.close();
  }
});
test("删除世界确认范围、全事务回滚、保留共享设定与其他世界", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    const worldId = store.addWorld(
      importWorld({
        spec: "yuno_world_v1",
        data: { name: "雨城", description: "下雨" },
      }),
    );
    const a = createPreparedSession(
      store,
      { ...draft, worldMode: "existing", worldId },
      true,
    ).id;
    const b = createPreparedSession(
      store,
      { ...draft, worldMode: "existing", worldId },
      true,
    ).id;
    const other = createPreparedSession(store, draft, true).id;
    const key = "world:" + worldId;
    assert.equal(
      (await post(app, "/api/library/delete", { key, ids: [a], confirm: true }))
        .status,
      409,
    );
    assert.equal(
      (await post(app, "/api/library/delete", { key, ids: [a, b] })).status,
      400,
    );
    store.db.exec(
      `CREATE TRIGGER fail_delete BEFORE DELETE ON sessions WHEN old.id='${b}' BEGIN SELECT RAISE(ABORT, 'rollback'); END`,
    );
    assert.equal(
      (
        await post(app, "/api/library/delete", {
          key,
          ids: [a, b],
          confirm: true,
        })
      ).status,
      400,
    );
    assert.equal(store.sessions().length, 3);
    store.db.exec("DROP TRIGGER fail_delete");
    assert.equal(
      (
        await post(app, "/api/library/delete", {
          key,
          ids: [a, b],
          confirm: true,
        })
      ).status,
      200,
    );
    assert.deepEqual(
      store.sessions().map((s) => s.id),
      [other],
    );
    assert.equal(store.worlds().length, 1);
    assert.deepEqual(await (await app.request("/api/library/hidden")).json(), [
      key,
    ]);
  } finally {
    store.close();
  }
});
