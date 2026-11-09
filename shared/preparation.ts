import { z } from "zod";
import { playerSchema } from "./player.js";
const simple = z.object({
  name: z.string().trim().max(100).default(""),
  description: z.string().max(100000).default(""),
});
export const preparationSchema = z
  .object({
    characterMode: z.enum(["existing", "simple", "none"]),
    worldMode: z.enum(["existing", "simple", "none"]),
    cardId: z.string().default(""),
    worldId: z.string().default(""),
    character: simple,
    world: simple,
    player: playerSchema,
    opening: z.string().max(100000),
    presetId: z.string().nullable().default(null),
    worldbookId: z.string().nullable().default(null),
  })
  .strict();
export type Preparation = z.infer<typeof preparationSchema>;
