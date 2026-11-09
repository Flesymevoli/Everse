import { preparationSchema } from "../shared/preparation.js";
import { playerSchema } from "../shared/player.js";
import { z } from "zod";
import { directorSchema } from "../shared/director.js";
import { parametersSchema } from "./preset.js";
export const optionsSchema = z
  .object({
    conversationalStart: z.boolean().optional(),
    storySource: preparationSchema.shape.source,
    storyTracking: z.boolean().optional(),
    openingState: z.enum(["preparing", "started"]).optional(),
    openingDraft: preparationSchema.optional(),
    player: playerSchema.optional(),
    openingGuide: preparationSchema.shape.guide,
    director: directorSchema.optional(),
    directorRevision: z.number().int().nonnegative().optional(),
    worldId: z.string().nullable().optional(),
    recursive: z.boolean().optional(),
    maxRecursionSteps: z.number().int().min(0).max(500).optional(),
    preferCharacterPrompt: z.boolean().optional(),
    preferCharacterInstructions: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    archived: z.boolean().optional(),
    worldbookId: z.string().nullable().optional(),
    presetId: z.string().nullable().optional(),
    scanDepth: z.number().int().min(0).max(1000).optional(),
    parameters: parametersSchema.optional(),
    chatHeader: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type SessionOptions = z.infer<typeof optionsSchema>;
