import { z } from "zod";
import { playerSchema, withPlayer } from "../shared/player.js";
import { importCard } from "./cards.js";
import { importWorld } from "./worlds.js";
import type { Store } from "./store.js";
import { expand } from "./cards.js";
export const creationSchema = z
  .object({
    kind: z.enum(["worlds", "characters"]),
    name: z.string().trim().max(100).default(""),
    description: z.string().max(100000).default(""),
    opening: z.string().max(100000).default(""),
    player: playerSchema.optional(),
    personality: z.string().max(100000).default(""),
    scenario: z.string().max(100000).default(""),
    worldbook: z.unknown().optional(),
    start: z.boolean().default(true),
  })
  .strict();
export function createWork(store: Store, raw: unknown) {
  const body = creationSchema.parse(raw);
  const name =
    body.name || (body.kind === "worlds" ? "未命名世界" : "未命名角色");
  const base = {
    name,
    description: body.description,
    first_mes: body.opening,
    ...(body.kind === "worlds"
      ? body.worldbook === undefined
        ? {}
        : { worldbook: body.worldbook }
      : { personality: body.personality, scenario: body.scenario }),
  };
  const data = body.player ? withPlayer(base, body.player) : base;
  const imported =
    body.kind === "worlds"
      ? importWorld({ spec: "yuno_world_v1", data })
      : importCard({ spec: "chara_card_v2", spec_version: "2.0", data });
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const id =
      "world" in imported ? store.addWorld(imported) : store.addCard(imported);
    let sessionId: string | undefined;
    if (body.start) {
      sessionId = store.create(
        body.kind === "characters" ? id : "",
        body.opening
          ? [
              {
                role: "assistant",
                content: expand(body.opening, name, body.player?.name),
              },
            ]
          : [],
      );
      if (body.kind === "worlds") store.setOptions(sessionId, { worldId: id });
    }
    store.db.exec("COMMIT");
    return { id, sessionId };
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
