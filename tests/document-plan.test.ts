import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { createServer } from "node:http";
import { createApp } from "../server/app.js";
import {
  readPlan,
  savePlan,
  classifyPlan,
  nextBatch,
} from "../server/document-plan.js";
import { selectPlan, sourceContext } from "../server/document-context.js";
const config = {
  mock: true,
  baseUrl: "http://localhost",
  model: "mock",
  apiKey: "",
};
test("分类实际HTTP请求只发目标与相邻段，格式失败不覆盖旧分类且记录尝试", async () => {
  const store = new Store(":memory:");
  let calls = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    const input = JSON.parse(request.messages[1].content);
    calls++;
    assert.ok(input.targets.length <= 8);
    assert.equal(request.tools, undefined);
    const output =
      calls === 1
        ? JSON.stringify({
            sections: input.targets.map((s: { index: number }) => ({
              index: s.index,
              kind: "unclassified",
            })),
          })
        : '{"sections":[{"index":9999,"kind":"rule"}]}';
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: output }, finish_reason: "stop" }],
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    store.db
      .prepare(
        "INSERT INTO source_documents(id,name,body,extracted) VALUES (?,?,?,?)",
      )
      .run(
        "fixture",
        "x",
        Buffer.from(""),
        Array.from({ length: 12 }, (_, i) => "资料" + i).join("\n\n"),
      );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const live = {
      ...config,
      mock: false,
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
    };
    const first = await classifyPlan(store, "fixture", live, 0),
      snapshot = JSON.stringify(first);
    await assert.rejects(
      classifyPlan(store, "fixture", live, first.revision),
      /未自动重试/,
    );
    assert.equal(JSON.stringify(readPlan(store, "fixture")), snapshot);
    assert.equal(calls, 2);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM model_usage").get()!.n,
      2,
    );
  } finally {
    store.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("分类保留原文范围；单批预算、缓存和人工修改不被模型覆盖", async () => {
  const store = new Store(":memory:");
  try {
    const text =
      "核心规则：魔法必须付出代价。\n\n开局先询问玩家身份。\n\n示例：玩家已经成神。\n\n北港书店住着店主。";
    store.db
      .prepare(
        "INSERT INTO source_documents(id,name,body,extracted) VALUES (?,?,?,?)",
      )
      .run("fixture", "x", Buffer.from(""), text);
    const first = readPlan(store, "fixture");
    assert.equal(first.sections.length, 4);
    for (const s of first.sections)
      assert.equal(text.slice(s.start, s.end), s.text);
    const result = await classifyPlan(store, "fixture", config, 0);
    assert.equal(result.sections[0].kind, "rule");
    assert.equal(result.sections[2].kind, "example");
    const turn = selectPlan(result, "北港", 6000, "turn"),
      opening = selectPlan(result, "北港", 6000, "opening");
    assert.ok(turn.selected.some((s) => s.kind === "rule"));
    assert.ok(
      !turn.selected.some((s) => s.kind === "opening" || s.kind === "example"),
    );
    assert.ok(opening.selected.some((s) => s.kind === "opening"));
    assert.equal(nextBatch(result).length, 0);
    await classifyPlan(store, "fixture", config, 1);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM model_usage").get()!.n,
      1,
    );
    result.sections[2].kind = "style";
    result.sections[2].origin = "user";
    savePlan(store, result, 1);
    const manual = readPlan(store, "fixture");
    assert.equal(manual.sections[2].origin, "user");
    assert.throws(() => savePlan(store, manual, 0), /其他页面/);
    const ctx = sourceContext(
      store,
      {
        name: "x",
        format: "docx",
        text: "",
        documentId: "fixture",
        reference: true,
      },
      "北港",
    );
    assert.match(ctx.text, /类别=style/);
    assert.match(ctx.text, /必须付出代价/);
  } finally {
    store.close();
  }
});
test("长文分析按批执行，未知内容保留，API人工修正真正影响请求", async () => {
  const store = new Store(":memory:");
  const app = createApp(store);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const text = Array.from(
      { length: 20 },
      (_, i) => `资料${i}：` + "海边小镇。".repeat(100),
    ).join("\n\n");
    store.db
      .prepare(
        "INSERT INTO source_documents(id,name,body,extracted) VALUES (?,?,?,?)",
      )
      .run("fixture", "x", Buffer.from(""), text);
    const batch = nextBatch(readPlan(store, "fixture"));
    assert.ok(batch.length <= 8);
    assert.ok(batch.reduce((n, s) => n + s.text.length, 0) <= 6000);
    const r = await post("/api/documents/fixture/classify", {
      config,
      revision: 0,
    });
    assert.equal(r.status, 200);
    let plan = readPlan(store, "fixture");
    assert.ok(plan.sections.some((s) => s.origin === "pending"));
    const change = await post("/api/documents/fixture/plan", {
      revision: plan.revision,
      index: 0,
      kind: "example",
    });
    assert.equal(change.status, 200);
    plan = readPlan(store, "fixture");
    assert.equal(plan.sections[0].origin, "user");
    await classifyPlan(store, "fixture", config, plan.revision);
    assert.equal(readPlan(store, "fixture").sections[0].kind, "example");
    assert.ok(
      !selectPlan(
        readPlan(store, "fixture"),
        "资料0",
        6000,
        "turn",
      ).selected.some((s) => s.index === 0),
    );
  } finally {
    store.close();
  }
});
