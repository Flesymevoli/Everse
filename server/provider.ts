import type { Message } from "./context.js";
import { parametersSchema, type Parameters } from "./preset.js";
export interface Config {
  baseUrl: string;
  apiKey: string;
  model: string;
  mock: boolean;
  parameters?: Parameters;
}
export class ModelRequestError extends Error {}
export type Usage = {
  input: number | null;
  output: number | null;
  cached: number | null;
};
export function generationError(error: unknown, cancelled = false): string {
  if (cancelled) return "已停止生成，本轮未保存。";
  if (error instanceof ModelRequestError) return error.message + "本轮未保存。";
  if (error instanceof Error && error.name === "TimeoutError")
    return "模型请求超过 90 秒等待时间，本轮未保存。请检查供应商响应速度，或改用响应更快的模型。未自动重试。";
  return "模型连接或响应流未完成，本轮未保存。请检查 API 地址、网络和供应商状态；未切换到模拟模型，也未自动重试。";
}
export async function* generate(
  config: Config,
  messages: Message[],
  maxTokens: number | undefined,
  signal?: AbortSignal,
  onUsage?: (usage: Usage) => void,
): AsyncGenerator<string> {
  if (config.mock) {
    if (messages[0]?.content.startsWith("YUNO_OPENING_GUIDE")) {
      const evidence = messages[1].content
        .split(/\n/)
        .find((line) => /选择|身份/.test(line));
      yield JSON.stringify({
        questions: evidence
          ? [
              {
                question: "你希望如何回答这项开局要求？",
                choices: [],
                evidence: evidence.slice(0, 1000),
              },
            ]
          : [],
      });
      onUsage?.({ input: 0, output: 0, cached: 0 });
      return;
    }
    if (messages[0]?.content.startsWith("YUNO_IMPORT_CLASSIFICATION")) {
      const input = JSON.parse(messages[1].content) as {
        targets: { index: number; text: string }[];
      };
      yield JSON.stringify({
        sections: input.targets.map((s) => ({
          index: s.index,
          kind: /示例|举例/.test(s.text)
            ? "example"
            : /必须|禁止/.test(s.text)
              ? "rule"
              : /开局|开场/.test(s.text)
                ? "opening"
                : "lore",
        })),
      });
      onUsage?.({ input: 0, output: 0, cached: 0 });
      return;
    }
    for (const part of ["【模拟回复】", "远处的灯亮了。", "你想走近看看吗？"]) {
      await new Promise((r) => setTimeout(r, 40));
      signal?.throwIfAborted();
      yield part;
    }
    if (messages.some((m) => m.content.includes("<action_suggestions>")))
      yield '\n<action_suggestions>["走近灯光，看看是谁在等候","留在原地，听一听海风里的声音"]</action_suggestions>';
    if (messages.some((m) => m.content.includes("<story_update>")))
      yield '\n<story_update>{"changes":[{"key":"scene:灯光","kind":"scene","value":"远处有灯光","evidence":"远处的灯亮了。"}]}</story_update>';
    onUsage?.({ input: 0, output: 0, cached: 0 });
    return;
  }
  const url = new URL(config.baseUrl.replace(/\/$/, "") + "/chat/completions");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("API 地址无效");
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.any([
      AbortSignal.timeout(90000),
      ...(signal ? [signal] : []),
    ]),
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: "Bearer " + config.apiKey } : {}),
    },
    body: JSON.stringify({
      ...parametersSchema.parse(config.parameters ?? {}),
      model: config.model,
      messages,
      stream: true,
      max_tokens: maxTokens,
    }),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text();
    const reason =
      /context_length|context window|maximum context|too many tokens|prompt.{0,30}too long/i.test(
        detail,
      )
        ? "供应商报告上下文过长。请按该模型的实际容量配置手动上下文预算；如果必要设定本身超限，请精简设定。"
        : /max_tokens|max_completion_tokens|output.{0,20}tokens/i.test(detail)
          ? "供应商拒绝回复长度参数。请检查绑定预设/手动回复上限及该 API 支持的参数；自动模式未绑定上限时不发送 max_tokens。"
          : response.status === 401 || response.status === 403
            ? "请检查 API Key 和模型访问权限。"
            : "请检查模型 ID、API 地址及供应商状态。";
    // Do not echo provider bodies: some gateways reflect credentials or prompt text.
    throw new ModelRequestError(
      `模型 API 返回 HTTP ${response.status}：${reason}未自动重试。`,
    );
  }
  let buffer = "";
  let done = false;
  for await (const chunk of response.body.pipeThrough(
    new TextDecoderStream(),
  )) {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        done = true;
        continue;
      }
      const value = JSON.parse(data) as {
        choices?: { delta?: { content?: unknown }; finish_reason?: string }[];
        error?: unknown;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      if (value.usage) {
        const valid = (n: unknown) =>
          typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
        onUsage?.({
          input: valid(value.usage.prompt_tokens),
          output: valid(value.usage.completion_tokens),
          cached: valid(
            value.usage.prompt_tokens_details?.cached_tokens ??
              value.usage.prompt_cache_hit_tokens,
          ),
        });
      }
      if (value.error) throw new Error("模型返回错误");
      const choice = value.choices?.[0];
      if (choice?.finish_reason === "length")
        throw new ModelRequestError(
          "模型 API 报告回复达到输出上限（finish_reason=length），未保存不完整回复。请检查供应商默认回复长度或调整预设/手动回复上限；未自动重试。",
        );
      if (choice?.finish_reason === "stop") done = true;
      if (typeof choice?.delta?.content === "string")
        yield choice.delta.content;
    }
  }
  if (!done) throw new Error("模型流意外中断");
}
