import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fixture from "./fixtures/arena-v1.json";
import { canPlace, projectGhost } from "../src/domain/board";
import { cancelGarbage, createGame, step } from "../src/domain/gameReducer";
import { seedHash, shuffledBag } from "../src/domain/rng";
import { rotatePiece } from "../src/domain/rotation";
import { cells } from "../src/domain/rules/pieces";
import { STEP_MS } from "../src/domain/rules/arenaV1";
import { detectTSpin, scoreClear } from "../src/domain/scoring";
import { replayRun } from "../src/domain/replay";
import {
  PIECES,
  type ActivePiece,
  type GameState,
  type Replay,
} from "../src/domain/types";
const tick = (state: GameState, count: number) => {
  for (let i = 0; i < count; i++)
    state = step(state, { type: "TICK", deltaMs: STEP_MS }).state;
  return state;
};
function grounded() {
  const state = createGame("grounded");
  state.active = {
    type: "O",
    rotation: 0,
    x: 3,
    y: 20,
    lastAction: "fall",
    kickIndex: null,
  };
  return state;
}
describe("Arena v1 deterministic rules", () => {
  it("each seeded bag contains exactly the seven pieces", () => {
    let rng = seedHash("two-bags");
    for (let i = 0; i < 100; i++) {
      const result = shuffledBag(rng);
      expect([...result.bag].sort()).toEqual([...PIECES].sort());
      expect(result).toEqual(shuffledBag(rng));
      rng = result.state;
    }
  });
  it("all four rotations have four distinct integer cells", () => {
    for (const piece of PIECES)
      for (const rotation of [0, 1, 2, 3] as const) {
        const points = cells(piece, rotation);
        expect(new Set(points.map((p) => p.join(","))).size).toBe(4);
        expect(points.every((p) => p.every(Number.isInteger))).toBe(true);
      }
  });
  it("I uses its second kick to rotate away from the left wall", () => {
    const state = createGame("kick");
    const active: ActivePiece = {
      type: "I",
      rotation: 1,
      x: -2,
      y: 8,
      lastAction: "spawn",
      kickIndex: null,
    };
    expect(canPlace(state.board, active)).toBe(true);
    const rotated = rotatePiece(state.board, active, -1);
    expect(rotated).toMatchObject({ x: 0, y: 8, rotation: 0, kickIndex: 1 });
  });
  it("T floor kick follows the y-down SRS order", () => {
    const state = createGame("kick");
    const active: ActivePiece = {
      type: "T",
      rotation: 0,
      x: 3,
      y: 20,
      lastAction: "spawn",
      kickIndex: null,
    };
    expect(rotatePiece(state.board, active, 1)).toMatchObject({
      x: 2,
      y: 19,
      rotation: 1,
      kickIndex: 2,
    });
  });
  it("O rotations do not drift", () => {
    const state = grounded();
    const rotated = rotatePiece(state.board, state.active!, 1)!;
    expect(rotated.x).toBe(state.active!.x);
    expect(rotated.y).toBe(state.active!.y);
    expect(cells("O", rotated.rotation)).toEqual(cells("O", 0));
  });
  it("hold is allowed once per piece, then resets after locking", () => {
    let state = createGame("hold");
    const first = state.active!.type;
    state = step(state, { type: "HOLD" }).state;
    expect(state.hold).toBe(first);
    const second = state.active!.type;
    state = step(state, { type: "HOLD" }).state;
    expect(state.active!.type).toBe(second);
    state = step(state, { type: "HARD_DROP" }).state;
    expect(state.holdUsed).toBe(false);
    state = step(state, { type: "HOLD" }).state;
    expect(state.active!.type).toBe(first);
  });
  it("a colliding hold spawn causes block out", () => {
    const state = createGame("blocked");
    state.board.fill(8, 0, 20);
    expect(step(state, { type: "HOLD" }).state.topOutReason).toBe("block_out");
  });
  it("locking cells in hidden rows causes lock out", () => {
    const state = grounded();
    state.active = { ...state.active!, y: 0 };
    state.board[24] = 8;
    state.board[25] = 8;
    expect(step(state, { type: "HARD_DROP" }).state.topOutReason).toBe(
      "lock_out",
    );
  });
  it.each(PIECES)("ghost and hard drop agree for %s", (type) => {
    const state = createGame("ghost");
    state.active = {
      type,
      rotation: 0,
      x: 3,
      y: 0,
      lastAction: "spawn",
      kickIndex: null,
    };
    const ghost = projectGhost(state.board, state.active);
    const result = step(state, { type: "HARD_DROP" }).state;
    for (const [dx, dy] of cells(type, 0))
      expect(result.board[(ghost.y + dy) * 10 + ghost.x + dx]).toBeGreaterThan(
        0,
      );
    expect(result.score).toBe(ghost.y * 2);
    expect(result.lockIndex).toBe(1);
  });
  it("lock delay is 500 ms and uses simulation time", () => {
    let state = grounded();
    state = tick(state, 29);
    expect(state.lockIndex).toBe(0);
    state = tick(state, 1);
    expect(state.lockIndex).toBe(1);
  });
  it("only the first fifteen grounded movements reset the lock clock", () => {
    let state = grounded();
    for (let i = 0; i < 15; i++) {
      state = tick(state, 6);
      state = step(state, { type: "MOVE", dx: i % 2 ? -1 : 1 }).state;
    }
    expect(state.lockResets).toBe(15);
    state = tick(state, 24);
    const before = state.groundedMs;
    state = step(state, { type: "MOVE", dx: -1 }).state;
    expect(state.groundedMs).toBe(before);
    expect(tick(state, 6).lockIndex).toBe(1);
  });
  it("T-spin requires a rotation and at least three occupied corners", () => {
    const state = createGame("spin");
    const p: ActivePiece = {
      type: "T",
      rotation: 0,
      x: 3,
      y: 18,
      lastAction: "rotate",
      kickIndex: 0,
    };
    state.board[18 * 10 + 3] = 8;
    state.board[18 * 10 + 5] = 8;
    state.board[20 * 10 + 3] = 8;
    expect(detectTSpin(state.board, p)).toBe(true);
    expect(detectTSpin(state.board, { ...p, lastAction: "fall" })).toBe(false);
    state.board[20 * 10 + 3] = 0;
    expect(detectTSpin(state.board, p)).toBe(false);
  });
  it("B2B survives no-clear locks, adds 1.5x base score, and a Single breaks it", () => {
    const a = scoreClear(4, false, false, 1, -1, false);
    expect(a.score).toBe(800);
    const empty = scoreClear(0, false, false, 1, a.combo, a.backToBack);
    expect(empty.backToBack).toBe(true);
    const b = scoreClear(4, false, false, 1, empty.combo, empty.backToBack);
    expect(b.score).toBe(1200);
    expect(b.attack).toBe(5);
    expect(
      scoreClear(1, false, false, 1, b.combo, b.backToBack).backToBack,
    ).toBe(false);
  });
  it("combo, pre-clear level and perfect clear scoring are explicit", () => {
    const first = scoreClear(1, false, false, 2, -1, false);
    expect(first.score).toBe(200);
    const second = scoreClear(2, false, false, 2, first.combo, false);
    expect(second.score).toBe(700);
    expect(scoreClear(4, false, true, 1, 10, true).attack).toBe(12);
    expect(scoreClear(4, false, true, 1, -1, false).score).toBe(2800);
  });
  it("cancels the oldest holes before inserting the remaining two lines", () => {
    expect(
      cancelGarbage(3, [{ attackId: "a", holes: [1, 2, 3, 4, 5] }]),
    ).toEqual({ attack: 0, packets: [{ attackId: "a", holes: [4, 5] }] });
    expect(
      cancelGarbage(6, [
        { attackId: "a", holes: [1, 2] },
        { attackId: "b", holes: [3, 4, 5] },
      ]),
    ).toEqual({ attack: 1, packets: [] });
  });
  it("garbage packets are validated and deduplicated", () => {
    const state = createGame("garbage");
    const once = step(state, {
      type: "RECEIVE_GARBAGE",
      packet: { attackId: "a", holes: [3, 3] },
    }).state;
    const twice = step(once, {
      type: "RECEIVE_GARBAGE",
      packet: { attackId: "a", holes: [3, 3] },
    }).state;
    expect(twice.pendingGarbage).toHaveLength(1);
    expect(twice.attacksReceived).toBe(2);
    expect(
      step(twice, {
        type: "RECEIVE_GARBAGE",
        packet: { attackId: "b", holes: [10] },
      }).state,
    ).toBe(twice);
  });
  it("inserts at most twelve garbage rows per lock, with the specified holes", () => {
    let state = grounded();
    state = step(state, {
      type: "RECEIVE_GARBAGE",
      packet: { attackId: "a", holes: Array(12).fill(3) },
    }).state;
    state = step(state, {
      type: "RECEIVE_GARBAGE",
      packet: { attackId: "b", holes: Array(5).fill(7) },
    }).state;
    state = step(state, { type: "HARD_DROP" }).state;
    expect(state.pendingGarbage[0].holes).toHaveLength(5);
    for (let y = 10; y < 22; y++) {
      expect(state.board[y * 10 + 3]).toBe(0);
      expect(state.board[y * 10 + 4]).toBe(8);
    }
  });
  it("garbage pushing an occupied top row ends the game", () => {
    let state = grounded();
    state.board[0] = 8;
    state = step(state, {
      type: "RECEIVE_GARBAGE",
      packet: { attackId: "a", holes: [4] },
    }).state;
    expect(step(state, { type: "HARD_DROP" }).state.topOutReason).toBe(
      "garbage_overflow",
    );
  });
  it("score overflow stops accumulation without integer overflow", () => {
    const state = createGame("score");
    state.score = Number.MAX_SAFE_INTEGER;
    const next = step(state, { type: "SOFT_DROP" }).state;
    expect(next.score).toBe(Number.MAX_SAFE_INTEGER);
    expect(next.scoreOverflow).toBe(true);
  });
  it("paused simulation does not advance and resumes explicitly", () => {
    const original = createGame("pause");
    const paused = step(original, { type: "PAUSE" }).state;
    expect(tick(paused, 60).tick).toBe(0);
    expect(tick(step(paused, { type: "RESUME" }).state, 60).tick).toBe(60);
  });
  it("replays the same input timeline independently of rendering frame batches", () => {
    const replay = fixture as Replay;
    const expected = replayRun(replay);
    for (const frameTicks of [1, 2, 4]) {
      let state = createGame(replay.seed, replay.garbageSeed);
      for (let frame = 0; frame < replay.ticks; frame += frameTicks)
        for (
          let i = frame + 1;
          i <= Math.min(replay.ticks, frame + frameTicks);
          i++
        ) {
          for (const event of replay.actions.filter((a) => a.tick === i))
            state = step(state, event.action).state;
          state = step(state, { type: "TICK", deltaMs: STEP_MS }).state;
        }
      expect(state).toEqual(expected);
    }
    const hash = createHash("sha256")
      .update(
        JSON.stringify({ ...expected, board: Array.from(expected.board) }),
      )
      .digest("hex");
    expect(hash).toBe(
      "5d28a9c16cd100e3a317efc15f0e6ad1667409ce2bdb28a516772d7a4818517c",
    );
    expect(expected.lockIndex).toBe(5);
  });
});
