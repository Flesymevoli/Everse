import type { Connection } from "./connections";
import { useRef } from "react";

interface Props {
  profiles: Connection[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string | null) => void;
  onSettings: () => void;
}

export function ModelPicker({
  profiles,
  selectedId,
  disabled,
  onSelect,
  onSettings,
}: Props) {
  const popup = useRef<HTMLDetailsElement>(null);
  const selected = profiles.find((p) => p.id === selectedId);

  function close() {
    if (popup.current) popup.current.open = false;
  }
  return (
    <details
      className="model-picker"
      ref={popup}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          close();
          popup.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        aria-label="选择模型"
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <span className="model-name">
          {selected?.name || selected?.model || "配置模型"}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="model-options">
        <p>本次使用的模型</p>
        {profiles.map((profile) => (
          <button
            type="button"
            key={profile.id}
            disabled={disabled}
            aria-pressed={selectedId === profile.id}
            onClick={() => {
              onSelect(profile.id);
              close();
            }}
          >
            <span>
              {profile.name || "未命名连接"}
              <small>{profile.model || "未填写模型 ID"}</small>
            </span>
            <span aria-hidden="true">
              {selectedId === profile.id ? "✓" : ""}
            </span>
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          className="configure-model"
          onClick={() => {
            close();
            onSettings();
          }}
        >
          配置其他模型…
        </button>
      </div>
    </details>
  );
}
