import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  protocol,
  session,
  shell,
  ipcMain,
} from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";

const origin = "everse://app";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "everse",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
app.setName("Everse");
// Stable across version/install-location changes. An explicit override is for isolated QA.
const userRoot = process.env.EVERSE_DESKTOP_DATA_ROOT
  ? resolve(process.env.EVERSE_DESKTOP_DATA_ROOT)
  : join(app.getPath("appData"), "Everse");
mkdirSync(userRoot, { recursive: true });
app.setPath("userData", userRoot);
let window: BrowserWindow | undefined;
let backend: ChildProcess | undefined;
let quitting = false;
let stopped = false;
let failed = false;

async function stopBackend() {
  if (!backend || backend.exitCode !== null || backend.signalCode !== null)
    return;
  const child = backend;
  await new Promise<void>((done) => {
    const timer = setTimeout(() => {
      child.kill();
      done();
    }, 4000);
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
    if (child.connected) child.send({ type: "stop" }, () => {});
    else child.kill();
  });
}
function fail(message: string) {
  if (failed || quitting) return;
  failed = true;
  dialog.showErrorBox(
    "Everse 无法继续运行",
    message + "\n用户数据仍保留在：\n" + join(userRoot, "data"),
  );
  app.quit();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.restore();
    window?.show();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (stopped) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void stopBackend().finally(() => {
      stopped = true;
      app.quit();
    });
  });
  app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "Everse",
            submenu: [
              {
                label: "打开用户数据目录",
                click: () => {
                  void shell.openPath(join(userRoot, "data"));
                },
              },
              { role: "quit", label: "退出" },
            ],
          },
          {
            label: "编辑",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "视图",
            submenu: [
              { role: "reload", label: "重新加载" },
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
            ],
          },
        ]),
      );
      const root = app.isPackaged
        ? join(process.resourcesPath, "backend")
        : resolve(".desktop/backend");
      const runtime = app.isPackaged
        ? join(process.resourcesPath, "runtime", "node.exe")
        : resolve(".desktop/runtime/node.exe");
      const token = randomBytes(32).toString("hex");
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      delete env.ELECTRON_RUN_AS_NODE;
      backend = fork(join(root, "server.cjs"), [], {
        execPath: runtime,
        execArgv: [],
        cwd: root,
        env,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      const port = await new Promise<number>((ok, reject) => {
        const timer = setTimeout(
          () => reject(new Error("启动本地服务超时。请重新打开应用。")),
          30000,
        );
        backend!.once("error", () => {
          clearTimeout(timer);
          reject(
            new Error("随应用安装的运行时无法启动，请重新安装完整安装包。"),
          );
        });
        backend!.once("exit", () => {
          clearTimeout(timer);
          reject(
            new Error("本地服务启动失败。请确认用户目录可写、安装文件完整。"),
          );
        });
        backend!.on("message", (message: unknown) => {
          const m = message as { type?: string; port?: number };
          if (
            m?.type === "ready" &&
            Number.isInteger(m.port) &&
            m.port! > 0 &&
            m.port! <= 65535
          ) {
            clearTimeout(timer);
            ok(m.port!);
          }
          if (m?.type === "failed") {
            clearTimeout(timer);
            reject(
              new Error("无法打开本地数据，请确认用户目录可写且数据库未损坏。"),
            );
          }
        });
        backend!.send({
          type: "start",
          root,
          data: join(userRoot, "data"),
          token,
        });
      });
      backend.once("exit", () =>
        fail("本地服务意外退出。请重新打开应用；不要删除用户数据。"),
      );
      const target = `http://127.0.0.1:${port}`;
      ipcMain.handle("everse:export-file", async (event, path: unknown) => {
        if (
          !event.senderFrame?.url.startsWith(origin + "/") ||
          typeof path !== "string" ||
          !/^\/api\/[a-zA-Z0-9_/-]+\/export$/.test(path)
        )
          throw new Error("不允许的导出请求");
        const response = await fetch(target + path, {
          headers: { "x-everse-desktop": token },
          redirect: "error",
        });
        if (!response.ok) throw new Error("导出失败，请重新读取后再试");
        const name =
          /filename="?([^";]+)"?/i.exec(
            response.headers.get("content-disposition") ?? "",
          )?.[1] ?? "everse-export.json";
        const result = await dialog.showSaveDialog(window!, {
          title: "导出文件",
          defaultPath: name
            .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
            .slice(0, 150),
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        await writeFile(
          result.filePath,
          Buffer.from(await response.arrayBuffer()),
        );
        return { canceled: false };
      });
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      protocol.handle("everse", async (request) => {
        const url = new URL(request.url);
        const initiator = (request as Request & { initiatorOrigin?: string })
          .initiatorOrigin;
        if (url.host !== "app" || (initiator && initiator !== origin))
          return new Response("Forbidden", { status: 403 });
        const headers = new Headers(request.headers);
        headers.delete("host");
        headers.delete("cookie");
        headers.set("origin", target);
        headers.set("x-everse-desktop", token);
        try {
          const response = await fetch(target + url.pathname + url.search, {
            method: request.method,
            headers,
            redirect: "error",
            signal: request.signal,
            body: ["GET", "HEAD"].includes(request.method)
              ? undefined
              : await request.arrayBuffer(),
          });
          const resultHeaders = new Headers(response.headers);
          resultHeaders.delete("content-encoding");
          resultHeaders.delete("content-length");
          resultHeaders.set("Cache-Control", "no-store");
          resultHeaders.set(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'",
          );
          return new Response(response.body, {
            status: response.status,
            headers: resultHeaders,
          });
        } catch {
          return Response.json(
            {
              error:
                "本地服务连接已中断，请重新打开 Everse。已保存的数据不会丢失。",
            },
            { status: 503 },
          );
        }
      });
      window = new BrowserWindow({
        title: "Everse",
        width: 1360,
        height: 900,
        minWidth: 375,
        minHeight: 600,
        show: false,
        backgroundColor: "#fbfaf6",
        webPreferences: {
          preload: join(app.getAppPath(), "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith(origin + "/")) event.preventDefault();
      });
      window.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      window.once("ready-to-show", () => window?.show());
      await window.loadURL(origin + "/");
    })
    .catch((error: unknown) =>
      fail(
        error instanceof Error
          ? error.message
          : "启动失败，请重新安装完整安装包。",
      ),
    );
}
