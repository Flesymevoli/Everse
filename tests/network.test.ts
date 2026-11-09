import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { configureNetwork } from "../server/network.js";
import { generationError } from "../server/provider.js";
test("后端使用已有代理，回环请求绕过代理且不修改环境", async () => {
  let tunnels = 0;
  const proxy = createServer();
  proxy.on("connect", (_req, socket) => {
    tunnels++;
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () =>
      socket.end(
        "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
      ),
    );
  });
  const local = createServer((_req, res) => res.end("local"));
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => local.listen(0, "127.0.0.1", r));
  const p = proxy.address(),
    l = local.address();
  assert.ok(p && typeof p !== "string" && l && typeof l !== "string");
  const env = {
    HTTP_PROXY: `http://127.0.0.1:${p.port}`,
    NO_PROXY: "example.test",
  };
  const previous = { ...env };
  const restore = configureNetwork(env);
  try {
    assert.equal(
      await (await fetch("http://provider.invalid/v1/models")).text(),
      "ok",
    );
    assert.equal(
      await (await fetch(`http://127.0.0.1:${l.port}/`)).text(),
      "local",
    );
    assert.equal(tunnels, 1);
    assert.deepEqual(env, previous);
  } finally {
    restore();
    await Promise.all([
      new Promise<void>((r) => proxy.close(() => r())),
      new Promise<void>((r) => local.close(() => r())),
    ]);
  }
});
test("网络诊断不暴露异常中的凭据与地址", () => {
  for (const [code, label] of [
    ["UND_ERR_CONNECT_TIMEOUT", "无法在等待时间"],
    ["ENOTFOUND", "域名解析失败"],
    ["ECONNREFUSED", "拒绝连接"],
  ]) {
    const e = new TypeError("sensitive-url-and-key", {
      cause: { code, message: "sensitive-url-and-key" },
    });
    const result = generationError(e);
    assert.ok(result.includes(label));
    assert.ok(!result.includes("sensitive"));
  }
});
