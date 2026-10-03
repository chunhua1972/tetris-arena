import { z } from "zod";
import type { Difficulty, GameState, Mode } from "../domain/types";
import { STEP_MS } from "../domain/rules/arenaV1";
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Games remain playable with storage disabled. */
  }
}
export const scoreSchema = z.object({
  id: z.string().uuid(),
  mode: z.enum(["solo", "ai"]),
  difficulty: z.enum(["easy", "normal"]),
  score: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  duration_ms: z.number().nonnegative(),
  pieces_locked: z.number().int().nonnegative(),
  outcome: z.enum(["win", "loss", "draw"]).nullable(),
  created_at: z.string(),
});
export type LocalScore = z.infer<typeof scoreSchema>;
export function localScores(): LocalScore[] {
  try {
    return z
      .array(scoreSchema)
      .parse(JSON.parse(readStorage("arena:scores") ?? "[]"));
  } catch {
    return [];
  }
}
export function saveLocalScore(
  game: GameState,
  mode: Exclude<Mode, "online">,
  difficulty: Difficulty,
  outcome: LocalScore["outcome"],
  id: string,
): LocalScore {
  const score: LocalScore = {
    id,
    mode,
    difficulty,
    score: game.score,
    lines: game.lines,
    level: game.level,
    duration_ms: Math.round(game.tick * STEP_MS),
    pieces_locked: game.lockIndex,
    outcome,
    created_at: new Date().toISOString(),
  };
  const rows = localScores();
  if (!rows.some((r) => r.id === id))
    writeStorage(
      "arena:scores",
      JSON.stringify(
        [...rows, score].sort((a, b) => b.score - a.score).slice(0, 100),
      ),
    );
  return score;
}
export function bestScore(mode: Exclude<Mode, "online">) {
  return Math.max(
    0,
    ...localScores()
      .filter((s) => s.mode === mode)
      .map((s) => s.score),
  );
}
