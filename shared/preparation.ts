import { z } from "zod";
import { playerSchema } from "./player.js";
import { openingGuideSchema } from "./opening-guide.js";
const simple = z.object({
  name: z.string().trim().max(100).default(""),
  description: z.string().max(100000).default(""),
});
export const preparationSchema = z
  .object({
    guide: openingGuideSchema.optional(),
    source: z
      .object({
        name: z.string().max(100),
        format: z.enum(["text", "txt", "md", "docx"]),
        text: z.string().max(100000),
        documentId: z.string().uuid().optional(),
        reference: z.boolean().optional(),
        characters: z.number().int().nonnegative().optional(),
        warnings: z.array(z.string().max(4000)).max(20).optional(),
      })
      .strict()
      .optional(),
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
