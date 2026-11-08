export const suggestionInstruction =
  "正文结束后，在末尾独立一行输出 <action_suggestions>，接着输出包含 2 或 3 个简短、符合当前情境的自由行动建议的 JSON 字符串数组，再输出 </action_suggestions>。不要在正文中引用这些标签。建议不限制玩家自由行动。";

export function parseSuggestions(raw: string) {
  const match = raw.match(
    /\n<action_suggestions>\s*([\s\S]*?)\s*<\/action_suggestions>\s*$/,
  );
  if (!match) return { text: raw, suggestions: [] as string[] };
  try {
    const value: unknown = JSON.parse(match[1]);
    if (
      !Array.isArray(value) ||
      value.length < 2 ||
      value.length > 3 ||
      !value.every(
        (item) =>
          typeof item === "string" &&
          item.trim().length > 0 &&
          item.length <= 200,
      )
    ) {
      return { text: raw, suggestions: [] as string[] };
    }
    const text = raw.slice(0, match.index).trimEnd();
    if (!text.trim()) return { text: raw, suggestions: [] as string[] };
    return { text, suggestions: value.map((item) => (item as string).trim()) };
  } catch {
    return { text: raw, suggestions: [] as string[] };
  }
}

// Hold an unfinished metadata suffix during streaming; malformed output is
// restored verbatim when the completed response is parsed.
export function readingDraft(raw: string) {
  const marker = "\n<action_suggestions>";
  const index = raw.indexOf(marker);
  if (index >= 0) return raw.slice(0, index);
  for (let length = marker.length - 1; length > 0; length--) {
    if (raw.endsWith(marker.slice(0, length))) return raw.slice(0, -length);
  }
  return raw;
}
