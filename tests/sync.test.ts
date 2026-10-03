import { describe, expect, it } from "vitest";
import { AttackSynchronizer } from "../src/services/syncManager";
import {
  attackSchema,
  belongsToRound,
  decodeSnapshot,
  encodeSnapshot,
  roomEventSchema,
  type Attack,
} from "../src/services/eventSchemas";
import { createGame } from "../src/domain/gameReducer";
import { InputController } from "../src/controllers/InputController";
import { STEP_MS } from "../src/domain/rules/arenaV1";
import type { InputAction } from "../src/domain/types";
const attack = (seq: number): Attack => ({
  attackId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
  attackSeq: seq,
  lockIndex: seq,
  lines: 2,
  holes: [3, 3],
});
describe("reliable attack ordering", () => {
  it("buffers out-of-order attacks and ACKs only when applied in order", () => {
    const applied: number[] = [],
      acks: string[] = [];
    const sync = new AttackSynchronizer(
      (a) => applied.push(a.attackSeq),
      (id) => acks.push(id),
    );
    sync.receive(attack(2));
    expect(sync.hasGap).toBe(true);
    expect(acks).toHaveLength(0);
    sync.receive(attack(1));
    expect(applied).toEqual([1, 2]);
    expect(acks).toHaveLength(2);
    expect(sync.hasGap).toBe(false);
    sync.receive(attack(1));
    expect(applied).toEqual([1, 2]);
    expect(acks).toHaveLength(3);
  });
  it("retries and ACKs independently of the snapshot stream", () => {
    const sync = new AttackSynchronizer(
      () => {},
      () => {},
    );
    sync.create([4], 1, attack(1).attackId);
    expect(sync.retries(1000)).toHaveLength(1);
    expect(sync.retries(1100)).toHaveLength(0);
    sync.ack(attack(1).attackId);
    expect(sync.retries(2000)).toHaveLength(0);
  });
  it("restores an unacknowledged packet without generating a new attack ID", () => {
    const original = new AttackSynchronizer(
      () => {},
      () => {},
    );
    const sent = original.create([4, 4], 1, attack(1).attackId);
    const restored = new AttackSynchronizer(
      () => {},
      () => {},
    );
    restored.restore(JSON.parse(JSON.stringify(original.export())));
    expect(restored.retries(1000)).toEqual([sent]);
    expect(restored.resendFrom(1)).toEqual([sent]);
  });
  it("rejects lost windows and conflicting sequence numbers", () => {
    const sync = new AttackSynchronizer(
      () => {},
      () => {},
    );
    expect(() => sync.receive(attack(34))).toThrow();
    sync.receive(attack(2));
    expect(() =>
      sync.receive({ ...attack(2), attackId: attack(3).attackId }),
    ).toThrow();
    expect(() => sync.resendFrom(2)).toThrow();
  });
  it("bounds the sender window at 32 packets", () => {
    const sync = new AttackSynchronizer(
      () => {},
      () => {},
    );
    for (let n = 1; n <= 32; n++) sync.create([4], n, attack(n).attackId);
    expect(() => sync.create([3], 33, attack(33).attackId)).toThrow();
  });
  it("rejects invalid holes, line counts and malformed events", () => {
    expect(attackSchema.safeParse({ ...attack(1), lines: 12 }).success).toBe(
      false,
    );
    expect(
      attackSchema.safeParse({ ...attack(1), holes: [-1, 3] }).success,
    ).toBe(false);
    expect(
      roomEventSchema.safeParse({ kind: "attack", payload: attack(1) }).success,
    ).toBe(false);
  });
  it("serializes the opponent board without losing piece colors", () => {
    const game = createGame("snapshot");
    game.board[219] = 8;
    const snapshot = encodeSnapshot(game);
    expect(JSON.stringify(snapshot).length).toBeLessThan(1024);
    expect(decodeSnapshot(snapshot).board).toEqual(game.board);
  });
  it("isolates old matches, rounds, non-opponents and old controller connections", () => {
    const id = () => crypto.randomUUID();
    const expected = {
      roomId: id(),
      matchId: id(),
      roundId: id(),
      opponentId: id(),
      connectionId: id(),
    };
    const event = roomEventSchema.parse({
      v: 1,
      eventId: id(),
      roomId: expected.roomId,
      matchId: expected.matchId,
      roundId: expected.roundId,
      senderId: expected.opponentId,
      connectionId: expected.connectionId,
      seq: 0,
      sentAt: new Date().toISOString(),
      kind: "snapshot",
      payload: encodeSnapshot(createGame("round")),
    });
    expect(belongsToRound(event, expected)).toBe(true);
    for (const field of [
      "roomId",
      "matchId",
      "roundId",
      "senderId",
      "connectionId",
    ] as const)
      expect(belongsToRound({ ...event, [field]: id() }, expected)).toBe(false);
  });
});
describe("fixed-step keyboard and touch repetition", () => {
  it("uses DAS 150 ms and ARR 40 ms instead of browser key repeats", () => {
    const actions: InputAction[] = [];
    const input = new InputController(
      (a) => actions.push(a),
      () => {},
      () => true,
    );
    input.press("left");
    expect(actions).toHaveLength(1);
    for (let i = 0; i < 8; i++) input.tick(STEP_MS);
    expect(actions).toHaveLength(1);
    input.tick(STEP_MS);
    expect(actions).toHaveLength(2);
    for (let i = 0; i < 3; i++) input.tick(STEP_MS);
    expect(actions).toHaveLength(3);
    input.release("touch:left");
    input.tick(300);
    expect(actions).toHaveLength(3);
  });
  it("prioritizes the most recently pressed direction and restores the previous one", () => {
    const actions: InputAction[] = [];
    const input = new InputController(
      (a) => actions.push(a),
      () => {},
      () => true,
    );
    input.press("left");
    input.press("right");
    input.tick(150);
    expect(actions.at(-1)).toEqual({ type: "MOVE", dx: 1 });
    input.release("touch:right");
    input.tick(150);
    expect(actions.at(-1)).toEqual({ type: "MOVE", dx: -1 });
    input.clear();
    const count = actions.length;
    input.tick(500);
    expect(actions).toHaveLength(count);
  });
});
