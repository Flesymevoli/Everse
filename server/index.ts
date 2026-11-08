import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Store } from "./store.js";
import { createApp } from "./app.js";
mkdirSync("data", { recursive: true });
serve({
  fetch: createApp(new Store("data/game.sqlite")).fetch,
  hostname: "127.0.0.1",
  port: 8787,
});
console.log("Narrative server http://127.0.0.1:8787");
