import { useEffect, useRef } from "react";
import { COLORS, cells } from "../domain/rules/pieces";
import { HIDDEN_ROWS, WIDTH } from "../domain/rules/arenaV1";
import { projectGhost } from "../domain/board";
import type { ActivePiece, GameState } from "../domain/types";
import type { GameController } from "../controllers/GameController";
function paint(canvas: HTMLCanvasElement, game: GameState, ghost = true) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width,
    height = canvas.height,
    size = width / WIDTH;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#10121a";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#222531";
  ctx.lineWidth = Math.max(0.6, width / 600);
  for (let x = 0; x <= 10; x++) {
    ctx.beginPath();
    ctx.moveTo(x * size, 0);
    ctx.lineTo(x * size, height);
    ctx.stroke();
  }
  for (let y = 0; y <= 20; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * size);
    ctx.lineTo(width, y * size);
    ctx.stroke();
  }
  const block = (x: number, y: number, color: string, outline = false) => {
    if (y < HIDDEN_ROWS) return;
    const px = x * size + size * 0.065,
      py = (y - HIDDEN_ROWS) * size + size * 0.065,
      s = size * 0.87;
    if (outline) {
      ctx.strokeStyle = color + "88";
      ctx.lineWidth = size * 0.045;
      ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);
      return;
    }
    ctx.fillStyle = color;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = "#ffffff30";
    ctx.fillRect(px, py, s, size * 0.07);
    ctx.fillRect(px, py, size * 0.07, s);
    ctx.fillStyle = "#00000020";
    ctx.fillRect(px, py + s - size * 0.09, s, size * 0.09);
    ctx.strokeStyle = "#ffffff25";
    ctx.lineWidth = Math.max(1, size * 0.02);
    ctx.strokeRect(
      px + size * 0.17,
      py + size * 0.17,
      s - size * 0.34,
      s - size * 0.34,
    );
  };
  for (let y = HIDDEN_ROWS; y < 22; y++)
    for (let x = 0; x < 10; x++) {
      const id = game.board[y * 10 + x];
      if (id) block(x, y, COLORS[id]);
    }
  const piece = (p: ActivePiece, outline = false) => {
    for (const [dx, dy] of cells(p.type, p.rotation))
      block(
        p.x + dx,
        p.y + dy,
        COLORS[["I", "O", "T", "S", "Z", "J", "L"].indexOf(p.type) + 1],
        outline,
      );
  };
  if (game.active) {
    if (ghost) piece(projectGhost(game.board, game.active), true);
    piece(game.active);
  }
}
export function BoardCanvas({
  controller,
  opponent = false,
  state,
  label,
}: {
  controller?: GameController;
  opponent?: boolean;
  state?: GameState;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const game = controller
        ? opponent
          ? controller.opponent
          : controller.player
        : stateRef.current;
      if (game) paint(canvas, game, !opponent);
    };
    const observer = new ResizeObserver(() => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(bounds.width * ratio);
      canvas.height = canvas.width * 2;
      draw();
    });
    observer.observe(canvas);
    draw();
    const unsubscribe = controller?.subscribeFrames(draw);
    return () => {
      observer.disconnect();
      unsubscribe?.();
    };
  }, [controller, opponent]);
  useEffect(() => {
    if (ref.current && state) paint(ref.current, state, !opponent);
  }, [state, opponent]);
  return (
    <canvas ref={ref} className="board-canvas" role="img" aria-label={label} />
  );
}
