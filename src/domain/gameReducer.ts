import { canPlace, clearLines, emptyBoard, projectGhost } from "./board";
import {
  HEIGHT,
  HIDDEN_ROWS,
  LOCK_DELAY_MS,
  MAX_LOCK_RESETS,
  WIDTH,
  gravityMs,
  RULES_VERSION,
} from "./rules/arenaV1";
import { cells, pieceId } from "./rules/pieces";
import { nextRandom, seedHash, shuffledBag } from "./rng";
import { rotatePiece } from "./rotation";
import { detectTSpin, scoreClear } from "./scoring";
import type {
  ActivePiece,
  Board,
  GameState,
  GameAction,
  GameEffect,
  GarbagePacket,
  PieceType,
  StepResult,
} from "./types";
const finished = (state: GameState) => state.phase === "finished";

function refill(state: GameState): void {
  while (state.next.length < 6) {
    const result = shuffledBag(state.pieceRng);
    state.pieceRng = result.state;
    state.next.push(...result.bag);
  }
}
function spawn(state: GameState, type?: PieceType): void {
  refill(state);
  state.active = {
    type: type ?? state.next.shift()!,
    rotation: 0,
    x: 3,
    y: 0,
    lastAction: "spawn",
    kickIndex: null,
  };
  refill(state);
  state.gravityMs = 0;
  state.groundedMs = 0;
  state.lockResets = 0;
  if (!canPlace(state.board, state.active)) {
    state.phase = "finished";
    state.topOutReason = "block_out";
  }
}
export function createGame(
  seed: string,
  garbageSeed = `${seed}:garbage`,
): GameState {
  const state: GameState = {
    rulesVersion: RULES_VERSION,
    seed,
    board: emptyBoard(),
    active: null,
    next: [],
    hold: null,
    holdUsed: false,
    pieceRng: seedHash(seed),
    garbageRng: seedHash(garbageSeed),
    lastHole: -1,
    holeRepeats: 0,
    score: 0,
    lines: 0,
    level: 1,
    combo: -1,
    backToBack: false,
    pendingGarbage: [],
    receivedAttackIds: [],
    tick: 0,
    lockIndex: 0,
    gravityMs: 0,
    groundedMs: 0,
    lockResets: 0,
    attacksSent: 0,
    attacksReceived: 0,
    lastClear: "",
    phase: "playing",
    scoreOverflow: false,
  };
  spawn(state);
  return state;
}
function addScore(state: GameState, points: number): void {
  if (state.scoreOverflow) return;
  if (!Number.isSafeInteger(state.score + points)) state.scoreOverflow = true;
  else state.score += points;
}
export function cancelGarbage(attack: number, packets: GarbagePacket[]) {
  const remaining: GarbagePacket[] = [];
  for (const packet of packets) {
    const cancelled = Math.min(attack, packet.holes.length);
    attack -= cancelled;
    const holes = packet.holes.slice(cancelled);
    if (holes.length) remaining.push({ ...packet, holes });
  }
  return { attack, packets: remaining };
}
function makeHoles(state: GameState, lines: number): number[] {
  let n: number;
  [state.garbageRng, n] = nextRandom(state.garbageRng);
  let hole = n % WIDTH;
  if (hole === state.lastHole && state.holeRepeats >= 2)
    hole = (hole + 1 + (n % 9)) % WIDTH;
  state.holeRepeats = hole === state.lastHole ? state.holeRepeats + 1 : 1;
  state.lastHole = hole;
  return Array(lines).fill(hole);
}
function lock(state: GameState, effects: GameEffect[]): void {
  const active = state.active!;
  const tSpin = detectTSpin(state.board, active);
  let board: Board = state.board.slice();
  for (const [dx, dy] of cells(active.type, active.rotation))
    board[(active.y + dy) * WIDTH + active.x + dx] = pieceId(active.type);
  const clear = clearLines(board);
  board = clear.board;
  const points = scoreClear(
    clear.cleared,
    tSpin,
    clear.cleared > 0 && board.every((n) => n === 0),
    state.level,
    state.combo,
    state.backToBack,
  );
  addScore(state, points.score);
  state.lines += clear.cleared;
  state.level = Math.floor(state.lines / 10) + 1;
  state.combo = points.combo;
  state.backToBack = points.backToBack;
  state.lastClear = points.label;
  state.lockIndex++;
  state.holdUsed = false;
  state.active = null;
  const cancellation = cancelGarbage(points.attack, state.pendingGarbage);
  state.pendingGarbage = cancellation.packets;
  if (cancellation.attack > 0) {
    state.attacksSent += cancellation.attack;
    effects.push({
      type: "ATTACK",
      lockIndex: state.lockIndex,
      packet: {
        attackId: `${state.seed}:${state.lockIndex}`,
        holes: makeHoles(state, cancellation.attack),
      },
    });
  }
  let inserted = 0;
  const leftovers: GarbagePacket[] = [];
  for (const packet of state.pendingGarbage) {
    const amount = Math.min(packet.holes.length, 12 - inserted);
    for (const hole of packet.holes.slice(0, amount)) {
      if (board.subarray(0, WIDTH).some((n) => n !== 0)) {
        state.phase = "finished";
        state.topOutReason = "garbage_overflow";
      }
      board.copyWithin(0, WIDTH);
      board.fill(8, (HEIGHT - 1) * WIDTH);
      board[(HEIGHT - 1) * WIDTH + hole] = 0;
    }
    inserted += amount;
    if (amount < packet.holes.length)
      leftovers.push({ ...packet, holes: packet.holes.slice(amount) });
  }
  state.pendingGarbage = leftovers;
  state.board = board;
  if (
    state.phase !== "finished" &&
    board.subarray(0, HIDDEN_ROWS * WIDTH).some((n) => n !== 0)
  ) {
    state.phase = "finished";
    state.topOutReason = "lock_out";
  }
  effects.push({ type: "LOCK", cleared: clear.cleared });
  if (state.phase !== "finished") spawn(state);
  if (state.phase === "finished")
    effects.push({ type: "GAME_OVER", reason: state.topOutReason! });
}
function resetLock(state: GameState, wasGrounded: boolean): void {
  if (wasGrounded && state.lockResets < MAX_LOCK_RESETS) {
    state.groundedMs = 0;
    state.lockResets++;
  }
  if (
    state.active &&
    canPlace(state.board, { ...state.active, y: state.active.y + 1 })
  )
    state.groundedMs = 0;
}
export function step(original: GameState, action: GameAction): StepResult {
  const effects: GameEffect[] = [];
  if (original.phase === "finished") return { state: original, effects };
  const state: GameState = { ...original, next: [...original.next] };
  if (action.type === "RECEIVE_GARBAGE") {
    const p = action.packet;
    if (
      !p.attackId ||
      p.holes.length < 1 ||
      p.holes.length > 12 ||
      p.holes.some((h) => !Number.isInteger(h) || h < 0 || h >= WIDTH) ||
      state.receivedAttackIds.includes(p.attackId)
    )
      return { state: original, effects };
    state.receivedAttackIds = [
      ...state.receivedAttackIds.slice(-511),
      p.attackId,
    ];
    state.pendingGarbage = [
      ...state.pendingGarbage,
      { ...p, holes: [...p.holes] },
    ];
    state.attacksReceived += p.holes.length;
    return { state, effects };
  }
  if (action.type === "PAUSE") {
    state.phase = "paused";
    return { state, effects };
  }
  if (action.type === "RESUME") {
    state.phase = "playing";
    return { state, effects };
  }
  if (state.phase !== "playing" || !state.active)
    return { state: original, effects };
  const active = state.active;
  const wasGrounded = !canPlace(state.board, { ...active, y: active.y + 1 });
  switch (action.type) {
    case "MOVE": {
      const candidate = {
        ...active,
        x: active.x + action.dx,
        lastAction: "move" as const,
      };
      if (canPlace(state.board, candidate)) {
        state.active = candidate;
        resetLock(state, wasGrounded);
      }
      break;
    }
    case "ROTATE": {
      const candidate = rotatePiece(state.board, active, action.direction);
      if (candidate) {
        state.active = candidate;
        resetLock(state, wasGrounded);
      }
      break;
    }
    case "SOFT_DROP": {
      const candidate = {
        ...active,
        y: active.y + 1,
        lastAction: "fall" as const,
      };
      if (canPlace(state.board, candidate)) {
        state.active = candidate;
        state.gravityMs = 0;
        state.groundedMs = 0;
        addScore(state, 1);
      }
      break;
    }
    case "HARD_DROP": {
      const ghost = projectGhost(state.board, active);
      const distance = ghost.y - active.y;
      state.active = {
        ...ghost,
        lastAction: distance > 0 ? "fall" : active.lastAction,
      };
      addScore(state, distance * 2);
      lock(state, effects);
      break;
    }
    case "HOLD": {
      if (!state.holdUsed) {
        const held = state.hold;
        state.hold = active.type;
        state.holdUsed = true;
        spawn(state, held ?? undefined);
        if (finished(state))
          effects.push({ type: "GAME_OVER", reason: state.topOutReason! });
      }
      break;
    }
    case "TICK": {
      if (
        !Number.isFinite(action.deltaMs) ||
        action.deltaMs < 0 ||
        action.deltaMs > 250
      )
        return { state: original, effects };
      state.tick++;
      state.gravityMs += action.deltaMs;
      const interval = gravityMs(state.level);
      while (state.gravityMs + 1e-7 >= interval) {
        state.gravityMs = Math.max(0, state.gravityMs - interval);
        const candidate: ActivePiece = {
          ...state.active!,
          y: state.active!.y + 1,
          lastAction: "fall",
        };
        if (canPlace(state.board, candidate)) state.active = candidate;
      }
      if (
        !canPlace(state.board, { ...state.active!, y: state.active!.y + 1 })
      ) {
        state.groundedMs += action.deltaMs;
        if (state.groundedMs + 1e-7 >= LOCK_DELAY_MS) lock(state, effects);
      } else state.groundedMs = 0;
      break;
    }
  }
  return { state, effects };
}
