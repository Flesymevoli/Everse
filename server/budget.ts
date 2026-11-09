import { z } from "zod";
// Numeric safety is not a model capability limit. Model limits are provider-specific.
export const tokenLimit = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
export function resolveBudget(
  context: number | undefined,
  output: number | undefined,
  preset?: { openai_max_context?: number; openai_max_tokens?: number },
) {
  const budget = preset?.openai_max_context ?? context;
  const maxTokens = preset?.openai_max_tokens ?? output;
  if (budget !== undefined && maxTokens !== undefined && maxTokens >= budget)
    throw new Error(
      "配置冲突：回复上限必须小于上下文预算。请调整手动值或绑定预设。",
    );
  return {
    budget: budget ?? 8192,
    reserve:
      maxTokens ??
      (budget === undefined ? 1024 : Math.min(1024, Math.floor(budget / 4))),
    maxTokens,
    automaticBudget: budget === undefined,
    budgetSource:
      preset?.openai_max_context !== undefined
        ? "preset"
        : context !== undefined
          ? "manual"
          : "automatic-soft-target",
    outputSource:
      preset?.openai_max_tokens !== undefined
        ? "preset"
        : output !== undefined
          ? "manual"
          : "provider-default",
  };
}
