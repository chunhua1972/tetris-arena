import { HEIGHT, WIDTH } from "./rules/arenaV1";
import { cells } from "./rules/pieces";
import type { ActivePiece, Board } from "./types";
export const emptyBoard = (): Board => new Uint8Array(WIDTH * HEIGHT);
export function occupied(board: Board, x: number, y: number): boolean {
  return (
    x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || board[y * WIDTH + x] !== 0
  );
}
export function canPlace(board: Board, piece: ActivePiece): boolean {
  return cells(piece.type, piece.rotation).every(
    ([dx, dy]) => !occupied(board, piece.x + dx, piece.y + dy),
  );
}
export function projectGhost(board: Board, piece: ActivePiece): ActivePiece {
  let ghost = { ...piece };
  while (canPlace(board, { ...ghost, y: ghost.y + 1 }))
    ghost = { ...ghost, y: ghost.y + 1 };
  return ghost;
}
export function clearLines(board: Board): { board: Board; cleared: number } {
  const remaining: number[][] = [];
  for (let y = 0; y < HEIGHT; y++) {
    const row = Array.from(board.subarray(y * WIDTH, (y + 1) * WIDTH));
    if (row.some((n) => n === 0)) remaining.push(row);
  }
  const cleared = HEIGHT - remaining.length;
  return {
    board: new Uint8Array([
      ...Array(cleared * WIDTH).fill(0),
      ...remaining.flat(),
    ]),
    cleared,
  };
}
