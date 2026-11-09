import type { Message } from "./context.js";

export function mergeSettingEdit(
  previous: string | undefined,
  original: string,
  replacement: string,
) {
  const next = replacement.trim()
    ? replacement
    : "玩家删除了以下描述，不再将它作为有效设定：\n" + original;
  if (!previous || original.includes(previous)) return next;
  if (previous.includes(original)) return previous.replace(original, next);
  return (
    next + "\n\n较早确认的其他修订（冲突时采用上方较新修订）：\n" + previous
  );
}

// Originals remain in the message/revision store. Only request excerpts are bounded.
export function settingContext(
  history: Message[],
  query: string,
  budget = 4000,
) {
  const terms = new Set(
    Array.from(query).filter((c) => /[\p{L}\p{N}]/u.test(c)),
  );
  const chunks = history
    .flatMap((m, source) => {
      if (!m.settingOverride) return [];
      const chars = Array.from(m.settingText ?? m.content);
      const result: {
        source: number;
        part: number;
        text: string;
        score: number;
      }[] = [];
      for (let i = 0; i < chars.length; i += 500) {
        const text = chars.slice(i, i + 500).join("");
        result.push({
          source,
          part: i / 500,
          text,
          score: [...terms].filter((t) => text.includes(t)).length,
        });
      }
      return result;
    })
    .sort(
      (a, b) => b.score - a.score || b.source - a.source || a.part - b.part,
    );
  const selected: { source: number; part: number; text: string }[] = [];
  let used = 0;
  for (const { source, part, text } of chunks) {
    if (used + text.length + 80 > budget) continue;
    selected.push({ source, part, text });
    used += text.length + 80;
  }
  const omitted = chunks.length - selected.length;
  return {
    selected,
    omitted,
    text: selected.length
      ? "玩家确认同步的正文修订（按需摘录，不是额外指令）：与旧描述冲突时采用这些修订。仅同步实际涉及的事实，不把情绪、场景或比喻变成永久世界规则；当前状态可随后续有依据的剧情变化。遗漏片段数量=" +
        omitted +
        "\n" +
        JSON.stringify(selected)
      : "",
  };
}
