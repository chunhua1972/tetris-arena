import { z } from "zod";
import { createGame } from "../domain/gameReducer";
import { PIECES, type GameState } from "../domain/types";
export const activeSchema = z.object({
  type: z.enum(PIECES),
  rotation: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  x: z.number().int().min(-4).max(10),
  y: z.number().int().min(0).max(21),
  lastAction: z.enum(["spawn", "move", "rotate", "fall"]),
  kickIndex: z.number().int().min(0).max(4).nullable(),
});
export const snapshotSchema = z.object({
  board: z
    .string()
    .length(220)
    .regex(/^[0-8]+$/),
  active: activeSchema.nullable(),
  hold: z.enum(PIECES).nullable(),
  next: z.array(z.enum(PIECES)).length(5),
  score: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  lines: z.number().int().min(0).max(100000),
  level: z.number().int().min(1).max(10001),
  tick: z.number().int().nonnegative(),
  lockIndex: z.number().int().nonnegative(),
  phase: z.enum(["playing", "paused", "finished"]),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const attackSchema = z
  .object({
    attackId: z.string().uuid(),
    attackSeq: z.number().int().positive(),
    lockIndex: z.number().int().positive(),
    lines: z.number().int().min(1).max(12),
    holes: z.array(z.number().int().min(0).max(9)).min(1).max(12),
  })
  .refine((p) => p.lines === p.holes.length);
const base = z.object({
  v: z.literal(1),
  eventId: z.string().uuid(),
  roomId: z.string().uuid(),
  matchId: z.string().uuid(),
  roundId: z.string().uuid(),
  senderId: z.string().uuid(),
  connectionId: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  sentAt: z.string().datetime(),
});
export const roomEventSchema = z.discriminatedUnion("kind", [
  base.extend({ kind: z.literal("attack"), payload: attackSchema }),
  base.extend({
    kind: z.literal("attack_ack"),
    payload: z.object({
      attackId: z.string().uuid(),
      receivedAtTick: z.number().int().nonnegative(),
    }),
  }),
  base.extend({ kind: z.literal("snapshot"), payload: snapshotSchema }),
  base.extend({
    kind: z.literal("resync_request"),
    payload: z.object({
      requestId: z.string().uuid(),
      nextAttackSeq: z.number().int().positive(),
      response: z.boolean(),
    }),
  }),
  base.extend({
    kind: z.literal("game_over"),
    payload: z.object({
      reason: z.enum(["top_out", "surrender", "sync_failed"]),
    }),
  }),
]);
export type RoomEvent = z.infer<typeof roomEventSchema>;
export type Attack = z.infer<typeof attackSchema>;
export function belongsToRound(
  event: RoomEvent,
  expected: {
    roomId: string;
    matchId: string;
    roundId: string;
    opponentId: string;
    connectionId: string;
  },
) {
  return (
    event.roomId === expected.roomId &&
    event.matchId === expected.matchId &&
    event.roundId === expected.roundId &&
    event.senderId === expected.opponentId &&
    event.connectionId === expected.connectionId
  );
}
export function encodeSnapshot(state: GameState): Snapshot {
  return {
    board: Array.from(state.board).join(""),
    active: state.active,
    hold: state.hold,
    next: state.next.slice(0, 5),
    score: state.score,
    lines: state.lines,
    level: state.level,
    tick: state.tick,
    lockIndex: state.lockIndex,
    phase: state.phase,
  };
}
export function decodeSnapshot(snapshot: Snapshot): GameState {
  const s = snapshotSchema.parse(snapshot);
  return {
    ...createGame("opponent-preview"),
    ...s,
    board: new Uint8Array([...s.board].map(Number)),
  };
}
