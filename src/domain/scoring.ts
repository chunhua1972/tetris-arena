import { occupied } from "./board";
import type { ActivePiece, Board } from "./types";
export function detectTSpin(board: Board, piece: ActivePiece): boolean {
  if (piece.type !== "T" || piece.lastAction !== "rotate") return false;
  const x = piece.x + 1,
    y = piece.y + 1;
  return (
    [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].filter(([dx, dy]) => occupied(board, x + dx, y + dy)).length >= 3
  );
}
export function scoreClear(
  cleared: number,
  tSpin: boolean,
  perfect: boolean,
  level: number,
  oldCombo: number,
  oldB2B: boolean,
) {
  const combo = cleared > 0 ? oldCombo + 1 : -1;
  const difficult = cleared === 4 || (tSpin && cleared > 0);
  const b2bBonus = difficult && oldB2B;
  let base =
    (tSpin ? [400, 800, 1200, 1600] : [0, 100, 300, 500, 800])[cleared] ?? 0;
  if (b2bBonus) base = Math.floor(base * 1.5);
  const score =
    (base + (cleared ? 50 * combo : 0) + (perfect ? 2000 : 0)) * level;
  let attack = (tSpin ? [0, 2, 4, 6] : [0, 0, 1, 2, 4])[cleared] ?? 0;
  attack +=
    (b2bBonus ? 1 : 0) +
    (cleared ? Math.min(4, Math.floor(combo / 2)) : 0) +
    (perfect ? 6 : 0);
  const name = tSpin
    ? `T-SPIN${cleared ? ` ${cleared}` : ""}`
    : ["", "SINGLE", "DOUBLE", "TRIPLE", "TETRIS"][cleared];
  return {
    score,
    attack: Math.min(12, attack),
    combo,
    backToBack: cleared ? difficult : oldB2B,
    label: perfect ? "PERFECT CLEAR" : `${b2bBonus ? "B2B · " : ""}${name}`,
  };
}
