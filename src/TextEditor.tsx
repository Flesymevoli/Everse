import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TextSelection } from "../shared/text-edit";
export function TextEditor({
  selection,
  message,
  restore,
  initialReplacement,
  mock,
  onGenerate,
  onSave,
  onStop,
  onClose,
  onPreview,
}: {
  selection: TextSelection;
  message: string;
  restore?: boolean;
  initialReplacement?: string;
  mock: boolean;
  onGenerate: (
    instruction: string,
  ) => Promise<{ replacement: string; prompt: unknown }>;
  onSave: (replacement: string, fact: string) => Promise<void>;
  onStop: () => Promise<void>;
  onClose: () => void;
  onPreview: (text: string | null) => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [instruction, setInstruction] = useState("");
  const [replacement, setReplacement] = useState(
    initialReplacement ?? selection.original,
  );
  const [manual, setManual] = useState(false);
  const [fact, setFact] = useState("");
  const [reviewed, setReviewed] = useState(!!restore);
  const [working, setWorking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<unknown>(null);
  useLayoutEffect(() => {
    setHost(document.getElementById("inline-text-editor-anchor"));
  }, []);
  useEffect(() => {
    onPreview(reviewed ? replacement : null);
  }, [reviewed, replacement, onPreview]);
  async function run(fn: () => Promise<void>) {
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setWorking(false);
      setGenerating(false);
    }
  }
  const result =
    message.slice(0, selection.start) +
    replacement +
    message.slice(selection.end);
  if (!host) return null;
  return createPortal(
    <section
      className="inline-text-editor"
      role="region"
      aria-label={restore ? "恢复原版本" : "局部改写"}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !working) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="inline-edit-heading">
        <span>{restore ? "恢复预览" : "修改这几段"}</span>
        <span className="muted">
          {restore ? "确认后恢复" : "已包含选区所在的完整段落"}
        </span>
        <button aria-label="关闭正文编辑" disabled={working} onClick={onClose}>
          ×
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={working}>
        {!restore && (
          <>
            {!manual && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!instruction.trim()) return;
                  void run(async () => {
                    setGenerating(true);
                    const value = await onGenerate(instruction);
                    setReplacement(value.replacement);
                    setPrompt(value.prompt);
                    setReviewed(true);
                  });
                }}
              >
                <textarea
                  aria-label="改写要求"
                  rows={2}
                  maxLength={4000}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="想怎么改？例如：氛围轻松一些，让她留下来……"
                />
                <div className="inline-edit-tools">
                  <div>
                    {["润色", "扩写", "精简"].map((text) => (
                      <button
                        type="button"
                        key={text}
                        onClick={() =>
                          setInstruction(
                            text + "这几段，保留未涉及的剧情事实。",
                          )
                        }
                      >
                        {text}
                      </button>
                    ))}
                    <button
                      className="primary edit-send"
                      aria-label="生成改写预览"
                      disabled={!instruction.trim()}
                    >
                      ↑
                    </button>
                  </div>
                  <button type="button" onClick={() => setManual(true)}>
                    手动修改
                  </button>
                </div>
              </form>
            )}
            {manual && (
              <>
                <textarea
                  aria-label="替换文本"
                  rows={4}
                  maxLength={100000}
                  value={replacement}
                  onChange={(e) => {
                    setReplacement(e.target.value);
                    setReviewed(false);
                  }}
                />
                <div className="inline-edit-tools">
                  <button onClick={() => setReviewed(true)}>预览修改</button>
                  <button onClick={() => setManual(false)}>让 AI 改</button>
                </div>
              </>
            )}
          </>
        )}
        {reviewed && (
          <>
            <p className="edit-legend" role="status">
              <span>删除线：移除</span>
              <span>陶土色：新增</span> · 预览未保存
            </p>
            <div className="inline-edit-tools">
              <button
                className="primary"
                disabled={
                  !result.trim() ||
                  (!restore && replacement === selection.original)
                }
                onClick={() => void run(() => onSave(replacement, fact))}
              >
                {restore ? "确认恢复原版本" : "接受修改"}
              </button>
              <button onClick={onClose}>取消</button>
              {!restore && !manual && (
                <button onClick={() => setManual(true)}>再编辑</button>
              )}
            </div>
          </>
        )}
        {!restore && (
          <details className="inline-edit-details">
            <summary>事实修订与更多</summary>
            <label>
              确认事实修订（可选）
              <textarea
                aria-label="确认事实修订"
                rows={2}
                maxLength={600}
                value={fact}
                onChange={(e) => setFact(e.target.value)}
                placeholder="若改变了事实，可明确记录，例如：她仍留在书店。"
              />
            </label>
            <small>
              相关旧派生状态将失效。后续剧情与手工世界引导不会自动重写。
            </small>
            {prompt !== null && (
              <details>
                <summary>本次上下文</summary>
                <pre className="edit-preview">
                  {JSON.stringify(prompt, null, 2)}
                </pre>
              </details>
            )}
          </details>
        )}
      </fieldset>
      <div className="inline-edit-foot">
        <small>
          {working
            ? "正在处理…"
            : mock
              ? "模拟模型 · 不调用付费 API"
              : "当前 API · 生成可能产生费用"}
        </small>
        {generating && (
          <button
            onClick={() =>
              void onStop().catch(() => setError("停止失败，请重试"))
            }
          >
            停止改写
          </button>
        )}
        {!reviewed && !working && <button onClick={onClose}>取消</button>}
      </div>
    </section>,
    host,
  );
}
