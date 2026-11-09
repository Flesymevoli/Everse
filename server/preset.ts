import { z } from "zod";
import { tokenLimit } from "./budget.js";
export const parametersSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    seed: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).optional(),
    stop: z.array(z.string().min(1).max(1000)).max(4).optional(),
  })
  .strict();
export type Parameters = z.infer<typeof parametersSchema>;
export const presetSchema = z
  .object({
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    frequency_penalty: z.number().optional(),
    presence_penalty: z.number().optional(),
    seed: z.number().optional(),
    stop: z.array(z.string()).optional(),
    openai_max_tokens: tokenLimit.optional(),
    openai_max_context: tokenLimit.optional(),
    prompts: z
      .array(
        z
          .object({
            identifier: z.string(),
            role: z.enum(["system", "user", "assistant"]).default("system"),
            content: z.string().default(""),
            marker: z.boolean().default(false),
            injection_position: z.number().default(0),
            forbid_overrides: z.boolean().default(false),
          })
          .passthrough(),
      )
      .optional(),
    prompt_order: z
      .array(
        z
          .object({
            character_id: z.number(),
            order: z.array(
              z
                .object({
                  identifier: z.string(),
                  enabled: z.boolean(),
                })
                .passthrough(),
            ),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export function importPreset(raw: unknown) {
  function rejectSecrets(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (
        /^(api_?key|authorization|access_?token|secret_?key)$/i.test(key) &&
        item
      )
        throw new Error(
          "预设含凭据字段，请移除后再导入；密钥只在 API 设置中填写",
        );
      rejectSecrets(item);
    }
  }
  rejectSecrets(raw);
  const parsed = presetSchema.parse(raw);
  const warnings: string[] = [
    "角色覆盖 main/jailbreak 尊重存档偏好、forbid_overrides 和启用状态；支持 char/user/original 宏",
  ];
  const markers = new Set([
    "charDescription",
    "charPersonality",
    "scenario",
    "worldInfoBefore",
    "worldInfoAfter",
    "chatHistory",
  ]);
  const activeOrder =
    parsed.prompt_order?.find((order) => order.character_id === 100001)
      ?.order ?? [];
  for (const item of activeOrder.filter((item) => item.enabled)) {
    const prompt = parsed.prompts?.find(
      (prompt) => prompt.identifier === item.identifier,
    );
    if (!markers.has(item.identifier) && (!prompt || prompt.marker))
      warnings.push("未执行 marker：" + item.identifier);
  }
  if (
    parsed.prompts &&
    !activeOrder.some(
      (item) => item.identifier === "chatHistory" && item.enabled,
    )
  )
    warnings.push("预设未启用 chatHistory：当前输入与聊天历史不会发送");
  if (parsed.prompt_order?.some((order) => order.character_id !== 100001))
    warnings.push("仅执行全局 character_id 100001，其他角色顺序保留但不执行");
  for (const key of Object.keys(parsed))
    if (!(key in presetSchema.shape))
      warnings.push("保留但未执行 preset." + key);
  for (const prompt of parsed.prompts ?? []) {
    for (const key of Object.keys(prompt))
      if (
        ![
          "identifier",
          "role",
          "content",
          "marker",
          "injection_position",
          "forbid_overrides",
          "name",
        ].includes(key)
      )
        warnings.push("保留但未执行 prompts." + prompt.identifier + "." + key);
    if (prompt.injection_position !== 0)
      warnings.push("跳过非相对位置提示：" + prompt.identifier);
  }
  if (
    parsed.prompts &&
    !parsed.prompt_order?.some((order) => order.character_id === 100001)
  )
    throw new Error(
      "预设缺少全局 prompt_order（character_id 100001），暂不推断执行顺序",
    );
  const parameters = parametersSchema.parse(
    Object.fromEntries(
      Object.keys(parametersSchema.shape)
        .filter((key) => key in parsed)
        .map((key) => [key, parsed[key]]),
    ),
  );
  return { original: raw, warnings, parameters };
}
