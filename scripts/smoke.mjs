import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";
const data = mkdtempSync(join(tmpdir(), "yuno-install-"));
const port = await new Promise((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});
const child = spawn(
  process.execPath,
  ["--import", "tsx", "server/index.ts", "--production"],
  {
    env: { ...process.env, YUNO_PORT: String(port), YUNO_DATA_DIR: data },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let log = "";
child.stdout.on("data", (x) => (log += x));
child.stderr.on("data", (x) => (log += x));
const exited = new Promise((resolve) => child.once("exit", resolve));
const url = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(url + "/api/health");
      if ((await r.json()).application === "Everse") {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Server did not start: " + log);
  const html = await (await fetch(url)).text();
  assert.match(html, /Everse/);
  const asset = html.match(/src="(\/assets\/[^\"]+)"/)[1];
  assert.equal((await fetch(url + asset)).status, 200);
  for (const path of [
    "/data/game.sqlite",
    "/server/index.ts",
    "/package.json",
    "/api/unknown",
  ])
    assert.equal((await fetch(url + path)).status, 404);
  const post = (path, body, origin = url) =>
    fetch(url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await post("/api/sessions", { prepare: true }, "https://example.com"))
      .status,
    403,
  );
  const created = await (await post("/api/sessions", { prepare: true })).json();
  const draft = {
    name: "Installation smoke",
    source: { name: "Rain", format: "text", text: "A rainy town" },
    characterMode: "none",
    worldMode: "none",
    character: {},
    world: {},
    player: { name: "", description: "" },
    opening: "Rain falls.",
  };
  assert.equal(
    (await post(`/api/sessions/${created.id}/start`, draft)).status,
    200,
  );
  const response = await post(`/api/sessions/${created.id}/turn`, {
    input: "Look around",
    config: {
      baseUrl: "http://localhost",
      apiKey: "",
      model: "mock",
      mock: true,
    },
  });
  assert.match(await response.text(), /"type":"done"/);
  const saved = await (await fetch(url + `/api/sessions/${created.id}`)).json();
  assert.equal(saved.messages.length, 3);
  console.log(
    "PASS: production page/assets, mock story, persisted messages, local origin restriction, private file isolation.",
  );
} finally {
  child.kill("SIGTERM");
  await exited;
  rmSync(data, { recursive: true, force: true });
}
