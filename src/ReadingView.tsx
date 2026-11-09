import { variantsOf, activeVariant } from "../shared/swipes";
import type { Message } from "../server/context";
import { readingDraft, textSuggestions } from "../server/suggestions";
import { visibleStory } from "../shared/story";

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
}: Props) {
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
      <section className="prose" aria-label="小说正文">
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
              message.content
                .split(/\n\s*\n/)
                .map((paragraph, i) => <p key={i}>{paragraph}</p>)
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
