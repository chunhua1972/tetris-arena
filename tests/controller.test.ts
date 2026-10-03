// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameController } from "../src/controllers/GameController";
import { replayRun } from "../src/domain/replay";
import { STEP_MS } from "../src/domain/rules/arenaV1";
function clock() {
  let frame: FrameRequestCallback = () => {};
  let time = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return () => {
    time += STEP_MS;
    frame(time);
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("controller replay recording", () => {
  it("includes the final hard drop that ends the game before its next tick", () => {
    const advance = clock(),
      controller = new GameController("solo", "normal", "terminal-replay");
    controller.start();
    for (let n = 0; n < 30 && controller.player.phase !== "finished"; n++) {
      controller.input.press("drop");
      controller.input.release("touch:drop");
      advance();
    }
    controller.stop();
    expect(controller.player.phase).toBe("finished");
    expect(replayRun(controller.replay)).toEqual(controller.player);
  });
  it("records received garbage at the correct boundary between simulation ticks", () => {
    const advance = clock(),
      controller = new GameController("solo", "normal", "garbage-replay");
    controller.start();
    controller.receiveGarbage({ attackId: "initial", holes: [4, 4] });
    advance();
    controller.receiveGarbage({ attackId: "between", holes: [2] });
    controller.input.press("drop");
    controller.input.release("touch:drop");
    advance();
    controller.stop();
    expect(replayRun(controller.replay)).toEqual(controller.player);
  });
});
