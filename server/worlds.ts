import { readPlayer } from "../shared/player.js";
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
export function importWorld(raw: unknown, name = "导入的世界书") {
  const isBook = typeof raw === "object" && raw !== null && "entries" in raw;
  const meta = isBook
    ? (raw as Record<string, unknown>)._yunotavern
    : undefined;
  const appMeta =
    meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
  const world = worldSchema.parse(
    isBook
      ? { spec: "yuno_world_v1", data: { name, ...appMeta, worldbook: raw } }
      : raw,
  );
  const warnings = world.data.worldbook
    ? importBook(world.data.worldbook).warnings.filter(
        (w) => w !== "未执行 book._yunotavern",
      )
    : [];
  for (const k of Object.keys(world))
    if (!["spec", "data"].includes(k)) warnings.push("保留但未执行 world." + k);
  for (const k of Object.keys(world.data))
    if (!["name", "description", "first_mes", "worldbook"].includes(k))
      warnings.push(
        k === "extensions" && readPlayer(world.data)
          ? "extensions.yunotavern.player 用作玩家身份；其他扩展保留但不执行"
          : "保留但未执行 world.data." + k,
      );
  return { world, warnings, original: structuredClone(raw) };
}
export function combinedCard(
  card: Card | undefined,
  world: World | undefined,
  source?: { name: string; text: string },
): Card {
  if (!card && !world && !source?.text.trim())
    throw new Error("请写下故事设定，或选择已有角色卡/世界书");
  return (
    card ??
    cardSchema.parse({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { name: world?.data.name || source?.name || "未命名故事" },
    })
  );
}
