import { z } from "zod";
export const textSelectionSchema = z
  .object({
    index: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    original: z.string().min(1).max(100000),
    revision: z.string().length(64),
  })
  .strict();
export type TextSelection = z.infer<typeof textSelectionSchema>;
