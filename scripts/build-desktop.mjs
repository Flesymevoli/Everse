import { build } from "esbuild";
import { mkdir, readFile, writeFile, cp, copyFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setGlobalProxyFromEnv } from "node:http";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("This release build supports Windows x64 only.");
setGlobalProxyFromEnv();
const version = "24.20.0";
const zipName = `node-v${version}-win-x64.zip`;
const expected = "6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba";
const stage = resolve(".desktop");
const cache = resolve(".runtime/desktop");
await mkdir(cache, { recursive: true });
let zip;
try { zip = await readFile(join(cache, zipName)); } catch {}
if (!zip || createHash("sha256").update(zip).digest("hex") !== expected) {
  const response = await fetch(`https://nodejs.org/dist/v${version}/${zipName}`, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Official Node download failed: HTTP ${response.status}`);
  zip = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(zip).digest("hex") !== expected)
    throw new Error("Official Node archive SHA-256 mismatch; nothing executed.");
  await writeFile(join(cache, zipName), zip);
}
// Extract only an authenticated official archive, never app data. No npm/runtime download on player machines.
execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:EVERSE_BUILD_ZIP); try { $d=Join-Path $env:EVERSE_BUILD_EXTRACT 'node-v24.20.0-win-x64'; New-Item -ItemType Directory -Force $d | Out-Null; foreach($n in @('node.exe','LICENSE')) { [IO.Compression.ZipFileExtensions]::ExtractToFile($z.GetEntry('node-v24.20.0-win-x64/'+$n),(Join-Path $d $n),$true) } } finally { $z.Dispose() }"],
  { windowsHide: true, env: { ...process.env, EVERSE_BUILD_ZIP: join(cache, zipName), EVERSE_BUILD_EXTRACT: cache } });
await mkdir(join(stage, "runtime"), { recursive: true });
for (const name of ["node.exe", "LICENSE"]) await copyFile(join(cache, `node-v${version}-win-x64`, name), join(stage, "runtime", name));
await mkdir(join(stage, "app"), { recursive: true });
await mkdir(join(stage, "backend"), { recursive: true });
await build({ entryPoints: ["desktop/main.ts"], outfile: join(stage, "app/main.cjs"), bundle: true, platform: "node", format: "cjs", external: ["electron"], target: "node24" });
await build({ entryPoints: ["desktop/preload.ts"], outfile: join(stage, "app/preload.cjs"), bundle: true, platform: "node", format: "cjs", external: ["electron"], target: "node24" });
const backend = await build({ entryPoints: ["server/desktop-entry.ts"], outfile: join(stage, "backend/server.cjs"), bundle: true, platform: "node", format: "cjs", target: "node24", metafile: true });
const stagedDist = resolve(stage, "backend/dist");
if (stagedDist !== resolve(root, ".desktop/backend/dist")) throw new Error("Unexpected staging path");
await rm(stagedDist, { recursive: true, force: true });
await cp("dist", stagedDist, { recursive: true });
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(join(stage, "app/package.json"), JSON.stringify({ name: "everse", version: pkg.version, description: "Local-first interactive fiction", author: "Everse contributors", license: "MIT", main: "main.cjs" }, null, 2));
await copyFile("LICENSE", join(stage, "app/LICENSE"));
// Distribute licenses for every dependency actually included in the backend bundle.
const modules = new Set(Object.keys(backend.metafile.inputs).flatMap(path => {
  const match = path.replaceAll("\\", "/").match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  return match ? [match[1]] : [];
}));
const notices = ["Everse backend third-party notices\n"];
for (const name of ["react", "react-dom", "scheduler"]) modules.add(name);
for (const name of [...modules].sort()) {
  const dir = join("node_modules", name);
  const p = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  notices.push(`\n## ${name} ${p.version} (${p.license ?? "see license"})\n`);
  for (const f of await readdir(dir)) if (/^(license|copying|notice)/i.test(f)) notices.push(await readFile(join(dir, f), "utf8"));
}
await writeFile(join(stage, "backend/THIRD-PARTY-NOTICES.txt"), notices.join("\n"));
console.log("Desktop staging complete: bundled static UI, backend and verified Node runtime.");
