import { canPlace } from "./board";
import { I_KICKS, JLSTZ_KICKS } from "./rules/pieces";
import type { ActivePiece, Board, Rotation } from "./types";
export function rotatePiece(
  board: Board,
  piece: ActivePiece,
  direction: -1 | 1,
): ActivePiece | null {
  const rotation = ((piece.rotation + direction + 4) % 4) as Rotation;
  const kicks =
    piece.type === "O"
      ? [[0, 0]]
      : (piece.type === "I" ? I_KICKS : JLSTZ_KICKS)[
          `${piece.rotation}>${rotation}`
        ];
  for (let i = 0; i < kicks.length; i++) {
    const [dx, dy] = kicks[i];
    const candidate: ActivePiece = {
      ...piece,
      x: piece.x + dx,
      y: piece.y + dy,
      rotation,
      lastAction: "rotate",
      kickIndex: i,
    };
    if (canPlace(board, candidate)) return candidate;
  }
  return null;
}
