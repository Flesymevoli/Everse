import { z } from "zod";
import { cardSchema, type Card } from "./cards.js";
import { bookSchema, importBook } from "./worldbook.js";
export const worldSchema = z
  .object({
    spec: z.literal("yuno_world_v1"),
    data: z
      .object({
        name: z.string().trim().min(1).max(100),
        description: z.string().max(100000).default(""),
        first_mes: z.string().max(100000).default(""),
        worldbook: bookSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type World = z.infer<typeof worldSchema>;
export function importWorld(raw: unknown, name = "导入的世界") {
  const isBook = typeof raw === "object" && raw !== null && "entries" in raw;
  const world = worldSchema.parse(
    isBook ? { spec: "yuno_world_v1", data: { name, worldbook: raw } } : raw,
  );
  const warnings = world.data.worldbook
    ? importBook(world.data.worldbook).warnings
    : [];
  for (const k of Object.keys(world))
    if (!["spec", "data"].includes(k)) warnings.push("保留但未执行 world." + k);
  for (const k of Object.keys(world.data))
    if (!["name", "description", "first_mes", "worldbook"].includes(k))
      warnings.push("保留但未执行 world.data." + k);
  return { world, warnings, original: structuredClone(raw) };
}
export function combinedCard(
  card: Card | undefined,
  world: World | undefined,
): Card {
  if (!card && !world) throw new Error("请选择世界卡或角色卡");
  return (
    card ??
    cardSchema.parse({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { name: world!.data.name },
    })
  );
}
