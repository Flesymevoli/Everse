import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { Store } from "./store.js";
import { createApp } from "./app.js";
import { configureNetwork } from "./network.js";

// A private child entry point: no CLI port, environment data path, or development server.
const start = z
  .object({
    type: z.literal("start"),
    data: z.string().min(1),
    root: z.string().min(1),
    token: z.string().length(64),
  })
  .strict();
let store: Store | undefined;
let server: ReturnType<typeof createServer> | undefined;
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  const finish = () => {
    store?.close();
    process.exit(0);
  };
  if (!server) return finish();
  server.close(finish);
  server.closeAllConnections();
  setTimeout(finish, 2000).unref();
}
process.on("disconnect", stop); // Parent crash must not leave a hidden backend running.
process.on("SIGTERM", stop);
process.on("message", (raw) => {
  if (raw && typeof raw === "object" && "type" in raw && raw.type === "stop")
    return stop();
  if (server) return;
  try {
    const value = start.parse(raw);
    configureNetwork();
    process.chdir(value.root);
    mkdirSync(value.data, { recursive: true });
    store = new Store(join(value.data, "game.sqlite"));
    server = createServer();
    server.once("error", () => {
      process.send?.({ type: "failed" });
      stop();
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      if (!address || typeof address === "string") return stop();
      const app = createApp(store!, undefined, address.port);
      app.get("/", serveStatic({ path: "dist/index.html" }));
      app.get("/assets/*", serveStatic({ root: "dist" }));
      app.get("/figma/*", serveStatic({ root: "dist" }));
      server!.on(
        "request",
        getRequestListener((request) => {
          if (request.headers.get("x-everse-desktop") !== value.token)
            return new Response("Forbidden", { status: 403 });
          return app.fetch(request);
        }),
      );
      process.send?.({ type: "ready", port: address.port });
    });
  } catch {
    // Never send database contents or credentials to startup logs.
    process.send?.({ type: "failed" });
    stop();
  }
});
if (!process.send) throw new Error("Desktop backend requires a parent process");
setTimeout(() => {
  if (!server) stop();
}, 30000).unref();
