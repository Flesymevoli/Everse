import { z } from "zod";
const entry = z
  .object({
    keys: z.array(z.string()).default([]),
    content: z.string(),
    enabled: z.boolean().default(true),
    constant: z.boolean().default(false),
    case_sensitive: z.boolean().default(false),
  })
  .passthrough();
export const cardSchema = z
  .object({
    spec: z.enum(["chara_card_v2", "chara_card_v3"]),
    spec_version: z.string(),
    data: z
      .object({
        name: z.string().trim().min(1),
        description: z.string().default(""),
        personality: z.string().default(""),
        scenario: z.string().default(""),
        first_mes: z.string().default(""),
        alternate_greetings: z.array(z.string()).optional(),
        system_prompt: z.string().default(""),
        post_history_instructions: z.string().default(""),
        character_book: z
          .object({ entries: z.array(entry).max(500) })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type Card = z.infer<typeof cardSchema>;
export function importCard(raw: unknown) {
  const card = cardSchema.parse(raw);
  const warnings: string[] = [];
  const known = new Set([
    "name",
    "description",
    "personality",
    "scenario",
    "first_mes",
    "alternate_greetings",
    "system_prompt",
    "post_history_instructions",
    "character_book",
  ]);
  for (const key of Object.keys(card.data))
    if (!known.has(key)) warnings.push("保留但未使用 data." + key);
  for (const key of Object.keys(card))
    if (!["spec", "spec_version", "data"].includes(key))
      warnings.push("保留但未使用 " + key);
  if (card.data.character_book) {
    for (const key of Object.keys(card.data.character_book))
      if (key !== "entries") warnings.push("未应用 character_book." + key);
    card.data.character_book.entries.forEach((item, i) => {
      for (const key of Object.keys(item))
        if (
          ![
            "keys",
            "content",
            "enabled",
            "constant",
            "case_sensitive",
          ].includes(key)
        )
          warnings.push("未应用 entries[" + i + "]." + key);
    });
  }
  if (JSON.stringify(card.data).includes("{{"))
    warnings.push("仅替换 {{char}} 和 {{user}}，其他宏原样保留");
  warnings.push(
    "世界书仅扫描最近 6 条消息，按原顺序插入系统上下文；不执行脚本或 HTML",
  );
  warnings.push(
    "备选开场仅支持单人存档首轮前选择；未实现通用 Swipe 和群聊随机开场",
  );
  return { card, warnings, original: structuredClone(raw) };
}
export { greetings, expand } from "../shared/character-text.js";
