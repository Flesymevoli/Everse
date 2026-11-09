import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 24 || (major === 24 && minor < 20))
  throw new Error("Use Node.js 24.20+ or run start.cmd on Windows.");
const setupOnly = process.argv.includes("--setup-only");
const port = Number(process.env.EVERSE_PORT ?? process.env.YUNO_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid EVERSE_PORT");
if (!setupOnly)
  await new Promise((ok, fail) => {
    const probe = createServer();
    probe.once("error", () =>
      fail(
        new Error(
          `Port ${port} is busy. Close the previous application first; no process was stopped.`,
        ),
      ),
    );
    probe.listen(port, "127.0.0.1", () => probe.close(ok));
  });
const npmCli =
  process.env.npm_execpath ??
  join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
if (!existsSync(npmCli))
  throw new Error("Cannot find npm. Run npm run setup or start.cmd.");
function run(args) {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", fail);
    child.once("exit", (code) =>
      code === 0
        ? ok()
        : fail(
            new Error(`Command failed (${code}): ${args.slice(1).join(" ")}`),
          ),
    );
  });
}
mkdirSync(".runtime", { recursive: true });
const statePath = resolve(".runtime/install-state.json");
let state = {};
try {
  state = JSON.parse(readFileSync(statePath, "utf8"));
} catch {}
const digest = (files) => {
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(f);
    hash.update(readFileSync(f));
  }
  return hash.digest("hex");
};
const lock = digest(["package.json", "package-lock.json"]);
if (state.lock !== lock || !existsSync("node_modules/.package-lock.json")) {
  console.log("Installing locked dependencies (npm ci).");
  await run([npmCli, "ci", "--include=dev", "--no-fund", "--no-audit"]);
  state = {};
}
function files(path) {
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) =>
      e.isDirectory()
        ? files(join(path, e.name))
        : e.isFile()
          ? [join(path, e.name)]
          : [],
    );
}
const source = digest([
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  ...files("src"),
  ...files("shared"),
  ...files("server"),
]);
if (
  state.source !== source ||
  state.lock !== lock ||
  !existsSync("dist/index.html")
) {
  console.log("Building Everse.");
  await run([npmCli, "run", "build"]);
}
writeFileSync(statePath, JSON.stringify({ lock, source }));
console.log(
  "Setup complete. Saves remain in data/game.sqlite (or EVERSE_DATA_DIR).",
);
if (setupOnly) process.exit(0);
const child = spawn(
  process.execPath,
  ["--import", "tsx", "server/index.ts", "--production"],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
let stopped = false;
child.once("exit", (code) => {
  stopped = true;
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    child.kill(signal);
  });
const url = `http://127.0.0.1:${port}`;
let ready = false;
for (let i = 0; i < 60 && !stopped; i++) {
  try {
    const r = await fetch(url + "/api/health", {
      signal: AbortSignal.timeout(500),
    });
    const health = await r.json();
    if (health.application === "Everse" && health.status === "ok") {
      ready = true;
      console.log(
        `Ready: ${url} — keep this window open; Ctrl+C stops the application.`,
      );
      if (
        process.platform === "win32" &&
        !process.argv.includes("--no-browser")
      ) {
        const browser = spawn("explorer.exe", [url], {
          windowsHide: true,
          stdio: "ignore",
        });
        browser.on("error", () => console.log(`Open ${url} in your browser.`));
        browser.unref();
      }
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
if (!ready && !stopped) {
  console.error("Startup health check timed out. No browser was opened.");
  child.kill("SIGTERM");
  process.exitCode = 1;
}
