import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
export function DeleteSaveDialog({
  name,
  onClose,
  onDelete,
  kind = "存档",
  description,
}: {
  name: string;
  onClose: () => void;
  onDelete: () => Promise<void>;
  kind?: "存档" | "世界";
  description?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="delete-save-dialog"
      aria-labelledby="delete-save-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="delete-save-title">
        删除{kind}「{name}」？
      </h2>
      <p>
        {description ??
          "将永久删除这份存档的剧情、修改历史和记忆，无法撤销。其他存档、角色卡、世界书和导入文档会保留。"}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button autoFocus disabled={busy} onClick={onClose}>
          保留{kind}
        </button>
        <button
          className="danger-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void onDelete()
              .catch((e) =>
                setError(
                  e instanceof Error ? e.message : "删除失败，请稍后重试",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "正在删除…" : "确认删除"}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
