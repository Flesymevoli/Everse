import { z } from "zod";
export const directorSchema = z
  .object({
    characters: z.string().max(10000).default(""),
    playerState: z.string().max(10000).default(""),
    world: z.string().max(10000).default(""),
    direction: z.string().max(10000).default(""),
  })
  .strict();
export type Director = z.infer<typeof directorSchema>;
export function directorInstruction(value: Director | undefined) {
  if (!value || !Object.values(value).some((v) => v.trim())) return "";
  return (
    "玩家对当前存档的明确修订：在与旧设定/记忆冲突时采用以下修订，未涉及部分继续尊重作者设定。characters为人物修订，playerState为玩家当前状态，world为世界观修订，direction只是未来剧情走向，不是已经发生的事件。不改写过去正文。\n" +
    JSON.stringify(value)
  );
}
