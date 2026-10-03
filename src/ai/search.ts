import { canPlace, projectGhost } from "../domain/board";
import { createGame, step } from "../domain/gameReducer";
import { rotatePiece } from "../domain/rotation";
import { HEIGHT, WIDTH } from "../domain/rules/arenaV1";
import { nextRandom, seedHash } from "../domain/rng";
import type {
  ActivePiece,
  Board,
  Difficulty,
  GameState,
  InputAction,
} from "../domain/types";
export interface Candidate {
  target: ActivePiece;
  actions: InputAction[];
  state: GameState;
  value: number;
}
export function extractFeatures(board: Board) {
  const heights: number[] = [],
    holes: number[] = [];
  for (let x = 0; x < WIDTH; x++) {
    let top = HEIGHT,
      count = 0;
    for (let y = 0; y < HEIGHT; y++) {
      if (board[y * WIDTH + x]) top = Math.min(top, y);
      else if (top < y) count++;
    }
    heights.push(HEIGHT - top);
    holes.push(count);
  }
  const aggregate = heights.reduce((a, b) => a + b, 0);
  const bumpiness = heights
    .slice(1)
    .reduce((a, h, i) => a + Math.abs(h - heights[i]), 0);
  return {
    aggregate,
    holes: holes.reduce((a, b) => a + b, 0),
    bumpiness,
    maxHeight: Math.max(...heights),
  };
}
function evaluate(state: GameState, before: GameState): number {
  if (state.phase === "finished") return -1e6;
  const f = extractFeatures(state.board);
  return (
    8 * (state.lines - before.lines) +
    2 * (state.attacksSent - before.attacksSent) -
    0.5 * f.aggregate -
    5.5 * f.holes -
    0.4 * f.bumpiness -
    0.7 * f.maxHeight -
    Math.max(0, f.maxHeight - 16) * 8
  );
}
export function enumerateLandings(state: GameState): Candidate[] {
  if (!state.active || state.phase !== "playing") return [];
  const queue: { piece: ActivePiece; actions: InputAction[] }[] = [
    { piece: state.active, actions: [] },
  ];
  const seen = new Set<string>(),
    landings = new Set<string>();
  const result: Candidate[] = [];
  for (let i = 0; i < queue.length && i < 500; i++) {
    const { piece, actions } = queue[i];
    const key = `${piece.x}:${piece.y}:${piece.rotation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ghost = projectGhost(state.board, piece);
    const landingKey = `${ghost.x}:${ghost.y}:${ghost.rotation}`;
    if (!landings.has(landingKey)) {
      landings.add(landingKey);
      const placed = step(
        { ...state, active: piece },
        { type: "HARD_DROP" },
      ).state;
      result.push({
        target: ghost,
        actions: [...actions, { type: "HARD_DROP" }],
        state: placed,
        value: evaluate(placed, state),
      });
    }
    for (const dx of [-1, 1] as const) {
      const candidate = {
        ...piece,
        x: piece.x + dx,
        lastAction: "move" as const,
      };
      if (canPlace(state.board, candidate))
        queue.push({
          piece: candidate,
          actions: [...actions, { type: "MOVE", dx }],
        });
    }
    if (piece.type !== "O")
      for (const direction of [-1, 1] as const) {
        const candidate = rotatePiece(state.board, piece, direction);
        if (candidate)
          queue.push({
            piece: candidate,
            actions: [...actions, { type: "ROTATE", direction }],
          });
      }
  }
  return result;
}
export function choosePlan(
  state: GameState,
  difficulty: Difficulty,
): Candidate | null {
  const candidates = enumerateLandings(state);
  if (!state.holdUsed) {
    const held = step(state, { type: "HOLD" }).state;
    for (const candidate of enumerateLandings(held))
      candidates.push({
        ...candidate,
        actions: [{ type: "HOLD" }, ...candidate.actions],
      });
  }
  if (difficulty === "normal") {
    // Look ahead only at the best six immediate boards; executed off the UI thread.
    candidates.sort((a, b) => b.value - a.value);
    for (const candidate of candidates.slice(0, 6)) {
      const second = enumerateLandings(candidate.state);
      candidate.value +=
        0.6 * (second.length ? Math.max(...second.map((c) => c.value)) : -1e6);
    }
    return (
      candidates
        .slice(0, 6)
        .sort(
          (a, b) => b.value - a.value || a.actions.length - b.actions.length,
        )[0] ?? null
    );
  }
  let rng = seedHash(`${state.seed}:${state.lockIndex}:easy`);
  for (const candidate of candidates) {
    let n: number;
    [rng, n] = nextRandom(rng);
    candidate.value += (n % 100) / 70;
  }
  return (
    candidates.sort(
      (a, b) => b.value - a.value || a.actions.length - b.actions.length,
    )[0] ?? null
  );
}
export function benchmark(seed: string, difficulty: Difficulty, pieces = 80) {
  let state = createGame(seed);
  for (let i = 0; i < pieces && state.phase === "playing"; i++) {
    const plan = choosePlan(state, difficulty);
    if (!plan) break;
    for (const action of plan.actions) state = step(state, action).state;
  }
  return state;
}
