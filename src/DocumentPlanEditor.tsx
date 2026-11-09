import { readJson, fetchLocal } from "./response";
import { useState } from "react";
import { kinds, type DocumentPlan } from "../shared/document-plan";
type Props = {
  documentId: string;
  disabled: boolean;
  mock: boolean;
  onBusy: (busy: boolean) => void;
  onClassify: (revision: number) => Promise<unknown>;
};
export function DocumentPlanEditor({
  documentId,
  disabled,
  mock,
  onBusy,
  onClassify,
}: Props) {
  const [usage, setUsage] = useState<unknown>(null);
  const [plan, setPlan] = useState<DocumentPlan | null>(null),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [page, setPage] = useState(0);
  async function load() {
    const r = await fetchLocal(`/api/documents/${documentId}/plan`);
    const result = await readJson(r);
    setPlan(result);
  }
  async function run(fn: () => Promise<void>) {
    setError("");
    setWorking(true);
    onBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setWorking(false);
      onBusy(false);
    }
  }
  const pending =
    plan?.sections.filter((s) => s.origin === "pending").length ?? 0;
  return (
    <details className="document-plan">
      <summary>检查与修正资料分类（可选）</summary>
      <p>
        分类影响真正发送的上下文：规则与叙事要求持续保留，开局引导仅开局使用，资料按情境选取，示例不当作已发生剧情。模型可能分错，混合段落需要人工复核。
      </p>
      {!plan ? (
        <button
          type="button"
          disabled={disabled || working}
          onClick={() => void run(load)}
        >
          读取分类与原文
        </button>
      ) : (
        <>
          <p>
            共 {plan.sections.length} 段，待分析 {pending} 段，未分类或需复核{" "}
            {plan.sections.filter((s) => s.kind === "unclassified").length}{" "}
            段。原文不改写，分类跨刷新保存。
          </p>
          <button
            type="button"
            disabled={disabled || working || !pending}
            onClick={() =>
              void run(async () => {
                await onClassify(plan.revision);
                await load();
              })
            }
          >
            {mock ? "模拟分类下一批" : "用所选 API 分类下一批"}
          </button>
          <p className="muted">
            每批最多 8 段、6000 字符，另带前段上下文，一次请求；
            {mock ? "模拟结果仅用于验证流程。" : "会产生 API 费用。"}
            不自动分析全文、不自动重试。手动分类不调用模型。
          </p>
          {plan.sections.slice(page * 8, page * 8 + 8).map((section) => (
            <section key={section.index} className="character-section">
              <label>
                第 {section.index + 1} 段 ·{" "}
                {section.origin === "user"
                  ? "人工修正"
                  : section.origin === "model"
                    ? "模型建议"
                    : "待分类"}
                <select
                  aria-label={`第${section.index + 1}段分类`}
                  value={section.kind}
                  disabled={disabled || working}
                  onChange={(e) =>
                    void run(async () => {
                      const response = await fetchLocal(
                        `/api/documents/${documentId}/plan`,
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            revision: plan.revision,
                            index: section.index,
                            kind: e.target.value,
                          }),
                        },
                      );
                      const result = await readJson(response);
                      setPlan(result);
                    })
                  }
                >
                  {Object.entries(kinds).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <details>
                <summary>
                  查看对应原文（{section.start}–{section.end}）
                </summary>
                <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {section.text}
                </p>
              </details>
            </section>
          ))}
          <button
            type="button"
            disabled={page === 0 || working}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </button>
          <button
            type="button"
            disabled={(page + 1) * 8 >= plan.sections.length || working}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </>
      )}
      {plan && (
        <details>
          <summary>分类调用记录</summary>
          <button
            type="button"
            disabled={working || disabled}
            onClick={() =>
              void run(async () => {
                const response = await fetchLocal(
                  `/api/documents/${documentId}/usage`,
                );
                const data = await readJson(response);
                setUsage(data);
              })
            }
          >
            读取用量
          </button>
          <p className="muted">
            包含失败调用；null 表示供应商未报告，并非免费。
          </p>
          {usage !== null && (
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(usage, null, 2)}
            </pre>
          )}
        </details>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </details>
  );
}
