import { z } from "zod";
export const kinds = {
  unclassified: "未分类",
  rule: "核心规则",
  lore: "世界/人物资料",
  opening: "开局引导",
  style: "叙事要求",
  mechanic: "条件机制",
  example: "示例文本",
} as const;
export const sectionKind = z.enum([
  "unclassified",
  "rule",
  "lore",
  "opening",
  "style",
  "mechanic",
  "example",
]);
export type DocumentSection = {
  index: number;
  start: number;
  end: number;
  text: string;
  kind: z.infer<typeof sectionKind>;
  origin: "pending" | "model" | "user";
};
export type DocumentPlan = {
  documentId: string;
  hash: string;
  revision: number;
  sections: DocumentSection[];
};
