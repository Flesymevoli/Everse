import { useEffect, useRef, useState } from "react";
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
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [instruction, setInstruction] = useState(""),
    [replacement, setReplacement] = useState(
      initialReplacement ?? selection.original,
    ),
    [fact, setFact] = useState(""),
    [reviewed, setReviewed] = useState(!!restore),
    [working, setWorking] = useState(false),
    [generating, setGenerating] = useState(false),
    [error, setError] = useState(""),
    [prompt, setPrompt] = useState<unknown>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
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
  return (
    <dialog
      ref={dialog}
      className="settings text-editor"
      aria-labelledby="text-editor-title"
      onCancel={(e) => {
        if (working) e.preventDefault();
        else onClose();
      }}
    >
      <div className="panel-heading">
        <h2 id="text-editor-title">
          {restore ? "恢复原版本" : "修改选中文本"}
        </h2>
        <button aria-label="关闭正文编辑" disabled={working} onClick={onClose}>
          ×
        </button>
      </div>
      <p className="muted">
        只替换所选范围；确认前存档不变。一次选择支持同一条回复中的多个段落。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={working}>
        <details>
          <summary>所选原文</summary>
          <pre className="edit-preview">{selection.original}</pre>
        </details>
        {!restore && (
          <>
            <label>
              改写要求
              <textarea
                aria-label="改写要求"
                maxLength={4000}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="例如：保留事件，增加环境描写；或改为她没有离开。"
              />
            </label>
            <div className="edit-presets">
              {[
                "润色，保留原意",
                "扩写细节，保留原有事实",
                "删减冗余，保留关键信息",
                "修改剧情：",
              ].map((text) => (
                <button
                  type="button"
                  key={text}
                  onClick={() => setInstruction(text)}
                >
                  {text.split(/[，：]/)[0]}
                </button>
              ))}
            </div>
            <button
              disabled={!instruction.trim()}
              onClick={() =>
                void run(async () => {
                  setGenerating(true);
                  const value = await onGenerate(instruction);
                  setReplacement(value.replacement);
                  setPrompt(value.prompt);
                  setReviewed(true);
                })
              }
            >
              AI 生成预览
            </button>
            <small>
              {mock ? "当前为免费模拟模型。" : "使用当前 API，可能产生费用。"}
              不自动重试，失败保留现有编辑。
            </small>
          </>
        )}
        <label>
          {restore
            ? "将恢复的正文"
            : "替换文本（可以手动编辑，也可清空以删除选区）"}
          <textarea
            aria-label="替换文本"
            readOnly={restore}
            maxLength={100000}
            value={replacement}
            onChange={(e) => {
              setReplacement(e.target.value);
              setReviewed(false);
            }}
          />
        </label>
        {!restore && (
          <>
            <label>
              确认事实修订（可选）
              <textarea
                aria-label="确认事实修订"
                maxLength={600}
                value={fact}
                onChange={(e) => setFact(e.target.value)}
                placeholder="例如：林仍在书店，并未离开雨城。只有你明确填写并确认后才作为修正记忆保存。"
              />
            </label>
            <button onClick={() => setReviewed(true)}>预览修改</button>
          </>
        )}
        {reviewed && (
          <section aria-label="修改预览">
            <h3>{restore ? "恢复后" : "替换后"}本轮正文</h3>
            <pre className="edit-preview">{result}</pre>
            <p className="muted">
              相关旧状态将按正文版本失效；不会自动重写后续剧情或修改你保存的世界引导。修改早期事实后请检查后续情节。恢复版本也不会覆盖之后新增的剧情。
            </p>
          </section>
        )}
        {prompt !== null && (
          <details>
            <summary>本次发送的上下文</summary>
            <pre className="edit-preview">
              {JSON.stringify(prompt, null, 2)}
            </pre>
          </details>
        )}
        <div className="form-actions">
          <button
            className="primary"
            disabled={
              !reviewed ||
              !result.trim() ||
              (!restore && replacement === selection.original)
            }
            onClick={() => void run(() => onSave(replacement, fact))}
          >
            {restore ? "确认恢复原版本" : "确认替换"}
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </fieldset>
      {generating && (
        <button
          onClick={() =>
            void onStop().catch(() => setError("停止请求失败，请稍后重试"))
          }
        >
          停止改写
        </button>
      )}
    </dialog>
  );
}
