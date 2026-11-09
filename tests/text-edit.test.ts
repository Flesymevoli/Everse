import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { editRevision } from "../server/text-edit.js";
import { parseStory } from "../server/story.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const config = {
  mock: true,
  model: "mock",
  baseUrl: "http://localhost",
  apiKey: "",
};
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("局部编辑：预览不写存档、精确范围替换、事实修订与撤销原子恢复，跨重开保留", async () => {
  const dir = mkdtempSync(join(tmpdir(), "everse-edit-"));
  let store = new Store(join(dir, "test.sqlite")),
    app = createApp(store);
  const id = store.create("", []),
    path = `sessions/${id}`;
  store.setOptions(id, {
    storySource: { name: "雨城", format: "text", text: "雨城" },
    storyTracking: true,
  });
  const original = "雨落下来。\n\n林离开了书店。\n\n灯仍然亮着。";
  const result = parseStory(
    original +
      "<story_update>" +
      JSON.stringify({
        changes: [
          {
            key: "林",
            kind: "person",
            value: "林已离开书店",
            evidence: "林离开了书店。",
          },
        ],
      }) +
      "</story_update>",
    [],
  );
  store.save(id, [
    { role: "assistant", content: original, story: result.story },
  ]);
  const selected = "林离开了书店。",
    start = original.indexOf(selected),
    selection = {
      index: 0,
      start,
      end: start + selected.length,
      original: selected,
      revision: editRevision(store, id),
    };
  try {
    const before = JSON.stringify(store.session(id));
    const generated = await post(app, path + "/rewrite-preview", {
      selection,
      instruction: "改为林留在书店",
      config,
    });
    assert.equal(generated.status, 200);
    assert.match((await generated.json()).replacement, /模拟改写/);
    assert.equal(JSON.stringify(store.session(id)), before);
    const applied = await post(app, path + "/edit-selection", {
      selection,
      replacement: "林留在书店。",
      fact: "林仍在书店，没有离开。",
    });
    assert.equal(applied.status, 200);
    assert.equal(
      store.session(id).messages[0].content,
      original.replace(selected, "林留在书店。"),
    );
    assert.ok(!store.story(id).facts.some((f) => f.value === "林已离开书店"));
    assert.ok(
      store
        .story(id)
        .facts.some((f) => f.corrected && f.value === "林仍在书店，没有离开。"),
    );
    assert.equal(
      (
        await post(app, path + "/edit-selection", {
          selection,
          replacement: "过期写入",
        })
      ).status,
      400,
    );
    store.close();
    store = new Store(join(dir, "test.sqlite"));
    app = createApp(store);
    const preview = await (
      await app.request("/api/" + path + "/edit-undo-preview")
    ).json();
    assert.equal(preview.after, original);
    assert.equal(
      (await post(app, path + "/undo", { revision: preview.revision })).status,
      200,
    );
    assert.equal(store.session(id).messages[0].content, original);
    assert.ok(store.story(id).facts.some((f) => f.value === "林已离开书店"));
    assert.ok(!store.story(id).facts.some((f) => f.corrected));
    const bad = { ...selection, revision: editRevision(store, id), start: 0 };
    assert.equal(
      (
        await post(app, path + "/edit-selection", {
          selection: bad,
          replacement: "坏范围",
        })
      ).status,
      400,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("改写生成：真实回环请求、生成锁、停止/失败保留原文和一次调用；新增剧情后不允许恢复覆盖", async () => {
  const store = new Store(":memory:"),
    app = createApp(store),
    id = store.create("", [{ role: "assistant", content: "灯亮了。" }]),
    path = `sessions/${id}`;
  store.setOptions(id, {
    storySource: { name: "灯塔", format: "text", text: "海边的灯塔" },
  });
  let calls = 0;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls++;
    const request = JSON.parse(body);
    assert.ok(
      request.messages.some((m: { content: string }) =>
        m.content.includes("EVERSE_LOCAL_REWRITE"),
      ),
    );
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: "改写草稿" }, finish_reason: null }],
        }) +
        "\n\n",
    );
    const timer = setTimeout(() => res.end("data: [DONE]\n\n"), 3000);
    res.on("close", () => clearTimeout(timer));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const selection = {
    index: 0,
    start: 0,
    end: 4,
    original: "灯亮了。",
    revision: editRevision(store, id),
  };
  try {
    const pending = post(app, path + "/rewrite-preview", {
      selection,
      instruction: "扩写",
      config: {
        ...config,
        mock: false,
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
      },
    });
    for (let i = 0; i < 100 && calls === 0; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1);
    assert.equal(
      (
        await post(app, path + "/edit-selection", {
          selection,
          replacement: "不能同时修改",
        })
      ).status,
      409,
    );
    await post(app, path + "/stop", {});
    assert.equal((await pending).status, 400);
    assert.equal(store.session(id).messages[0].content, "灯亮了。");
    assert.equal(calls, 1);
    await post(app, path + "/edit-selection", {
      selection,
      replacement: "灯灭了。",
    });
    store.save(id, [
      ...store.session(id).messages,
      { role: "user", content: "后来呢" },
    ]);
    assert.equal(
      (await app.request("/api/" + path + "/edit-undo-preview")).status,
      400,
    );
  } finally {
    store.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
