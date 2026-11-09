import { z } from "zod";
export const playerSchema = z.object({
  name: z.string().trim().max(100).default(""),
  description: z.string().max(10000).default(""),
});
export type Player = z.infer<typeof playerSchema>;
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function readPlayer(data: unknown): Player | undefined {
  const value = object(object(object(data).extensions).yunotavern).player;
  const result = playerSchema.safeParse(value);
  return result.success && (result.data.name || result.data.description)
    ? result.data
    : undefined;
}
export function withPlayer(
  data: Record<string, unknown>,
  player: Player,
): Record<string, unknown> {
  const extensions = object(data.extensions),
    yuno = object(extensions.yunotavern);
  return {
    ...data,
    extensions: { ...extensions, yunotavern: { ...yuno, player } },
  };
}
