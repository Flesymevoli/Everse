export type BookDraft = {
  entries: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};
export function BookEntryFields({
  book,
  onChange,
}: {
  book: BookDraft;
  onChange: (book: BookDraft) => void;
}) {
  function update(id: string, patch: Record<string, unknown>) {
    onChange({
      ...book,
      entries: { ...book.entries, [id]: { ...book.entries[id], ...patch } },
    });
  }
  return (
    <section className="book-entry-editor">
      <h3>世界书条目</h3>
      <p className="muted">
        关键词每行一项；常驻条目无需关键词。未展示的高级字段保留。
      </p>
      {Object.entries(book.entries).map(([id, entry], index) => (
        <details key={id} open>
          <summary>条目 {index + 1}</summary>
          <label>
            关键词
            <textarea
              className="keyword-input"
              value={Array.isArray(entry.key) ? entry.key.join("\n") : ""}
              onChange={(e) => update(id, { key: e.target.value.split("\n") })}
            />
          </label>
          <label>
            内容
            <textarea
              maxLength={100000}
              value={typeof entry.content === "string" ? entry.content : ""}
              onChange={(e) => update(id, { content: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={entry.constant === true}
              onChange={(e) => update(id, { constant: e.target.checked })}
            />
            常驻
          </label>
          <label>
            <input
              type="checkbox"
              checked={entry.disable === true}
              onChange={(e) => update(id, { disable: e.target.checked })}
            />
            停用
          </label>
          <button
            type="button"
            onClick={() => {
              if (
                !window.confirm("移除此条目？保存后才生效，已有剧情不会删除。")
              )
                return;
              onChange({
                ...book,
                entries: Object.fromEntries(
                  Object.entries(book.entries).filter(([key]) => key !== id),
                ),
              });
            }}
          >
            移除条目
          </button>
        </details>
      ))}
      <button
        type="button"
        disabled={Object.keys(book.entries).length >= 500}
        onClick={() =>
          onChange({
            ...book,
            entries: {
              ...book.entries,
              [crypto.randomUUID()]: { key: [], content: "", constant: true },
            },
          })
        }
      >
        ＋ 添加条目
      </button>
    </section>
  );
}
