export const PIECES = ["I", "O", "T", "S", "Z", "J", "L"] as const;
export type PieceType = (typeof PIECES)[number];
export type Rotation = 0 | 1 | 2 | 3;
export type Board = Uint8Array;
export type Mode = "solo" | "ai" | "online";
export type Difficulty = "easy" | "normal";
export interface ActivePiece {
  type: PieceType;
  rotation: Rotation;
  x: number;
  y: number;
  lastAction: "spawn" | "move" | "rotate" | "fall";
  kickIndex: number | null;
}
export interface GarbagePacket {
  attackId: string;
  holes: number[];
}
export interface GameState {
  rulesVersion: "arena-v1";
  seed: string;
  board: Board;
  active: ActivePiece | null;
  next: PieceType[];
  hold: PieceType | null;
  holdUsed: boolean;
  pieceRng: number;
  garbageRng: number;
  lastHole: number;
  holeRepeats: number;
  score: number;
  lines: number;
  level: number;
  combo: number;
  backToBack: boolean;
  pendingGarbage: GarbagePacket[];
  receivedAttackIds: string[];
  tick: number;
  lockIndex: number;
  gravityMs: number;
  groundedMs: number;
  lockResets: number;
  attacksSent: number;
  attacksReceived: number;
  lastClear: string;
  phase: "playing" | "paused" | "finished";
  topOutReason?: "block_out" | "lock_out" | "garbage_overflow";
  scoreOverflow: boolean;
}
export type InputAction =
  | { type: "MOVE"; dx: -1 | 1 }
  | { type: "ROTATE"; direction: -1 | 1 }
  | { type: "SOFT_DROP" | "HARD_DROP" | "HOLD" | "PAUSE" | "RESUME" };
export type GameAction =
  | InputAction
  | { type: "TICK"; deltaMs: number }
  | { type: "RECEIVE_GARBAGE"; packet: GarbagePacket };
export type GameEffect =
  | { type: "ATTACK"; packet: GarbagePacket; lockIndex: number }
  | { type: "LOCK"; cleared: number }
  | { type: "GAME_OVER"; reason: string };
export interface StepResult {
  state: GameState;
  effects: GameEffect[];
}
export interface Replay {
  rulesVersion: "arena-v1";
  seed: string;
  garbageSeed: string;
  ticks: number;
  actions: { tick: number; action: GameAction; afterTick?: boolean }[];
}
