import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Store } from "./store.js";
import { createApp } from "./app.js";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const production = process.argv.includes("--production");
const port = Number(
  process.env.EVERSE_PORT ??
    process.env.YUNO_PORT ??
    (production ? 5173 : 8787),
);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("EVERSE_PORT must be between 1 and 65535");
if (production && !existsSync("dist/index.html"))
  throw new Error("Run npm run build before npm start");
const data = resolve(
  process.env.EVERSE_DATA_DIR ?? process.env.YUNO_DATA_DIR ?? "data",
);
mkdirSync(data, { recursive: true });
const store = new Store(resolve(data, "game.sqlite"));
const app = createApp(store, undefined, production ? port : 5173);
if (production) {
  app.get("/", serveStatic({ path: "dist/index.html" }));
  app.get("/assets/*", serveStatic({ root: "dist" }));
}
const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port,
});
server.on("listening", () => console.log(`Everse http://127.0.0.1:${port}`));
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is in use. Close the previous Everse window or choose EVERSE_PORT.`
      : error.message,
  );
  store.close();
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
