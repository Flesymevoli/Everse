import { variantsOf, activeVariant } from "../shared/swipes";
import type { Message } from "../server/context";
import { readingDraft, textSuggestions } from "../server/suggestions";
import { visibleStory } from "../shared/story";
import { Fragment, useEffect, useRef } from "react";
import type { TextSelection } from "../shared/text-edit";
type RangeSelection = Omit<TextSelection, "revision">;
import { paragraphs, textDiff } from "./text-editing";
interface Props {
  editSelection?: RangeSelection;
  editPreview?: string | null;
  highlight?: {
    index: number;
    start: number;
    end: number;
    content: string;
  } | null;
  busy: boolean;
  onRegenerate: () => void;
  onSwipe: (messageIndex: number, index: number) => void;
  messages: Message[];
  draft: string;
  generating: boolean;
  suggestionsEnabled: boolean;
  onChoose: (text: string) => void;
  onCopy: (text: string) => void;
  onEdit: (selection: RangeSelection) => void;
  onUndo: () => void;
}
export function ReadingView({
  editSelection,
  editPreview,
  highlight,
  busy,
  onRegenerate,
  onSwipe,
  messages,
  draft,
  generating,
  suggestionsEnabled,
  onChoose,
  onCopy,
  onEdit,
  onUndo,
}: Props) {
  const prose = useRef<HTMLElement>(null);
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const capture = () => {
      if (busy || editSelection) return;
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !selected.rangeCount) return;
      const range = selected.getRangeAt(0);
      const element = (node: Node) =>
        node.nodeType === Node.ELEMENT_NODE
          ? (node as Element)
          : node.parentElement;
      const a = element(range.startContainer)?.closest<HTMLElement>(
        "p[data-text-start]",
      );
      const b = element(range.endContainer)?.closest<HTMLElement>(
        "p[data-text-start]",
      );
      const owner = a?.closest<HTMLElement>("[data-narrative-index]");
      if (
        !a ||
        !b ||
        !owner ||
        owner !== b.closest("[data-narrative-index]") ||
        !prose.current?.contains(owner)
      )
        return;
      const index = Number(owner.dataset.narrativeIndex);
      const start = Number(a.dataset.textStart);
      // A rough gesture selects complete touched paragraphs, not individual letters.
      const end = Number(b.dataset.textStart) + (b.textContent?.length ?? 0);
      const original = messages[index]?.content.slice(start, end);
      if (!original?.trim()) return;
      onEditRef.current({ index, start, end, original });
      selected.removeAllRanges();
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(capture, 250);
    };
    document.addEventListener("pointerup", schedule);
    document.addEventListener("keyup", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerup", schedule);
      document.removeEventListener("keyup", schedule);
    };
  }, [busy, messages, editSelection]);
  const choices =
    !generating && suggestionsEnabled
      ? messages.at(-1)?.suggestions?.length
        ? messages.at(-1)!.suggestions!
        : textSuggestions(messages.at(-1)?.content ?? "")
      : [];
  const visibleDraft = visibleStory(
    suggestionsEnabled && generating ? readingDraft(draft) : draft,
  );
  return (
    <>
      <section ref={prose} className="prose" aria-label="小说正文">
        {messages.map((message, index) => (
          <article
            key={index}
            className={message.role === "user" ? "action-record" : "passage"}
          >
            {message.warning && (
              <p className="narrative-warning" role="status">
                {message.warning}
              </p>
            )}
            {message.role === "user" ? (
              <p>
                <span aria-hidden="true">↳ </span>
                {message.content}
              </p>
            ) : (
              <div data-narrative-index={index}>
                {paragraphs(message.content).map((paragraph, i, parts) => {
                  const selected =
                    editSelection?.index === index &&
                    paragraph.start < editSelection.end &&
                    paragraph.start + paragraph.text.length >
                      editSelection.start;
                  const last =
                    selected &&
                    !parts
                      .slice(i + 1)
                      .some(
                        (p) =>
                          p.text.length > 0 &&
                          p.start < editSelection!.end &&
                          p.start + p.text.length > editSelection!.start,
                      );
                  const first =
                    selected && paragraph.start <= editSelection!.start;
                  const diff =
                    first && editPreview != null
                      ? textDiff(editSelection!.original, editPreview)
                      : null;
                  const marked =
                    highlight?.index === index &&
                    highlight.content === message.content;
                  const markStart = marked
                    ? Math.max(0, highlight.start - paragraph.start)
                    : 0;
                  const markEnd = marked
                    ? Math.min(
                        paragraph.text.length,
                        highlight.end - paragraph.start,
                      )
                    : 0;
                  return (
                    <Fragment key={i}>
                      {!selected || editPreview == null ? (
                        <p
                          data-text-start={paragraph.start}
                          className={selected ? "editing-scope" : undefined}
                        >
                          {marked && markEnd > markStart ? (
                            <>
                              {paragraph.text.slice(0, markStart)}
                              <mark className="edit-added">
                                {paragraph.text.slice(markStart, markEnd)}
                              </mark>
                              {paragraph.text.slice(markEnd)}
                            </>
                          ) : (
                            paragraph.text
                          )}
                        </p>
                      ) : first && diff ? (
                        <p className="inline-diff" aria-label="正文修改预览">
                          {diff.prefix}
                          <del>{diff.removed}</del>
                          <ins>{diff.added}</ins>
                          {diff.suffix}
                        </p>
                      ) : null}
                      {last && <div id="inline-text-editor-anchor" />}
                    </Fragment>
                  );
                })}
              </div>
            )}
            <button
              className="copy-action"
              aria-label={"复制第 " + (index + 1) + " 段"}
              onClick={() => onCopy(message.content)}
            >
              复制
            </button>
            {message.role === "assistant" && (
              <div className="variant-actions">
                <button
                  disabled={busy}
                  aria-label={`编辑第 ${index + 1} 段正文`}
                  onClick={() =>
                    onEdit({
                      index,
                      start: 0,
                      end: message.content.length,
                      original: message.content,
                    })
                  }
                >
                  编辑
                </button>
                {variantsOf(message).length > 1 && (
                  <>
                    <button
                      disabled={busy || activeVariant(message) === 0}
                      aria-label="上一个候选"
                      onClick={() => onSwipe(index, activeVariant(message) - 1)}
                    >
                      ‹
                    </button>
                    <small>
                      {activeVariant(message) + 1} /{" "}
                      {variantsOf(message).length}
                    </small>
                    <button
                      disabled={
                        busy ||
                        activeVariant(message) ===
                          variantsOf(message).length - 1
                      }
                      aria-label="下一个候选"
                      onClick={() => onSwipe(index, activeVariant(message) + 1)}
                    >
                      ›
                    </button>
                  </>
                )}
                {index === messages.length - 1 &&
                  messages[index - 1]?.role === "user" && (
                    <button disabled={busy} onClick={onRegenerate}>
                      重新生成
                    </button>
                  )}
              </div>
            )}
          </article>
        ))}
        {visibleDraft && (
          <article className="passage draft">
            {visibleDraft.split(/\n\s*\n/).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
            <small>{generating ? "正在续写" : "未保存的草稿"}</small>
          </article>
        )}
      </section>
      {messages.length > 0 && (
        <button className="restore-edit" disabled={busy} onClick={onUndo}>
          恢复最近编辑前的版本
        </button>
      )}
      {choices.length > 0 && (
        <section className="suggestions" aria-label="可选行动建议">
          <p>也许，你想…</p>
          {choices.map((choice, i) => (
            <button key={i} onClick={() => onChoose(choice)}>
              <span>0{i + 1}</span>
              {choice}
              <span aria-hidden="true">↗</span>
            </button>
          ))}
          <small>选中后可以修改，也可以写下自己的想法。</small>
        </section>
      )}
    </>
  );
}
