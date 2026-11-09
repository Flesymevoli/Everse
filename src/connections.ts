import { z } from "zod";
import type { Config } from "../server/provider";
export interface Connection {
  saved?: boolean;
  hasKey?: boolean;
  dirty?: boolean;
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}
export interface Connections {
  profiles: Connection[];
  selectedId: string | null;
}
export const connectionStorageKey = "narrative.connections.v1";
const metadata = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(100),
  baseUrl: z.string().max(2000),
  model: z.string().max(200),
  saved: z.boolean().optional(),
});
function safeUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}
export function restoreConnections(raw: string | null): Connections {
  try {
    const value = JSON.parse(raw ?? "[]");
    const envelope = Array.isArray(value)
      ? { profiles: value, selectedId: null }
      : z
          .object({
            profiles: z.array(z.unknown()),
            selectedId: z.string().nullable(),
          })
          .parse(value);
    const parsed = z.array(metadata).max(50).parse(envelope.profiles);
    if (new Set(parsed.map((p) => p.id)).size !== parsed.length)
      throw new Error();
    return {
      profiles: parsed.map((p) => ({
        ...p,
        baseUrl: safeUrl(p.baseUrl) ? p.baseUrl : "",
        apiKey: "",
      })),
      selectedId: envelope.selectedId,
    };
  } catch {
    return { profiles: [], selectedId: null };
  }
}
export function serializeConnections(state: Connections): string {
  // Remember the user's explicit choice, never their key. Restoring does not generate.
  return JSON.stringify({
    selectedId: state.selectedId,
    profiles: state.profiles.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: safeUrl(p.baseUrl) ? p.baseUrl : "",
      model: p.model,
      saved: p.saved,
    })),
  });
}
export function removeConnection(state: Connections, id: string): Connections {
  return {
    profiles: state.profiles.filter((p) => p.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  };
}
export function resolveConnection(state: Connections): Config {
  if (state.selectedId === null)
    return {
      mock: true,
      baseUrl: "http://127.0.0.1",
      model: "mock",
      apiKey: "",
    };
  const p = state.profiles.find((p) => p.id === state.selectedId);
  if (!p) throw new Error("所选 API 连接不存在，请重新选择");
  if (p.saved && p.dirty) throw new Error("连接已修改，请先保存再使用");
  if (!safeUrl(p.baseUrl.trim()))
    throw new Error(
      "请填写有效的 HTTP(S) Base URL，不要在地址中包含凭据或查询参数",
    );
  if (!p.model.trim()) throw new Error("请填写所选连接的模型 ID");
  if (p.apiKey.length > 4096) throw new Error("API Key 过长");
  return {
    mock: false,
    baseUrl: p.baseUrl.trim(),
    model: p.model.trim(),
    apiKey: p.apiKey.trim(),
  };
}
