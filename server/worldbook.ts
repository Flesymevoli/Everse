import { z } from "zod";
import type { Message } from "./context.js";
const entrySchema = z
  .object({
    key: z.array(z.string()).default([]),
    keysecondary: z.array(z.string()).default([]),
    content: z.string(),
    disable: z.boolean().default(false),
    constant: z.boolean().default(false),
    selective: z.boolean().default(false),
    selectiveLogic: z.number().int().min(0).max(3).default(0),
    order: z.number().default(100),
    position: z.number().int().default(0),
    depth: z.number().int().min(0).max(1000).default(4),
    role: z.number().int().min(0).max(2).nullable().optional(),
    probability: z.number().min(0).max(100).nullable().optional(),
    useProbability: z.boolean().default(true),
    excludeRecursion: z.boolean().default(false),
    preventRecursion: z.boolean().default(false),
    delayUntilRecursion: z
      .union([z.boolean(), z.number().int().min(0).max(500)])
      .default(false),
    scanDepth: z.number().int().min(0).max(1000).nullable().optional(),
    caseSensitive: z.boolean().nullable().optional(),
    matchWholeWords: z.boolean().nullable().optional(),
  })
  .passthrough();
export const bookSchema = z
  .object({ entries: z.record(z.string(), entrySchema) })
  .passthrough();
export function importBook(raw: unknown) {
  const book = bookSchema.parse(raw);
  if (Object.keys(book.entries).length > 500)
    throw new Error("世界书上限 500 条");
  const warnings: string[] = [];
  const keys = new Set(Object.keys(entrySchema.shape));
  for (const key of Object.keys(book))
    if (key !== "entries") warnings.push("未执行 book." + key);
  for (const [id, entry] of Object.entries(book.entries)) {
    for (const key of Object.keys(entry))
      if (!keys.has(key))
        warnings.push("保留但未执行 entries." + id + "." + key);
    if (![0, 1, 4].includes(entry.position))
      warnings.push("跳过条目 " + id + "：暂只执行 position 0/1/4");
    if (entry.key.some((key) => key.startsWith("/")))
      warnings.push("条目 " + id + " 的正则关键词暂按普通文本匹配");
  }
  return { original: raw, warnings };
}
export function evaluateBook(
  raw: unknown,
  history: Message[],
  input: string,
  depth = 2,
  options: {
    recursive?: boolean;
    maxRecursionSteps?: number;
    random?: () => number;
    expand?: (text: string) => string;
  } = {},
) {
  const book = bookSchema.parse(raw);
  const activated = new Set<string>(),
    failed = new Set<string>();
  let recursionText = "";
  const source = Object.entries(book.entries).sort(
    (a, b) => b[1].order - a[1].order,
  );
  const limit = options.recursive
    ? Math.min(options.maxRecursionSteps || 500, 500)
    : 0;
  for (let pass = 0; pass <= limit; pass++) {
    const newly = source.filter(([id, entry]) => {
      if (activated.has(id) || failed.has(id)) return false;
      if (pass > 0 && entry.excludeRecursion) return false;
      const delayed =
        entry.delayUntilRecursion === true
          ? 1
          : Number(entry.delayUntilRecursion);
      if (pass < delayed) return false;
      if (entry.disable || ![0, 1, 4].includes(entry.position)) return false;
      if (entry.constant) return true;
      const scanDepth = entry.scanDepth ?? depth;
      const scan =
        [...history.map((m) => m.content), input]
          .slice(-scanDepth || Infinity)
          .join("\n") +
        "\n" +
        recursionText;
      const has = (key: string) => {
        if (!key) return false;
        const text = entry.caseSensitive ? scan : scan.toLowerCase();
        const needle = entry.caseSensitive ? key : key.toLowerCase();
        if (!entry.matchWholeWords) return text.includes(needle);
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(
          "(^|[^\\p{L}\\p{N}_])" + escaped + "(?=$|[^\\p{L}\\p{N}_])",
          "u",
        ).test(text);
      };
      if (!entry.key.some(has)) return false;
      if (!entry.selective || !entry.keysecondary.length) return true;
      const values = entry.keysecondary.map(has);
      return [
        values.some(Boolean),
        !values.every(Boolean),
        !values.some(Boolean),
        values.every(Boolean),
      ][entry.selectiveLogic];
    });
    const accepted = newly.filter(([id, entry]) => {
      if (
        entry.useProbability &&
        entry.probability != null &&
        entry.probability < 100 &&
        (entry.probability === 0 ||
          (options.random ?? Math.random)() * 100 > entry.probability)
      ) {
        failed.add(id);
        return false;
      }
      activated.add(id);
      return true;
    });
    const propagated = accepted
      .filter(([, entry]) => !entry.preventRecursion)
      .map(([, entry]) =>
        (options.expand ?? ((s: string) => s))(entry.content),
      );
    recursionText += "\n" + propagated.join("\n");
    const pendingDelay = source.some(
      ([id, entry]) =>
        !activated.has(id) &&
        !failed.has(id) &&
        Number(entry.delayUntilRecursion) > pass,
    );
    if (!propagated.length && !pendingDelay) break;
  }
  const matched = source.filter(([id]) => activated.has(id));
  return {
    before: matched
      .filter(([, e]) => e.position === 0)
      .map(([, e]) => e.content),
    after: matched
      .filter(([, e]) => e.position === 1)
      .map(([, e]) => e.content),
    injections: matched
      .filter(([, entry]) => entry.position === 4)
      .map(([id, entry]) => ({
        id,
        depth: entry.depth,
        role: (["system", "user", "assistant"] as const)[entry.role ?? 0],
        content: entry.content,
      })),
    failedProbability: [...failed],
    matched: matched.map(([id]) => id),
  };
}
