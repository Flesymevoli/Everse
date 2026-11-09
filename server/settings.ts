import { z } from "zod";
import { parametersSchema } from "./preset.js";
export const optionsSchema = z
  .object({
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
