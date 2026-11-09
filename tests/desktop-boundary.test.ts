import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
test("桌面后端动态端口、私有连接、仅静态资源、父进程断开即关闭", async () => {
  const root = mkdtempSync(join(tmpdir(), "everse-desktop-boundary-"));
  mkdirSync(join(root, "dist"));
  writeFileSync(
    join(root, "dist/index.html"),
    "<!doctype html><title>Everse fixture</title>",
  );
  const child = fork(
    fileURLToPath(new URL("../server/desktop-entry.ts", import.meta.url)),
    [],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    },
  );
  const exit = once(child, "exit");
  try {
    const ready = once(child, "message", {
      signal: AbortSignal.timeout(15000),
    });
    child.send({
      type: "start",
      root,
      data: join(root, "data"),
      token: "a".repeat(64),
    });
    const [message] = (await ready) as [{ type: string; port: number }];
    assert.equal(message.type, "ready");
    const url = `http://127.0.0.1:${message.port}`;
    const headers = { "x-everse-desktop": "a".repeat(64) };
    assert.equal((await fetch(url + "/api/health")).status, 403);
    assert.equal(
      (
        await fetch(url + "/api/health", {
          headers: { ...headers, origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(url + "/api/health", { headers })).status, 200);
    assert.match(
      await (await fetch(url, { headers })).text(),
      /Everse fixture/,
    );
    for (const path of [
      "/server.cjs",
      "/data/game.sqlite",
      "/package.json",
      "/@vite/client",
    ])
      assert.equal((await fetch(url + path, { headers })).status, 404);
    child.disconnect();
    await exit;
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await exit;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
