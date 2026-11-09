import { variantsOf, activeVariant } from "../shared/swipes";
import type { Message } from "../server/context";
import { readingDraft, textSuggestions } from "../server/suggestions";
import { visibleStory } from "../shared/story";
import { useEffect, useRef, useState } from "react";
import type { TextSelection } from "../shared/text-edit";
type RangeSelection = Omit<TextSelection, "revision">;
function paragraphs(text: string) {
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

interface Props {
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
  const prose = useRef<HTMLElement>(null),
    [selection, setSelection] = useState<
      (RangeSelection & { left: number; top: number }) | null
    >(null);
  useEffect(() => {
    const capture = () => {
      if (busy) {
        setSelection(null);
        return;
      }
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !selected.rangeCount) {
        setSelection(null);
        return;
      }
      const range = selected.getRangeAt(0),
        element = (node: Node) =>
          node.nodeType === Node.ELEMENT_NODE
            ? (node as Element)
            : node.parentElement;
      const a = element(range.startContainer)?.closest<HTMLElement>(
          "p[data-text-start]",
        ),
        b = element(range.endContainer)?.closest<HTMLElement>(
          "p[data-text-start]",
        );
      const owner = a?.closest<HTMLElement>("[data-narrative-index]");
      if (
        !a ||
        !b ||
        !owner ||
        owner !== b.closest("[data-narrative-index]") ||
        !prose.current?.contains(owner)
      ) {
        setSelection(null);
        return;
      }
      const offset = (p: HTMLElement, node: Node, n: number) => {
        const r = document.createRange();
        r.selectNodeContents(p);
        r.setEnd(node, n);
        return Number(p.dataset.textStart) + r.toString().length;
      };
      const index = Number(owner.dataset.narrativeIndex),
        start = offset(a, range.startContainer, range.startOffset),
        end = offset(b, range.endContainer, range.endOffset),
        original = messages[index]?.content.slice(start, end);
      if (!original?.trim()) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelection({
        index,
        start,
        end,
        original,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 160)),
        top: Math.max(70, Math.min(rect.top - 48, window.innerHeight - 60)),
      });
    };
    document.addEventListener("selectionchange", capture);
    return () => document.removeEventListener("selectionchange", capture);
  }, [busy, messages]);
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
      {selection && !busy && (
        <button
          className="selection-edit"
          style={{ left: selection.left, top: selection.top }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const {left:_left,top:_top,...range}=selection;
            onEdit(range);
            window.getSelection()?.removeAllRanges();
            setSelection(null);
          }}
        >
          修改选中文本
        </button>
      )}
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
                {paragraphs(message.content).map((paragraph, i) => (
                  <p key={i} data-text-start={paragraph.start}>
                    {paragraph.text}
                  </p>
                ))}
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
