import { z } from "zod";

export const factSchema = z
  .object({
    key: z.string().trim().min(1).max(80),
    kind: z.enum(["scene", "person", "goal", "fact", "event"]),
    value: z.string().trim().min(1).max(600),
    evidence: z.string().trim().min(1).max(600),
    panel: z
      .object({
        group: z.enum(["character", "inventory"]),
        entity: z.string().trim().min(1).max(60),
        label: z.string().trim().min(1).max(60),
      })
      .strict()
      .optional(),
  })
  .strict();
export type StoryFact = z.infer<typeof factSchema>;
export const storyPatchSchema = z
  .object({ changes: z.array(factSchema).max(16) })
  .strict();
export type StoryPatch = z.infer<typeof storyPatchSchema> & { base: string };
export type SourcedFact = StoryFact & { source: number; corrected?: boolean };
export type StoryView = {
  facts: SourcedFact[];
  invalidated: number;
  revision: string;
};
export type Correction = {
  id: number;
  anchor: string;
  count: number;
  key: string;
  value: string | null;
};
export const storyMarker = "<story_update>";
export const storyEnd = "</story_update>";
export function visibleStory(text: string): string {
  const start = text.indexOf(storyMarker);
  if (start >= 0) return text.slice(0, start).trimEnd();
  // Do not flash a partially streamed protocol delimiter in the reading view.
  for (let n = storyMarker.length - 1; n > 0; n--)
    if (text.endsWith(storyMarker.slice(0, n))) return text.slice(0, -n);
  return text;
}
