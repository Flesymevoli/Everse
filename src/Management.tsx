import { BookEntryFields, type BookDraft } from "./BookEntryFields";
import { useEffect, useState } from "react";
import type { SessionOptions } from "../server/settings";
import type { Message } from "../server/context";
type Asset = {
  id: string;
  name: string;
  warnings: string[];
  original: unknown;
};
async function request<T>(path: string, value?: unknown): Promise<T> {
  const response = await fetch(
    "/api/" + path,
    value === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "操作失败");
  return body as T;
}
export function Management({
  session,
  cardId,
  messages,
  disabled,
  onUpdate,
}: {
  session: string;
  cardId: string;
  messages: Message[];
  disabled: boolean;
  onUpdate: (id: string) => Promise<void>;
}) {
  const [editingBook, setEditingBook] = useState<{
    id: string;
    name: string;
    book: BookDraft;
  } | null>(null);
  const [books, setBooks] = useState<Asset[]>([]),
    [presets, setPresets] = useState<Asset[]>([]);
  const [options, setOptions] = useState<SessionOptions>({});
  const [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [notice, setNotice] = useState("");
  const [index, setIndex] = useState(0),
    [content, setContent] = useState("");
  async function refresh() {
    const [b, p, s] = await Promise.all([
      request<Asset[]>("worldbooks"),
      request<Asset[]>("presets"),
      session
        ? request<{ options: SessionOptions }>("sessions/" + session)
        : Promise.resolve({ options: {} }),
    ]);
    setBooks(b);
    setPresets(p);
    setOptions(s.options);
  }
  useEffect(() => {
    void refresh().catch((error: Error) => setError(error.message));
  }, [session]);
  async function run(fn: () => Promise<void>) {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice("已保存");
    } catch (error) {
      setError(error instanceof Error ? error.message : "操作失败");
    } finally {
      setWorking(false);
    }
  }
  async function save(patch: SessionOptions) {
    const updated = await request<SessionOptions>(
      "sessions/" + session + "/options",
      patch,
    );
    setOptions(updated);
    await onUpdate(session);
  }
  return (
    <div className="management">
      <h3>作品资源与聊天管理</h3>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      <fieldset disabled={disabled || working}>
        {(["worldbooks", "presets"] as const).map((kind) => (
          <section key={kind}>
            <label>
              导入{kind === "worldbooks" ? "世界书" : "Chat Completions 预设"}{" "}
              JSON
              <input
                type="file"
                accept=".json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file)
                    void run(async () => {
                      if (file.size > 2000000) throw new Error("文件上限 2 MB");
                      await request(kind, {
                        name: file.name,
                        original: JSON.parse(await file.text()),
                      });
                      await refresh();
                    });
                }}
              />
            </label>
            {(kind === "worldbooks" ? books : presets).map((asset) => (
              <details key={asset.id}>
                <summary>{asset.name}</summary>
                <a href={"/api/" + kind + "/" + asset.id + "/export"}>
                  导出 JSON
                </a>
                {kind === "worldbooks" && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingBook({
                        id: asset.id,
                        name: asset.name,
                        book: structuredClone(asset.original) as BookDraft,
                      })
                    }
                  >
                    编辑世界书
                  </button>
                )}
                <ul>
                  {asset.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
        ))}
        {editingBook && (
          <section aria-label="编辑独立世界书">
            <h3>编辑世界书</h3>
            <label>
              名称
              <input
                value={editingBook.name}
                maxLength={100}
                onChange={(e) =>
                  setEditingBook({ ...editingBook, name: e.target.value })
                }
              />
            </label>
            <BookEntryFields
              book={editingBook.book}
              onChange={(book) => setEditingBook({ ...editingBook, book })}
            />
            <p className="muted">
              保存后，所有绑定此书的存档从下一轮使用新设定；已有聊天不变。
            </p>
            <button
              type="button"
              disabled={!editingBook.name.trim()}
              onClick={() =>
                void run(async () => {
                  await request("worldbooks/" + editingBook.id + "/edit", {
                    name: editingBook.name,
                    original: editingBook.book,
                  });
                  await refresh();
                  setEditingBook(null);
                })
              }
            >
              保存世界书
            </button>
            <button type="button" onClick={() => setEditingBook(null)}>
              取消
            </button>
          </section>
        )}
        <p className="muted">
          独立世界书支持文本关键词、选择逻辑、扫描深度、递归、概率与深度插入。预设暂执行全局相对顺序；高级策略见导入警告。
        </p>
        {!session ? (
          <p>进入存档后，可绑定资源和管理聊天。</p>
        ) : (
          <>
            <label>
              当前存档世界书
              <select
                value={options.worldbookId ?? ""}
                onChange={(e) =>
                  void run(() => save({ worldbookId: e.target.value || null }))
                }
              >
                <option value="">不绑定独立世界书</option>
                {books.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              扫描消息数（含本轮输入）
              <input
                type="number"
                min={0}
                max={1000}
                value={options.scanDepth ?? 2}
                onChange={(e) =>
                  setOptions({ ...options, scanDepth: Number(e.target.value) })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.recursive ?? false}
                onChange={(e) =>
                  setOptions({ ...options, recursive: e.target.checked })
                }
              />
              递归扫描世界书
            </label>
            <label>
              递归轮数（0 使用安全上限 500）
              <input
                type="number"
                min={0}
                max={500}
                value={options.maxRecursionSteps ?? 0}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    maxRecursionSteps: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.preferCharacterPrompt ?? true}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    preferCharacterPrompt: e.target.checked,
                  })
                }
              />
              允许角色主提示词覆盖预设
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.preferCharacterInstructions ?? true}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    preferCharacterInstructions: e.target.checked,
                  })
                }
              />
              允许角色历史后指令覆盖预设
            </label>
            <label>
              当前存档预设
              <select
                value={options.presetId ?? ""}
                onChange={(e) =>
                  void run(() => save({ presetId: e.target.value || null }))
                }
              >
                <option value="">沿用基础编排</option>
                {presets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              采样覆盖按存档保存；留空使用预设或供应商默认值。预设的上下文/回复上限优先于基础设置。
            </p>
            {(
              [
                "temperature",
                "top_p",
                "frequency_penalty",
                "presence_penalty",
                "seed",
              ] as const
            ).map((key) => (
              <label key={key}>
                {key}
                <input
                  type="number"
                  step={key === "seed" ? 1 : 0.1}
                  value={options.parameters?.[key] ?? ""}
                  onChange={(e) => {
                    const parameters = { ...options.parameters };
                    if (e.target.value === "") delete parameters[key];
                    else parameters[key] = Number(e.target.value);
                    setOptions({ ...options, parameters });
                  }}
                />
              </label>
            ))}
            <label>
              停止词（每行一项，最多 4 项）
              <textarea
                value={options.parameters?.stop?.join("\n") ?? ""}
                onChange={(e) => {
                  const parameters = { ...options.parameters };
                  if (e.target.value)
                    parameters.stop = e.target.value.split("\n");
                  else delete parameters.stop;
                  setOptions({ ...options, parameters });
                }}
              />
            </label>
            <button
              onClick={() =>
                void run(() =>
                  save({
                    parameters: options.parameters ?? {},
                    scanDepth: options.scanDepth ?? 2,
                    recursive: options.recursive ?? false,
                    maxRecursionSteps: options.maxRecursionSteps ?? 0,
                    preferCharacterPrompt:
                      options.preferCharacterPrompt ?? true,
                    preferCharacterInstructions:
                      options.preferCharacterInstructions ?? true,
                  }),
                )
              }
            >
              保存扫描与模型参数
            </button>
            <label>
              存档名称
              <input
                value={options.name ?? ""}
                onChange={(e) =>
                  setOptions({ ...options, name: e.target.value })
                }
              />
            </label>
            <button
              onClick={() => void run(() => save({ name: options.name }))}
            >
              保存名称
            </button>
            <button
              onClick={() =>
                void run(() => save({ archived: !options.archived }))
              }
            >
              {options.archived ? "恢复存档" : "归档存档（保留数据）"}
            </button>
            <p>
              <a href={"/api/sessions/" + session + "/export"}>导出 ST JSONL</a>
            </p>
            <label>
              消息序号
              <input
                type="number"
                min={1}
                max={messages.length}
                value={index + 1}
                onChange={(e) => {
                  const next = Number(e.target.value) - 1;
                  setIndex(next);
                  setContent(messages[next]?.content ?? "");
                }}
              />
            </label>
            <button onClick={() => setContent(messages[index]?.content ?? "")}>
              读取消息原文
            </button>
            <label>
              编辑消息
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </label>
            <button
              disabled={!messages[index]}
              onClick={() =>
                void run(async () => {
                  await request("sessions/" + session + "/edit", {
                    index,
                    content,
                  });
                  await onUpdate(session);
                })
              }
            >
              保存编辑（可撤销）
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  await request("sessions/" + session + "/undo", {});
                  await onUpdate(session);
                })
              }
            >
              撤销最近一次编辑
            </button>
            <button
              disabled={!messages[index]}
              onClick={() =>
                void run(async () => {
                  const result = await request<{ id: string }>(
                    "sessions/" + session + "/branch",
                    { count: index + 1 },
                  );
                  await onUpdate(result.id);
                })
              }
            >
              从此消息创建分支
            </button>
          </>
        )}
        {cardId && (
          <label>
            为当前作品导入 ST JSONL
            <input
              type="file"
              accept=".jsonl"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file)
                  void run(async () => {
                    if (file.size > 2000000) throw new Error("文件上限 2 MB");
                    const result = await request<{ id: string }>(
                      "sessions/import",
                      { cardId, name: file.name, text: await file.text() },
                    );
                    await onUpdate(result.id);
                  });
              }}
            />
          </label>
        )}
      </fieldset>
    </div>
  );
}
