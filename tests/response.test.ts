import { test } from "node:test";
import assert from "node:assert/strict";
import { readJson } from "../src/response.js";
test("API 空代理错误与非 JSON 响应显示可操作提示，不暴露响应正文", async () => {
  await assert.rejects(readJson(new Response("", { status: 500 })), /本地服务暂时不可用/);
  await assert.rejects(readJson(new Response("<html>private diagnostic</html>")), /无法识别的数据/);
  await assert.rejects(readJson(Response.json({ error: "请填写名称" }, { status: 400 })), /请填写名称/);
  assert.deepEqual(await readJson(Response.json({ ok: true })), { ok: true });
});
