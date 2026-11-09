import { z } from "zod";
export const promptModuleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["preset", "mod"]).default("preset"),
    content: z
      .string()
      .max(40000)
      .refine((value) => value.trim().length > 0, "请输入提示词内容"),
    enabled: z.boolean().default(false),
    trigger: z.literal("always").default("always"),
    scope: z.literal("global").default("global"),
    position: z.enum(["prefix", "suffix"]).default("prefix"),
    order: z.number().int().min(-10000).max(10000).default(0),
    priority: z.number().int().min(-100).max(100).default(0),
  })
  .strict();
export const promptModuleFileSchema = z
  .object({
    format: z.literal("everse_prompt_modules_v1"),
    modules: z.array(promptModuleSchema).min(1).max(100),
  })
  .strict();
export type PromptModule = z.infer<typeof promptModuleSchema>;
export type StoredPromptModule = PromptModule & { id: string };
export function orderedModules(modules: StoredPromptModule[]) {
  return modules
    .filter((m) => m.enabled)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.order - b.order ||
        a.id.localeCompare(b.id),
    );
}
