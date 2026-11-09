import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";
import { importWorld } from "../server/worlds.js";
const config = {
  mock: true,
  model: "mock",
  baseUrl: "http://localhost",
  apiKey: "",
};
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const book = {
  custom: { preserve: true },
  entries: {
    a: {
      key: ["灯塔"],
      content: "旧灯塔资料",
      constant: true,
      depth: 3,
      probability: 100,
      extensions: { unknown: ["保留"] },
    },
    b: { key: ["删除"], content: "移除条目" },
  },
};
test("世界书编辑不改旧存档和分支；下一轮使用新内容，重开及导出保留高级字段", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yuno-book-edit-"));
  let store = new Store(join(dir, "game.sqlite"));
  try {
    let app = createApp(store);
    const original = {
      spec: "yuno_world_v1",
      custom: "顶层保留",
      data: {
        name: "旧世界",
        description: "旧背景",
        first_mes: "旧开场",
        worldbook: book,
        extensions: { unknown: 42 },
      },
    };
    const world = (await (
      await post(app, "/api/worlds", { original })
    ).json()) as { id: string };
    const session = (await (
      await post(app, "/api/sessions", { worldId: world.id })
    ).json()) as { id: string };
    const branch = (await (
      await post(app, "/api/sessions/" + session.id + "/branch", { count: 1 })
    ).json()) as { id: string };
    const previous = store.session(session.id),
      previousBranch = store.session(branch.id);
    const editedBook = {
      ...book,
      entries: {
        a: { ...book.entries.a, content: "新灯塔资料" },
        c: { key: ["船"], content: "新船资料", constant: true },
      },
    };
    const patch = {
      name: "新世界",
      description: "新背景",
      first_mes: "新开场",
      worldbook: editedBook,
    };
    assert.equal(
      (await post(app, "/api/worlds/" + world.id + "/edit", patch)).status,
      200,
    );
    assert.deepEqual(store.session(session.id), previous);
    assert.deepEqual(store.session(branch.id), previousBranch);
    const exported = (await (
      await app.request("/api/worlds/" + world.id + "/export")
    ).json()) as typeof original;
    assert.equal(exported.custom, "顶层保留");
    assert.deepEqual(exported.data.extensions, { unknown: 42 });
    assert.deepEqual(exported.data.worldbook, editedBook);
    const response = await post(app, "/api/sessions/" + session.id + "/turn", {
      input: "继续",
      config,
    });
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((v) => JSON.parse(v));
    assert.equal(events.at(-1).type, "done");
    const prompt = events[0].prompt.messages
      .map((m: { content: string }) => m.content)
      .join("\n");
    for (const text of ["新背景", "新灯塔资料", "新船资料"])
      assert.ok(prompt.includes(text));
    assert.ok(!prompt.includes("旧背景"));
    assert.ok(!prompt.includes("旧灯塔资料"));
    assert.equal(store.session(session.id).messages[0].content, "旧开场");
    assert.equal(
      (
        await post(app, "/api/worlds/" + world.id + "/edit", {
          ...patch,
          worldbook: { entries: { bad: { content: 1 } } },
        })
      ).status,
      400,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM asset_revisions").get()?.n,
      1,
    );
    store.close();
    store = new Store(join(dir, "game.sqlite"));
    app = createApp(store);
    assert.deepEqual(
      store.worlds()[0].world.data.worldbook?.entries.a.extensions,
      { unknown: ["保留"] },
    );
    assert.equal(store.session(session.id).messages.length, 3);
    const next = (await (
      await post(app, "/api/sessions", { worldId: world.id })
    ).json()) as { id: string };
    assert.equal(store.session(next.id).messages[0].content, "新开场");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("两种独立世界书入口都可编辑；ST 原字段保持，导出再导入保留应用元信息", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store);
    const world = (await (
      await post(app, "/api/worlds", { name: "导入书", original: book })
    ).json()) as { id: string };
    const patch = {
      name: "新名字",
      description: "一句设定",
      first_mes: "开场",
      worldbook: {
        ...book,
        entries: {
          ...book.entries,
          a: { ...book.entries.a, content: "已修改" },
        },
      },
    };
    assert.equal(
      (await post(app, "/api/worlds/" + world.id + "/edit", patch)).status,
      200,
    );
    const exported = (await (
      await app.request("/api/worlds/" + world.id + "/export")
    ).json()) as Record<string, unknown>;
    assert.deepEqual(exported.custom, book.custom);
    assert.deepEqual(exported.entries, patch.worldbook.entries);
    const again = importWorld(exported);
    assert.equal(again.world.data.description, "一句设定");
    assert.equal(again.world.data.name, "新名字");
    assert.equal(again.world.data.first_mes, "开场");
    const asset = (await (
      await post(app, "/api/worldbooks", { name: "旧独立书", original: book })
    ).json()) as { id: string };
    const session = (await (
      await post(app, "/api/sessions", { worldId: world.id })
    ).json()) as { id: string };
    await post(app, "/api/sessions/" + session.id + "/options", {
      worldbookId: asset.id,
    });
    const previous = store.session(session.id);
    assert.equal(
      (
        await post(app, "/api/worldbooks/" + asset.id + "/edit", {
          name: "新独立书",
          original: patch.worldbook,
        })
      ).status,
      200,
    );
    assert.deepEqual(store.session(session.id), previous);
    assert.deepEqual(store.assets("worldbooks")[0].original, patch.worldbook);
    assert.equal(
      (
        await post(app, "/api/worldbooks/missing/edit", {
          name: "没有",
          original: book,
        })
      ).status,
      400,
    );
  } finally {
    store.close();
  }
});
test("生成中的共享世界书禁止编辑，停止后可保存且原回合不变", async () => {
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
    const asset = (await (
      await post(app, "/api/worldbooks", { name: "独立", original: book })
    ).json()) as { id: string };
    const session = (await (
      await post(app, "/api/sessions", { worldId: world.id })
    ).json()) as { id: string };
    await post(app, "/api/sessions/" + session.id + "/options", {
      worldbookId: asset.id,
    });
    const response = await post(app, "/api/sessions/" + session.id + "/turn", {
      input: "继续",
      config,
    });
    const reader = response.body!.getReader();
    await reader.read();
    const patch = {
      name: "新名字",
      description: "新内容",
      first_mes: "新开场",
    };
    assert.equal(
      (await post(app, "/api/worlds/" + world.id + "/edit", patch)).status,
      409,
    );
    assert.equal(
      (
        await post(app, "/api/worldbooks/" + asset.id + "/edit", {
          name: "新",
          original: book,
        })
      ).status,
      409,
    );
    await post(app, "/api/sessions/" + session.id + "/stop", {});
    while (!(await reader.read()).done) {}
    assert.equal(
      (await post(app, "/api/worlds/" + world.id + "/edit", patch)).status,
      200,
    );
    assert.deepEqual(store.session(session.id).messages, [
      { role: "assistant", content: "开场" },
    ]);
  } finally {
    store.close();
  }
});
