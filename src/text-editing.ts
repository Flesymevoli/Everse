export function paragraphs(text: string) {
  const result: { text: string; start: number }[] = [];
  const pattern = /\n\s*\n/g;
  let start = 0,
    match;
  while ((match = pattern.exec(text))) {
    result.push({ text: text.slice(start, match.index), start });
    start = pattern.lastIndex;
  }
  result.push({ text: text.slice(start), start });
  return result;
}

// Keep complete Unicode characters when finding the changed span.
export function textDiff(before: string, after: string) {
  const a = Array.from(before),
    b = Array.from(after);
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  return {
    prefix: a.slice(0, start).join(""),
    removed: a.slice(start, a.length - end).join(""),
    added: b.slice(start, b.length - end).join(""),
    suffix: end ? a.slice(a.length - end).join("") : "",
  };
}
