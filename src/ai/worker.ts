/// <reference lib="webworker" />
import { choosePlan } from "./search";
import type { Difficulty, GameState } from "../domain/types";
self.onmessage = (
  event: MessageEvent<{ id: number; state: GameState; difficulty: Difficulty }>,
) => {
  const { id, state, difficulty } = event.data;
  const plan = choosePlan(state, difficulty);
  self.postMessage({
    id,
    lockIndex: state.lockIndex,
    actions: plan?.actions ?? [],
    target: plan?.target ?? null,
  });
};
