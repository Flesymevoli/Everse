import { useRef } from "react";

interface Props {
  model: string;
  mock: boolean;
  disabled: boolean;
  onSelect: (mock: boolean) => void;
  onSettings: () => void;
}

export function ModelPicker({
  model,
  mock,
  disabled,
  onSelect,
  onSettings,
}: Props) {
  const popup = useRef<HTMLDetailsElement>(null);
  const configured = model.trim().length > 0 && model !== "your-model-id";
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
          {mock ? "模拟模型" : configured ? model : "选择模型"}
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
        <button
          type="button"
          disabled={disabled}
          aria-pressed={mock}
          onClick={() => {
            onSelect(true);
            close();
          }}
        >
          <span>
            模拟模型<small>免费 · 用于体验与测试</small>
          </span>
          <span aria-hidden="true">{mock ? "✓" : ""}</span>
        </button>
        {configured && (
          <button
            type="button"
            disabled={disabled}
            aria-pressed={!mock}
            onClick={() => {
              onSelect(false);
              close();
            }}
          >
            <span>
              {model}
              <small>使用设置中的 API</small>
            </span>
            <span aria-hidden="true">{!mock ? "✓" : ""}</span>
          </button>
        )}
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
