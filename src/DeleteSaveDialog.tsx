import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
export function DeleteSaveDialog({
  name,
  onClose,
  onDelete,
}: {
  name: string;
  onClose: () => void;
  onDelete: () => Promise<void>;
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
      <h2 id="delete-save-title">删除存档「{name}」？</h2>
      <p>
        将永久删除这份存档的剧情、修改历史和记忆，无法撤销。其他存档、角色卡、世界书和导入文档会保留。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button autoFocus disabled={busy} onClick={onClose}>
          保留存档
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
