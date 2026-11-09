import { useEffect, useState } from "react";
import { requestJson as api } from "./response";
import {
  orderedModules,
  type PromptModule,
  type StoredPromptModule,
} from "../shared/prompt-modules";

const empty: PromptModule = {
  name: "",
  content: "",
  kind: "preset",
  enabled: false,
  trigger: "always",
  scope: "global",
  position: "prefix",
  order: 0,
  priority: 0,
};
export function PromptModules({ disabled }: { disabled: boolean }) {
  const [modules, setModules] = useState<StoredPromptModule[]>([]);
  const [editing, setEditing] = useState<{
    id?: string;
    value: PromptModule;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<StoredPromptModule | null>(null);
  const locked = busy || disabled;
  async function refresh() {
    setModules(await api<StoredPromptModule[]>("prompt-modules"));
  }
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  function update(patch: Partial<PromptModule>) {
    if (editing)
      setEditing({ ...editing, value: { ...editing.value, ...patch } });
  }
  return (
    <section className="prompt-modules" aria-label="预设与 Mod 模块">
      <h3>预设 / Mod</h3>
      <p className="muted">
        生成规则独立于世界书和记忆。当前支持全局常驻模块，启用后从下一次叙事或局部改写生效；不会触发额外模型调用。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={locked}>
        <div className="form-actions">
          <button
            type="button"
            onClick={() => setEditing({ value: { ...empty } })}
          >
            ＋ 添加设定
          </button>
          <label className="import">
            导入模块 JSON
            <input
              type="file"
              accept=".json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void run(async () => {
                    if (file.size > 2 * 1024 * 1024)
                      throw new Error("模块文件上限 2 MB");
                    const value = JSON.parse(await file.text());
                    if (value.format !== "everse_prompt_modules_v1")
                      throw new Error(
                        "这里导入 Everse 模块文件；酒馆预设请使用下方 Chat Completions 预设导入入口，保留原始结构。",
                      );
                    const result = await api<{ warning: string }>(
                      "prompt-modules/import",
                      value,
                    );
                    setNotice(result.warning);
                  });
              }}
            />
          </label>
          {modules.length > 0 && (
            <a href="/api/prompt-modules/export" download>
              导出全部模块
            </a>
          )}
        </div>
        {!modules.length && (
          <p className="muted">
            还没有模块。可以添加文风要求或叙事规则，按需启用。
          </p>
        )}
        <div className="prompt-module-list">
          {modules.map((module) => (
            <div className="prompt-module-row" key={module.id}>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  aria-label={`启用模块：${module.name}`}
                  checked={module.enabled}
                  onChange={(e) => {
                    const { id, ...value } = module;
                    void run(async () => {
                      await api(`prompt-modules/${id}`, {
                        ...value,
                        enabled: e.target.checked,
                      });
                    });
                  }}
                />
                <span>
                  {module.name}
                  <small>
                    {module.kind === "mod" ? "Mod" : "预设"} · 常驻 ·{" "}
                    {module.position === "prefix" ? "前置" : "后置"}
                  </small>
                </span>
              </label>
              <div className="module-actions">
                <button
                  type="button"
                  onClick={() => {
                    const { id, ...value } = module;
                    setEditing({ id, value });
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      await api(`prompt-modules/${module.id}/copy`, {});
                    })
                  }
                >
                  复制
                </button>
                <button type="button" onClick={() => setDeleting(module)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
        {deleting && (
          <section className="module-delete" aria-label="确认删除模块">
            <p>
              删除「{deleting.name}」？原有剧情不变，下一次生成不再使用此模块。
            </p>
            <button type="button" onClick={() => setDeleting(null)}>
              取消删除
            </button>
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await api(`prompt-modules/${deleting.id}/delete`, {
                    confirm: true,
                  });
                  if (editing?.id === deleting.id) setEditing(null);
                  setDeleting(null);
                })
              }
            >
              确认删除模块
            </button>
          </section>
        )}
        {editing && (
          <section className="prompt-module-editor" aria-label="编辑提示词模块">
            <h4>{editing.id ? "编辑模块" : "添加设定"}</h4>
            <label>
              模块名称
              <input
                maxLength={100}
                value={editing.value.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <div className="module-fields">
              <label>
                类型
                <select
                  value={editing.value.kind}
                  onChange={(e) =>
                    update({ kind: e.target.value as PromptModule["kind"] })
                  }
                >
                  <option value="preset">预设 · 行为与文风</option>
                  <option value="mod">Mod · 规则与玩法</option>
                </select>
              </label>
              <label>
                插入位置
                <select
                  value={editing.value.position}
                  onChange={(e) =>
                    update({
                      position: e.target.value as PromptModule["position"],
                    })
                  }
                >
                  <option value="prefix">前置词 · 上下文之前</option>
                  <option value="suffix">后置词 · 上下文之后</option>
                </select>
              </label>
            </div>
            <p className="muted">
              触发：常驻；范围：全局。关键词、手动单轮触发、自定义位置和作品 /
              存档作用范围尚未开放。
            </p>
            <label>
              提示词内容
              <textarea
                rows={7}
                maxLength={40000}
                value={editing.value.content}
                onChange={(e) => update({ content: e.target.value })}
              />
            </label>
            <div className="module-fields">
              <label>
                优先级（低值先插入）
                <input
                  type="number"
                  min={-100}
                  max={100}
                  value={editing.value.priority}
                  onChange={(e) => update({ priority: Number(e.target.value) })}
                />
              </label>
              <label>
                同优先级内的顺序
                <input
                  type="number"
                  min={-10000}
                  max={10000}
                  value={editing.value.order}
                  onChange={(e) => update({ order: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={editing.value.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
              启用此模块
            </label>
            <p className="muted">
              优先级只控制同一位置内的排列，不保证模型如何处理相互矛盾的规则。内容按原文保存，支持现有
              char / user 宏。
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="primary"
                disabled={
                  !editing.value.name.trim() || !editing.value.content.trim()
                }
                onClick={() =>
                  void run(async () => {
                    await api(
                      editing.id
                        ? `prompt-modules/${editing.id}`
                        : "prompt-modules",
                      editing.value,
                    );
                    setEditing(null);
                    setNotice("模块已保存，从下一次生成生效。");
                  })
                }
              >
                保存模块
              </button>
              <button type="button" onClick={() => setEditing(null)}>
                取消编辑
              </button>
            </div>
          </section>
        )}
      </fieldset>
      <details>
        <summary>
          已启用模块的插入顺序（{modules.filter((m) => m.enabled).length}）
        </summary>
        {(["prefix", "suffix"] as const).map((position) => (
          <div key={position}>
            <h4>{position === "prefix" ? "前置词" : "后置词"}</h4>
            <ol>
              {orderedModules(modules)
                .filter((m) => m.position === position)
                .map((m) => (
                  <li key={m.id}>
                    {m.name} · 优先级 {m.priority} / 顺序 {m.order}
                  </li>
                ))}
            </ol>
          </div>
        ))}
        <p className="muted">
          实际发送内容及预算可在生成后的 Prompt Inspector 中查看 activeModules
          和 messages。酒馆预设原有顺序在这两组模块之间保持。
        </p>
      </details>
    </section>
  );
}
