import type { ReactNode } from "react";
export function PlayerFields({
  name,
  description,
  onName,
  onDescription,
}: {
  name: string;
  description: string;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
}) {
  return (
    <details className="guided-extra">
      <summary>我在故事中的身份（可选）</summary>
      <p className="muted">
        这是你扮演的人，与角色卡中的故事人物不同。留空就以“玩家”参与。
      </p>
      <label>
        玩家称呼
        <input
          maxLength={100}
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="例如：小雨"
        />
      </label>
      <label>
        玩家背景
        <textarea
          maxLength={10000}
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          placeholder="例如：刚回到故乡的旅人，对灯塔一无所知。"
        />
      </label>
    </details>
  );
}
export function CreationGuide({
  kind,
  name,
  description,
  opening,
  playerName,
  playerDescription,
  onName,
  onDescription,
  onOpening,
  onPlayerName,
  onPlayerDescription,
  children,
}: {
  kind: "worlds" | "characters";
  name: string;
  description: string;
  opening: string;
  playerName: string;
  playerDescription: string;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  onOpening: (v: string) => void;
  onPlayerName: (v: string) => void;
  onPlayerDescription: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <section className="creation-guide" aria-label="作品创建引导">
      <p className="muted">
        写下一点设定，就可以开始。以下内容均可稍后修改，不会自动扩写，也不会调用
        AI。
      </p>
      <label>
        作品名称（可选）
        <input
          autoFocus
          maxLength={100}
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder={kind === "worlds" ? "未命名世界" : "未命名角色"}
        />
      </label>
      <h3>1 · 故事从什么背景开始？</h3>
      <label>
        {kind === "worlds" ? "背景设定" : "人物与背景设定"}
        <textarea
          maxLength={100000}
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          placeholder={
            kind === "worlds"
              ? "例如：一座常年下雨的海边小镇，废弃灯塔昨晚突然亮了。"
              : "例如：守灯人独自住在海边，记得所有来过小镇的人。"
          }
        />
      </label>
      <PlayerFields
        name={playerName}
        description={playerDescription}
        onName={onPlayerName}
        onDescription={onPlayerDescription}
      />
      <h3>2 · 第一幕在哪里？</h3>
      <label>
        开场场景（可选）
        <textarea
          maxLength={100000}
          value={opening}
          onChange={(e) => onOpening(e.target.value)}
          placeholder="例如：你推开灯塔的门，桌上放着一封写着你名字的信。"
        />
      </label>
      <p className="muted">
        开场会原样显示为第一段正文；留空也可以，开始后写下你的第一步行动。
      </p>
      <details className="guided-extra">
        <summary>更多设定（可选）</summary>
        {children}
      </details>
      <p className="muted">
        创建后仍是可编辑的{kind === "worlds" ? "世界书" : "角色卡"}
        ，也能与其他作品组合、绑定预设。
      </p>
    </section>
  );
}
