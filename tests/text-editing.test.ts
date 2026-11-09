import { test } from "node:test";
import assert from "node:assert/strict";
import { paragraphs, textDiff } from "../src/text-editing.js";
test("行内改写保留 Unicode 和段落原始偏移，差异可重建新旧正文", () => {
  const source = "雨。🕯️\n\n她走了。\r\n\r\n后来。\n\n";
  for (const p of paragraphs(source))
    assert.equal(source.slice(p.start, p.start + p.text.length), p.text);
  for (const [a, b] of [
    ["她走了。", "她留下了。"],
    ["🌙雨。", "🌟雨。"],
    ["删除", ""],
    ["", "新增"],
    [source, source],
  ]) {
    const d = textDiff(a, b);
    assert.equal(d.prefix + d.removed + d.suffix, a);
    assert.equal(d.prefix + d.added + d.suffix, b);
  }
  assert.equal(textDiff("🌙雨。", "🌟雨。").removed, "🌙");
});
