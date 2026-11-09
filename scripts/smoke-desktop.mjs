import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Exercise the real packaged window, real backend and Windows DPAPI. Only the provider is local/fake.
const executablePath = resolve(process.argv[2] ?? "release/win-unpacked/Everse.exe");
const userRoot = process.env.EVERSE_QA_DATA ?? await mkdtemp(join(tmpdir(), "Everse-desktop-qa-"));
const evidence = resolve("release/qa");
await mkdir(evidence, { recursive: true });
const secret = "desktop-test-only-not-a-real-key";
let calls = 0;
const provider = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  assert.equal(req.url, "/v1/chat/completions");
  assert.equal(req.headers.authorization, "Bearer " + secret);
  const request = JSON.parse(body);
  assert.equal(request.model, "desktop-test");
  assert.equal(request.stream, true);
  assert.equal(request.messages[0].content, "桌面测试规则");
  calls++;
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: "灯火亮了。" } }] }) + '\n\n');
  setTimeout(() => res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: "你推开书店的门。" }, finish_reason: "stop" }] }) + '\n\ndata: [DONE]\n\n'), 150);
});
await new Promise(ok => provider.listen(0, "127.0.0.1", ok));
const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
const env = { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, EVERSE_DESKTOP_DATA_ROOT: userRoot };
for (const k of ["NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE", "EVERSE_PORT", "YUNO_PORT", "EVERSE_DATA_DIR", "YUNO_DATA_DIR"]) delete env[k];
let application;
const errors = [];
async function launch() {
  application = await electron.launch({ executablePath, env, timeout: 45000 });
  const page = await application.firstWindow();
  page.on("pageerror", e => errors.push(e.message));
  await page.getByRole("button", { name: /新建故事/ }).waitFor();
  assert.equal(page.url(), "everse://app/");
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  return page;
}
async function api(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch("/api/" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("Local API status " + response.status);
    return response.json();
  }, { path, body });
}
async function waitSaved(page, id, count) {
  for (let i = 0; i < 150; i++) {
    const save = await api(page, `sessions/${id}`);
    if (save.messages.length === count) return save;
    await new Promise(ok => setTimeout(ok, 100));
  }
  throw new Error("Timed out waiting for committed messages");
}
try {
  let page = await launch();
  assert.deepEqual(await api(page, "sessions"), []);
  await page.getByRole("button", { name: /新建故事/ }).click();
  await page.getByLabel("存档名称（可选）", { exact: true }).fill("不应落盘");
  assert.deepEqual(await api(page, "sessions"), []);
  await page.getByRole("button", { name: "取消", exact: true }).first().click();
  assert.deepEqual(await api(page, "sessions"), []);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "＋ 添加设定", exact: true }).click();
  await page.getByLabel("模块名称", { exact: true }).fill("桌面模块");
  await page.getByLabel("提示词内容", { exact: true }).fill("桌面测试规则");
  await page.getByLabel("启用此模块", { exact: true }).check();
  await page.getByRole("button", { name: "保存模块", exact: true }).click();
  await page.getByLabel("启用模块：桌面模块", { exact: true }).waitFor();
  assert.equal((await api(page, "prompt-modules"))[0].enabled, true);
  await rm(join(evidence, "modules-test-export.json"), { force: true });
  await application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, join(evidence, "modules-test-export.json"));
  await page.getByRole("link", { name: "导出全部模块", exact: true }).click();
  for (let i = 0; i < 100; i++) {
    try { await readFile(join(evidence, "modules-test-export.json")); break; } catch {}
    await new Promise(ok => setTimeout(ok, 100));
  }
  const exported = JSON.parse(await readFile(join(evidence, "modules-test-export.json"), "utf8"));
  assert.equal(exported.format, "everse_prompt_modules_v1");
  await page.locator('.prompt-modules input[type="file"]').setInputFiles(join(evidence, "modules-test-export.json"));
  await page.getByText(/已导入，默认关闭/).waitFor();
  const imported = await api(page, "prompt-modules");
  assert.equal(imported.length, 2);
  assert.equal(imported.filter(m => m.enabled).length, 1);
  await page.getByRole("button", { name: /添加 API 连接/ }).click();
  await page.getByLabel("连接名称", { exact: true }).fill("桌面验收连接");
  await page.getByLabel("Base URL（通常以 /v1 结尾）", { exact: true }).fill(baseUrl);
  await page.getByLabel("模型 ID", { exact: true }).fill("desktop-test");
  await page.getByLabel("API Key", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "保存连接与 Key", exact: true }).click();
  await page.getByText("已保存到本机", { exact: true }).waitFor();
  await page.getByRole("button", { name: "使用此连接", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: /新建故事/ }).click();
  await page.getByLabel("故事设定", { exact: true }).fill("雨城里的旧书店。先问玩家姓名，再开始故事。");
  await page.getByLabel("存档名称（可选）", { exact: true }).fill("桌面验收存档");
  await page.getByRole("button", { name: "进入故事", exact: true }).click();
  await page.getByRole("button", { name: "按设定开始", exact: true }).waitFor();
  assert.equal(calls, 0);
  const saves = await api(page, "sessions");
  assert.equal(saves.length, 1);
  const id = saves[0].id;
  await page.getByRole("button", { name: "按设定开始", exact: true }).click();
  await page.locator(".passage").first().waitFor();
  await waitSaved(page, id, 2);
  assert.equal(calls, 1);
  assert.equal((await api(page, `sessions/${id}`)).messages.length, 2);
  await page.screenshot({ path: join(evidence, "desktop-first-run.png") });
  await application.close(); application = undefined;
  const db = new DatabaseSync(join(userRoot, "data/game.sqlite"), { readOnly: true });
  const ciphertext = String(db.prepare("SELECT secret FROM connections").get().secret);
  assert.ok(ciphertext && !ciphertext.includes(secret));
  db.close();
  assert.ok(!(await readFile(join(userRoot, "data/game.sqlite"))).includes(Buffer.from(secret)));
  page = await launch();
  assert.equal((await api(page, "sessions")).length, 1);
  assert.equal((await api(page, "connections"))[0].hasKey, true);
  assert.equal((await api(page, "prompt-modules"))[0].enabled, true);
  await page.locator(".recent-story").first().click();
  await page.locator(".passage").first().waitFor();
  await page.getByLabel("你的行动", { exact: true }).fill("我叫小雨。");
  await page.getByRole("button", { name: "继续故事", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".passage").length === 2);
  await waitSaved(page, id, 4);
  assert.equal(calls, 2);
  const afterTurn = await api(page, `sessions/${id}`);
  assert.equal(afterTurn.messages.length, 4);
  await page.screenshot({ path: join(evidence, "desktop-restarted.png") });
  // Delete confirmation must not silently affect the saved story.
  const group = page.locator(".story-tree-group").filter({ hasText: "桌面验收存档" }).first();
  await group.locator(".world-actions summary").click();
  await group.getByRole("button", { name: "删除世界…", exact: true }).click();
  await page.getByRole("button", { name: "保留世界", exact: true }).click();
  assert.equal((await api(page, "sessions")).length, 1);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator(".prompt-module-row").first().getByRole("button", { name: "编辑", exact: true }).click();
  await page.screenshot({ path: join(evidence, "desktop-modules.png") });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(400, 850));
  await page.screenshot({ path: join(evidence, "desktop-modules-narrow.png") });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, executablePath, userRoot, calls, checks: ["no global Node/npm/PATH", "bundled UI", "cancel without save", "DPAPI", "real HTTP streaming adapter", "save/restart/continue", "world delete cancellation"] }));
} finally {
  await application?.close();
  provider.closeAllConnections();
  await new Promise(ok => provider.close(ok));
}
