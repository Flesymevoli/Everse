import type { Card } from "../server/cards";

type Props = { card?: Card; onClose: () => void };

export function StoryPanel({ card, onClose }: Props) {
  return (
    <aside
      className="story-panel"
      id="story-panel"
      aria-label="角色信息"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="panel-heading">
        <span className="eyebrow">角色信息</span>
        <button onClick={onClose} aria-label="收起角色信息">
          ×
        </button>
      </div>
      {card ? (
        <>
          <section className="story-overview">
            <span className="story-monogram" aria-hidden="true">
              {Array.from(card.data.name)[0]}
            </span>
            <h2>{card.data.name}</h2>
          </section>
          <details open>
            <summary>人物简介</summary>
            <p>{card.data.description || "未填写人物描述。"}</p>
            {card.data.personality && <p>{card.data.personality}</p>}
          </details>
          <section className="character-section" aria-label="人物状态">
            <h3>人物状态</h3>
            <p className="muted">尚未接入状态数据</p>
          </section>
          <section className="character-section" aria-label="背包">
            <h3>背包</h3>
            <p className="muted">尚未接入物品数据</p>
          </section>
        </>
      ) : (
        <div className="panel-empty">
          <h2>等待角色登场</h2>
          <p>选择作品后，在这里查看角色信息。</p>
        </div>
      )}
    </aside>
  );
}
