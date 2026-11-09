import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { parseNarrative } from "../server/story.js";
test("Alpha：状态异常不阻断完整开场和续写，空正文仍拒绝，原始回复和警告保存", async () => {
  const store = new Store(":memory:"),
    app = createApp(store);
  let calls = 0;
  const raw = "桥头有人点亮了灯。\n<story_update>{broken";
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
    }
    calls++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: raw }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const config = {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "",
    model: "local-fixture",
    mock: false,
  };
  const post = (path: string, body: unknown) =>
    app.request("/api/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const created = await (await post("sessions", { prepare: true })).json();
    const path = `sessions/${created.id}`;
    const draft = {
      source: { name: "桥镇", format: "text", text: "桥镇" },
      characterMode: "none",
      worldMode: "none",
      character: {},
      world: {},
      player: { name: "", description: "" },
      opening: "",
    };
    const opening = await post(path + "/opening", { draft, config });
    assert.equal(opening.status, 200);
    const body = await opening.json();
    assert.equal(body.opening, "桥头有人点亮了灯。");
    assert.match(body.warning, /状态未更新/);
    assert.equal(
      (await post(path + "/start", { ...draft, opening: body.opening })).status,
      200,
    );
    assert.equal(store.story(created.id).facts.length, 0);
    assert.match(store.session(created.id).messages[0].warning!, /状态未更新/);
    const turn = await post(path + "/turn", { input: "继续", config });
    assert.match(await turn.text(), /"type":"done"/);
    const message = store.session(created.id).messages.at(-1)!;
    assert.equal(message.raw, raw);
    assert.match(message.warning!, /状态未更新/);
    assert.equal(calls, 2);
    assert.throws(() => parseNarrative("<story_update>{}", []));
    assert.equal(parseNarrative("可用正文", []).text, "可用正文");
  } finally {
    store.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
