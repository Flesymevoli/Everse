import type { Connections, Connection } from "./connections";

export function ConnectionSettings({
  value,
  onChange,
  disabled,
  onSave,
  onDelete,
  onClearKey,
}: {
  value: Connections;
  onChange: (value: Connections) => void;
  disabled: boolean;
  onSave: (profile: Connection) => void;
  onDelete: (profile: Connection) => void;
  onClearKey: (profile: Connection) => void;
}) {
  function update(id: string, patch: Partial<Connection>) {
    onChange({
      ...value,
      profiles: value.profiles.map((p) =>
        p.id === id ? { ...p, ...patch, dirty: true } : p,
      ),
    });
  }
  return (
    <fieldset disabled={disabled} className="connection-settings">
      <h3>API 连接</h3>
      <p className="muted">
        可添加多个服务或同一服务的不同模型。在主界面输入框旁选择使用哪个。点击保存后，连接及
        Key 存入本机；Key 使用 Windows
        当前用户加密，不回传浏览器。刷新后可直接选择已保存连接，无需重填 Key。
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
                  apiKey: p.hasKey
                    ? "API Key · 已加密保存（留空保留，输入可替换）"
                    : "API Key",
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
          <p className="muted">
            {p.saved
              ? p.dirty
                ? "有未保存修改"
                : "已保存到本机"
              : "尚未保存到本机"}
          </p>
          <div className="connection-actions">
            <button type="button" onClick={() => onSave(p)}>
              保存连接与 Key
            </button>
            {p.hasKey && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("删除此连接保存的 Key？")) onClearKey(p);
                }}
              >
                删除已保存 Key
              </button>
            )}
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
                  onDelete(p);
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
