import { test } from "node:test";
import assert from "node:assert/strict";
import { readJson, requestJson, fetchLocal } from "../src/response.js";
test("API 空代理错误与非 JSON 响应显示可操作提示，不暴露响应正文", async () => {
  await assert.rejects(
    readJson(new Response("", { status: 500 })),
    /本地服务暂时不可用/,
  );
  await assert.rejects(
    readJson(new Response("<html>private diagnostic</html>")),
    /无法识别的数据/,
  );
  await assert.rejects(
    readJson(Response.json({ error: "请填写名称" }, { status: 400 })),
    /请填写名称/,
  );
  assert.deepEqual(await readJson(Response.json({ ok: true })), { ok: true });
  await assert.rejects(readJson(Response.json(null)), /不完整的数据/);
  const broken = new ReadableStream({
    start(controller) {
      controller.error(new Error("private diagnostic"));
    },
  });
  await assert.rejects(readJson(new Response(broken)), /连接中断/);
});

test("本地请求统一编码、网络失败不重试、取消保留语义", async (t) => {
  let calls = 0;
  const body = { text: "雨城" };
  const mocked = t.mock.method(
    globalThis,
    "fetch",
    async (path: string, init?: RequestInit) => {
      calls++;
      assert.equal(path, "/api/test");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), body);
      return Response.json({ ok: true });
    },
  );
  assert.deepEqual(await requestJson("test", body), { ok: true });
  mocked.mock.mockImplementation(async () => {
    calls++;
    throw new TypeError("private network details");
  });
  await assert.rejects(requestJson("test", body), /无法连接本地服务/);
  assert.equal(calls, 2);
  const controller = new AbortController();
  controller.abort();
  const abort = new DOMException("cancelled", "AbortError");
  mocked.mock.mockImplementation(async () => {
    throw abort;
  });
  await assert.rejects(
    fetchLocal("/api/test", { signal: controller.signal }),
    (e) => e === abort,
  );
});
