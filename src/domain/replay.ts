import { createGame, step } from "./gameReducer";
import { STEP_MS } from "./rules/arenaV1";
import type { Replay } from "./types";
export function replayRun(replay: Replay) {
  if (replay.rulesVersion !== "arena-v1") throw new Error("不支援的規則版本");
  let state = createGame(replay.seed, replay.garbageSeed);
  const actions = new Map<number, Replay["actions"]>();
  for (const event of replay.actions)
    actions.set(event.tick, [...(actions.get(event.tick) ?? []), event]);
  for (const event of actions.get(0) ?? [])
    if (event.afterTick) state = step(state, event.action).state;
  for (let tick = 1; tick <= replay.ticks; tick++) {
    for (const event of (actions.get(tick) ?? []).filter(
      (event) => !event.afterTick,
    ))
      state = step(state, event.action).state;
    state = step(state, { type: "TICK", deltaMs: STEP_MS }).state;
    for (const event of (actions.get(tick) ?? []).filter(
      (event) => event.afterTick,
    ))
      state = step(state, event.action).state;
  }
  return state;
}
