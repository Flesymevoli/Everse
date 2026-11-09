import { z } from "zod";
export function validationMessage(error: z.ZodError) {
  const labels: Record<string, string> = {
    budget: "上下文预算",
    reserve: "回复上限",
    "config.baseUrl": "API 地址",
    "config.model": "模型 ID",
    "config.apiKey": "API Key",
    name: "名称",
    opening: "开场剧情",
    openai_max_tokens: "预设回复上限",
    openai_max_context: "预设上下文上限",
  };
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.join(".").slice(0, 100);
      const field = labels[path] ?? (path || "请求字段");
      switch (issue.code) {
        case "too_small":
          return `${field}：${issue.inclusive ? "不能小于" : "必须大于"} ${issue.minimum}`;
        case "too_big":
          return `${field}：不能超过 ${issue.maximum}`;
        case "unrecognized_keys":
          return `${field}：含不支持的字段`;
        default:
          return `${field}：类型或格式不正确`;
      }
    })
    .join("；");
}
