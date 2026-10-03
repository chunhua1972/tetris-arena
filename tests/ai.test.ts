import { describe, expect, it } from "vitest";
import { benchmark, choosePlan, enumerateLandings } from "../src/ai/search";
import { canPlace } from "../src/domain/board";
import { createGame, step } from "../src/domain/gameReducer";
describe("AI uses the same legal actions as a player", () => {
  it("enumerates reachable landings and follows legal paths", () => {
    const original = createGame("ai-path");
    const candidates = enumerateLandings(original);
    expect(candidates.length).toBeGreaterThan(10);
    for (const candidate of candidates) {
      let state = original;
      for (const action of candidate.actions) {
        if (action.type === "HARD_DROP") {
          expect(state.active).toMatchObject({
            x: candidate.target.x,
            rotation: candidate.target.rotation,
          });
        }
        state = step(state, action).state;
        if (state.active && state.phase === "playing")
          expect(canPlace(state.board, state.active)).toBe(true);
      }
      expect(state.board).toEqual(candidate.state.board);
    }
  });
  it("plans deterministically for both difficulty levels", () => {
    for (const difficulty of ["easy", "normal"] as const) {
      const state = createGame("ai-repeat");
      expect(choosePlan(state, difficulty)?.actions).toEqual(
        choosePlan(state, difficulty)?.actions,
      );
    }
  });
  it("normal difficulty survives and clears lines on the fixed benchmark", () => {
    const state = benchmark("ai-benchmark", "normal", 40);
    expect(state.lockIndex).toBe(40);
    expect(state.lines).toBeGreaterThan(8);
    expect(state.phase).toBe("playing");
  });
});
