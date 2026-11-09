import type { Preparation } from "../shared/preparation.js";
import type { Store } from "./store.js";
import { readPlan } from "./document-plan.js";
import type { DocumentPlan } from "../shared/document-plan.js";

type Passage = { index: number; start: number; end: number; text: string };
function terms(text: string) {
  const result = new Set(text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []);
  for (const run of text.match(/[\u3400-\u9fff]{2,}/g) ?? [])
    for (let i = 0; i < run.length - 1; i++) result.add(run.slice(i, i + 2));
  return result;
}
export function documentPassages(text: string): Passage[] {
  const passages: Passage[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 400, text.length);
    const newline = text.lastIndexOf("\n", end - 1);
    if (newline > start + 180) end = newline + 1;
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    passages.push({
      index: passages.length,
      start,
      end,
      text: text.slice(start, end),
    });
    start = end;
  }
  return passages;
}
export function selectDocument(text: string, query: string, budget = 6000) {
  const passages = documentPassages(text),
    queryTerms = terms(query.slice(-6000));
  const matches = passages.map((p) =>
    [...terms(p.text)].filter((t) => queryTerms.has(t)),
  );
  const frequency = new Map<string, number>();
  for (const match of matches)
    for (const term of match)
      frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const ranked = passages
    .map((p) => ({
      ...p,
      score: matches[p.index].reduce(
        (score, t) => score + Math.log(1 + passages.length / frequency.get(t)!),
        0,
      ),
    }))
    .filter((p) => p.index === 0 || p.score > 0)
    .sort((a, b) =>
      a.index === 0
        ? -1
        : b.index === 0
          ? 1
          : b.score - a.score || a.index - b.index,
    );
  const selected: Passage[] = [];
  let bytes = 0;
  for (const p of ranked) {
    const cost = Buffer.byteLength(render(p));
    if (bytes + cost > budget) continue;
    selected.push(p);
    bytes += cost;
  }
  if (!selected.length)
    throw new Error("当前资料预算不足以放入一个文档片段，请提高上下文预算");
  selected.sort((a, b) => a.index - b.index);
  return {
    selected,
    total: passages.length,
    omitted: passages.length - selected.length,
    bytes,
    characters: text.length,
  };
}
function render(p: Passage & { kind?: string }) {
  return `\n[原文片段${p.index + 1}，字符${p.start}–${p.end}${p.kind ? "，类别=" + p.kind : ""}]\n${p.text}\n`;
}
export function sourceContext(
  store: Store,
  source: Preparation["source"],
  query: string,
  budget = 6000,
  phase: "opening" | "turn" = "turn",
) {
  if (!source?.reference) return { text: source?.text ?? "", document: null };
  const row = source.documentId
    ? store.db
        .prepare("SELECT extracted FROM source_documents WHERE id=?")
        .get(source.documentId)
    : undefined;
  if (!row || typeof row.extracted !== "string")
    throw new Error("长文资料原文不存在，请重新导入；不会忽略缺失资料直接生成");
  const result = store.db
    .prepare("SELECT 1 FROM document_plans WHERE id=?")
    .get(source.documentId!)
    ? selectPlan(
        readPlan(store, source.documentId!),
        `${source.name}\n${source.text}\n${query}`,
        budget,
        phase,
      )
    : selectDocument(
        row.extracted,
        `${source.name}\n${source.text}\n${query}`,
        budget,
      );
  return {
    text: [
      source.text,
      "以下是作者长文资料的部分原文片段，不是全文或摘要。未检索到的内容不能当作不存在；不要声称已阅读全部文档。",
      ...result.selected.map(render),
    ]
      .filter(Boolean)
      .join("\n\n"),
    document: { ...result, documentId: source.documentId },
  };
}
export function selectPlan(
  plan: DocumentPlan,
  query: string,
  budget: number,
  phase: "opening" | "turn",
) {
  const queryTerms = terms(query.slice(-6000));
  const candidates = plan.sections.filter(
    (s) =>
      s.kind !== "example" && (phase === "opening" || s.kind !== "opening"),
  );
  const mandatory = (s: (typeof candidates)[number]) =>
    s.kind === "rule" ||
    s.kind === "style" ||
    (phase === "opening" && s.kind === "opening");
  const ranked = candidates
    .map((s) => ({
      ...s,
      score: [...terms(s.text)].filter((t) => queryTerms.has(t)).length,
    }))
    .sort(
      (a, b) =>
        Number(mandatory(b)) - Number(mandatory(a)) ||
        b.score - a.score ||
        a.index - b.index,
    );
  const selected: typeof candidates = [];
  let bytes = 0;
  for (const section of ranked) {
    const cost = Buffer.byteLength(render(section));
    if (
      !mandatory(section) &&
      (bytes + cost > budget || (section.score === 0 && selected.length > 0))
    )
      continue;
    selected.push(section);
    bytes += cost;
  }
  selected.sort((a, b) => a.index - b.index);
  return {
    selected,
    total: plan.sections.length,
    omitted: plan.sections.length - selected.length,
    bytes,
    characters: plan.sections.at(-1)?.end ?? 0,
    classificationRevision: plan.revision,
    unclassified: plan.sections.filter((s) => s.kind === "unclassified").length,
    overTarget: bytes > budget,
  };
}
