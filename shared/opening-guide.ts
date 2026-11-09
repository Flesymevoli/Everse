import { z } from "zod";
export const guideQuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(300),
    choices: z.array(z.string().trim().min(1).max(200)).max(8),
    evidence: z.string().trim().min(1).max(1000),
  })
  .strict();
export const openingGuideSchema = z
  .object({
    sourceHash: z.string().length(64),
    questions: z.array(guideQuestionSchema).max(8),
    answers: z.array(z.string().trim().max(2000)).max(8),
  })
  .strict();
export type OpeningGuide = z.infer<typeof openingGuideSchema>;
export function guideAnswers(guide: OpeningGuide | undefined) {
  if (!guide) return "";
  const answers = guide.questions.flatMap((q, i) =>
    guide.answers[i]?.trim()
      ? [{ question: q.question, answer: guide.answers[i] }]
      : [],
  );
  return answers.length
    ? "玩家在作品开局引导中的选择：\n" + JSON.stringify(answers)
    : "";
}
