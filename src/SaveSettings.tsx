import { readJson, fetchLocal } from "./response";
import { useEffect, useRef, useState } from "react";
import { Management } from "./Management";
import type { PreparingSession } from "./OpeningPreparation";

export function SaveSettings({
  id,
  disabled,
  onClose,
  onUpdate,
}: {
  id: string;
  disabled: boolean;
  onClose: () => void;
  onUpdate: (id: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [save, setSave] = useState<PreparingSession | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    setSave(null);
    setError("");
    fetchLocal(`/api/sessions/${id}`)
      .then(async (r) => {
        const body = await readJson(r);
        if (active) setSave(body);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "读取失败");
      });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <dialog
      ref={dialog}
      className="settings save-settings"
      aria-labelledby="save-settings-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="panel-heading">
        <h2 id="save-settings-title">存档设置</h2>
        <button aria-label="关闭存档设置" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="muted">
        {save?.options.name ?? "当前存档"} · 修改仅作用于这个存档。
      </p>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : !save ? (
        <p role="status">正在读取存档…</p>
      ) : (
        <Management
          key={id}
          sessionOnly
          session={id}
          cardId={save.cardId}
          messages={save.messages}
          disabled={disabled}
          onUpdate={async (next) => {
            await onUpdate(next);
            const r = await fetchLocal(`/api/sessions/${next}`);
            setSave(await readJson(r));
          }}
        />
      )}
    </dialog>
  );
}
