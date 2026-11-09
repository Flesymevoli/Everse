import { z } from "zod";
import type { Message } from "./context.js";
const rowSchema = z
  .object({
    mes: z.string(),
    is_user: z.boolean(),
    is_system: z.boolean().optional(),
    name: z.string().optional(),
  })
  .passthrough();
export function importChat(text: string) {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown);
  if (!lines.length || lines.length > 10001)
    throw new Error("聊天为空或超过 10000 条");
  const header = z.record(z.string(), z.unknown()).parse(lines.shift());
  if ("mes" in header) throw new Error("缺少 ST JSONL 头部");
  const messages: Message[] = lines.map((line) => {
    const row = rowSchema.parse(line);
    return {
      role: row.is_system ? "system" : row.is_user ? "user" : "assistant",
      content: row.mes,
      st: row,
    };
  });
  return { header, messages };
}
export function exportChat(
  messages: Message[],
  header: Record<string, unknown>,
  name: string,
) {
  return (
    [
      header,
      ...messages.map((message) => ({
        ...(message.st ?? {
          name: message.role === "user" ? "玩家" : name,
          send_date: "",
          extra: {},
        }),
        mes: message.content,
        is_user: message.role === "user",
        ...(message.role === "system" ? { is_system: true } : {}),
      })),
    ]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n"
  );
}
