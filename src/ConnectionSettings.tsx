import type { Connections, Connection } from "./connections";
import { removeConnection } from "./connections";
export function ConnectionSettings({
  value,
  onChange,
  disabled,
}: {
  value: Connections;
  onChange: (value: Connections) => void;
  disabled: boolean;
}) {
  function update(id: string, patch: Partial<Connection>) {
    onChange({
      ...value,
      profiles: value.profiles.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    });
  }
  return (
    <fieldset disabled={disabled} className="connection-settings">
      <h3>API 连接</h3>
      <p className="muted">
        可添加多个服务或同一服务的不同模型。在主界面输入框旁选择使用哪个。名称、地址和模型保存在本浏览器；Key
        仅在本页内存，刷新后需重填，并恢复模拟模式。
      </p>
      {!value.profiles.length && <p>还没有连接，可以先用免费模拟模型体验。</p>}
      {value.profiles.map((p, i) => (
        <details key={p.id} open className="connection-profile">
          <summary>
            {p.name || `连接 ${i + 1}`}
            {value.selectedId === p.id ? " · 使用中" : ""}
          </summary>
          {(["name", "baseUrl", "model", "apiKey"] as const).map((field) => (
            <label key={field}>
              {
                {
                  name: "连接名称",
                  baseUrl: "Base URL（通常以 /v1 结尾）",
                  model: "模型 ID",
                  apiKey: "API Key · 仅本页内存",
                }[field]
              }
              <input
                autoComplete="off"
                type={field === "apiKey" ? "password" : "text"}
                maxLength={
                  field === "apiKey"
                    ? 4096
                    : field === "baseUrl"
                      ? 2000
                      : field === "model"
                        ? 200
                        : 100
                }
                value={p[field]}
                onChange={(e) => update(p.id, { [field]: e.target.value })}
              />
            </label>
          ))}
          <div className="connection-actions">
            <button
              type="button"
              aria-pressed={value.selectedId === p.id}
              onClick={() => onChange({ ...value, selectedId: p.id })}
            >
              使用此连接
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    `删除连接“${p.name || "未命名"}”？不会删除故事存档。`,
                  )
                )
                  onChange(removeConnection(value, p.id));
              }}
            >
              删除连接
            </button>
          </div>
        </details>
      ))}
      <button
        type="button"
        disabled={value.profiles.length >= 50}
        onClick={() =>
          onChange({
            ...value,
            profiles: [
              ...value.profiles,
              {
                id: crypto.randomUUID(),
                name: `连接 ${value.profiles.length + 1}`,
                baseUrl: "",
                model: "",
                apiKey: "",
              },
            ],
          })
        }
      >
        ＋ 添加 API 连接
      </button>
      <button
        type="button"
        aria-pressed={value.selectedId === null}
        onClick={() => onChange({ ...value, selectedId: null })}
      >
        使用免费模拟模型
      </button>
    </fieldset>
  );
}
