import { z } from "zod";
import { importBook } from "./worldbook.js";
import { importWorld, worldSchema } from "./worlds.js";
export const worldEditSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(100000),
    first_mes: z.string().max(100000),
    worldbook: z.unknown().optional(),
  })
  .strict();
export function editWorld(item: ReturnType<typeof importWorld>, raw: unknown) {
  const patch = worldEditSchema.parse(raw);
  if (patch.worldbook !== undefined) importBook(patch.worldbook);
  const original = item.original as Record<string, unknown>;
  const standalone = "entries" in original;
  const book =
    patch.worldbook ??
    (standalone
      ? original
      : (original.data as Record<string, unknown>).worldbook);
  const metadata = {
    name: patch.name,
    description: patch.description,
    first_mes: patch.first_mes,
  };
  // Keep ST entries and all unknown fields at their original paths. App-only metadata is namespaced.
  const updated = standalone
    ? {
        ...(book as Record<string, unknown>),
        _yunotavern: {
          ...((original._yunotavern as Record<string, unknown>) ?? {}),
          ...metadata,
        },
      }
    : {
        ...original,
        data: {
          ...(original.data as Record<string, unknown>),
          ...metadata,
          ...(book === undefined ? {} : { worldbook: book }),
        },
      };
  const result = importWorld(updated, patch.name);
  worldSchema.parse(result.world);
  return result;
}
