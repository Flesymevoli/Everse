import type { Message } from "../server/context";
import { readingDraft } from "../server/suggestions";

interface Props {
  messages: Message[];
  draft: string;
  generating: boolean;
  suggestionsEnabled: boolean;
  onChoose: (text: string) => void;
  onCopy: (text: string) => void;
}
export function ReadingView({
  messages,
  draft,
  generating,
  suggestionsEnabled,
  onChoose,
  onCopy,
}: Props) {
  const choices =
    !generating && suggestionsEnabled
      ? (messages.at(-1)?.suggestions ?? [])
      : [];
  const visibleDraft =
    suggestionsEnabled && generating ? readingDraft(draft) : draft;
  return (
    <>
      <section className="prose" aria-label="小说正文">
        {messages.map((message, index) => (
          <article
            key={index}
            className={message.role === "user" ? "action-record" : "passage"}
          >
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
