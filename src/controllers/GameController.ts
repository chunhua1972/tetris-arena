import { createGame, step } from "../domain/gameReducer";
import { STEP_MS } from "../domain/rules/arenaV1";
import type {
  ActivePiece,
  Difficulty,
  GameAction,
  GameEffect,
  GameState,
  InputAction,
  Mode,
  Replay,
} from "../domain/types";
import { InputController } from "./InputController";
export interface GameView {
  player: GameState;
  opponent: GameState | null;
  outcome: "win" | "loss" | "draw" | "abandoned" | null;
  suspended: boolean;
}
const isFinished = (state: GameState) => state.phase === "finished";
export class GameController {
  player: GameState;
  opponent: GameState | null;
  readonly input: InputController;
  outcome: GameView["outcome"] = null;
  suspended = false;
  started = false;
  private frameId = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private lastUi = 0;
  private listeners = new Set<() => void>();
  private painters = new Set<() => void>();
  private queue: InputAction[] = [];
  private view: GameView;
  private worker: Worker | null = null;
  private aiRequest = 0;
  private thinking = false;
  private aiPlan: {
    actions: InputAction[];
    target: ActivePiece | null;
    lockIndex: number;
  } | null = null;
  private aiMs = 0;
  private cleanupInput: (() => void) | null = null;
  private effects?: (effect: GameEffect) => void;
  private suspendedHandler?: () => void;
  readonly replay: Replay;
  constructor(
    readonly mode: Mode,
    readonly difficulty: Difficulty,
    seed: string,
    garbageSeed?: string,
  ) {
    this.player = createGame(seed, garbageSeed);
    this.opponent =
      mode === "ai" ? createGame(seed, `${seed}:ai-garbage`) : null;
    this.view = {
      player: this.player,
      opponent: this.opponent,
      outcome: null,
      suspended: false,
    };
    this.input = new InputController(
      (a) => this.queue.push(a),
      () => this.togglePause(),
      () =>
        this.started &&
        !this.outcome &&
        !this.suspended &&
        this.player.phase === "playing",
    );
    this.replay = {
      rulesVersion: "arena-v1",
      seed,
      garbageSeed: garbageSeed ?? `${seed}:garbage`,
      ticks: 0,
      actions: [],
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  subscribeFrames = (listener: () => void) => {
    this.painters.add(listener);
    return () => this.painters.delete(listener);
  };
  getSnapshot = () => this.view;
  onEffect(handler: (effect: GameEffect) => void) {
    this.effects = handler;
  }
  onSuspended(handler: () => void) {
    this.suspendedHandler = handler;
  }
  private publish() {
    this.view = {
      player: this.player,
      opponent: this.opponent,
      outcome: this.outcome,
      suspended: this.suspended,
    };
    for (const listener of this.listeners) listener();
  }
  private apply(action: GameAction, ai = false, afterTick = false) {
    const original = ai ? this.opponent! : this.player;
    if (original.phase === "finished") return;
    const result = step(original, action);
    if (ai) this.opponent = result.state;
    else this.player = result.state;
    if (
      !ai &&
      action.type !== "TICK" &&
      action.type !== "PAUSE" &&
      action.type !== "RESUME"
    ) {
      const tick = this.player.tick + (afterTick ? 0 : 1);
      this.replay.actions.push({
        tick,
        action,
        ...(afterTick ? { afterTick: true } : {}),
      });
      this.replay.ticks = Math.max(this.replay.ticks, tick);
    }
    for (const effect of result.effects) {
      if (effect.type === "ATTACK" && this.mode === "ai") {
        if (ai)
          this.apply(
            { type: "RECEIVE_GARBAGE", packet: effect.packet },
            false,
            true,
          );
        else
          this.apply({ type: "RECEIVE_GARBAGE", packet: effect.packet }, true);
      }
      if (!ai) this.effects?.(effect);
    }
  }
  receiveGarbage(packet: { attackId: string; holes: number[] }) {
    this.apply({ type: "RECEIVE_GARBAGE", packet }, false, true);
    this.publish();
  }
  setOpponent(state: GameState) {
    this.opponent = state;
    this.publish();
  }
  setOnlineOutcome(outcome: GameView["outcome"]) {
    this.outcome = outcome;
    this.queue = [];
    this.input.clear();
    this.publish();
  }
  freeze(value: boolean) {
    this.suspended = value;
    this.queue = [];
    this.input.clear();
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.publish();
  }
  togglePause() {
    if (this.mode === "online" || this.outcome || !this.started) return;
    const action: InputAction = {
      type: this.player.phase === "paused" ? "RESUME" : "PAUSE",
    };
    this.player = step(this.player, action).state;
    if (this.opponent) this.opponent = step(this.opponent, action).state;
    this.input.clear();
    this.queue = [];
    this.publish();
  }
  private think() {
    if (
      this.worker &&
      this.opponent &&
      !this.thinking &&
      this.opponent.phase === "playing"
    ) {
      this.thinking = true;
      this.worker.postMessage({
        id: ++this.aiRequest,
        state: this.opponent,
        difficulty: this.difficulty,
      });
    }
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.cleanupInput = this.input.attach();
    if (this.mode === "ai") {
      this.worker = new Worker(new URL("../ai/worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (
        e: MessageEvent<{
          id: number;
          actions: InputAction[];
          target: ActivePiece;
          lockIndex: number;
        }>,
      ) => {
        if (e.data.id !== this.aiRequest) return;
        this.thinking = false;
        if (this.opponent?.lockIndex === e.data.lockIndex) this.aiPlan = e.data;
      };
      this.worker.onerror = () => {
        this.thinking = false;
        this.freeze(true);
      };
      this.think();
    }
    document.addEventListener("visibilitychange", this.visibility);
    this.lastFrame = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
    this.publish();
  }
  private visibility = () => {
    this.input.clear();
    if (document.hidden && this.player.phase === "playing") {
      if (this.mode === "online") {
        this.freeze(true);
        this.suspendedHandler?.();
      } else this.togglePause();
    } else if (!document.hidden && this.mode === "online")
      this.suspendedHandler?.();
  };
  private frame = (now: number) => {
    const elapsed = now - this.lastFrame;
    this.lastFrame = now;
    if (elapsed > 250 && !this.outcome && this.player.phase === "playing") {
      if (this.mode === "online") {
        this.freeze(true);
        this.suspendedHandler?.();
      } else this.togglePause();
    }
    if (!this.suspended && !this.outcome && this.player.phase === "playing") {
      this.accumulator += Math.min(elapsed, 250);
      while (
        this.accumulator + 1e-7 >= STEP_MS &&
        !this.outcome &&
        this.player.phase === "playing"
      ) {
        this.input.tick(STEP_MS);
        for (const action of this.queue.splice(0)) this.apply(action);
        this.apply({ type: "TICK", deltaMs: STEP_MS });
        this.replay.ticks = Math.max(this.replay.ticks, this.player.tick);
        if (this.mode === "ai" && this.opponent?.phase === "playing") {
          this.apply({ type: "TICK", deltaMs: STEP_MS }, true);
          this.aiMs += STEP_MS;
          if (this.aiPlan?.lockIndex !== this.opponent.lockIndex)
            this.aiPlan = null;
          if (!this.aiPlan?.actions.length) this.think();
          if (
            this.aiMs >= (this.difficulty === "normal" ? 180 : 360) &&
            this.aiPlan?.actions.length
          ) {
            this.aiMs = 0;
            const action = this.aiPlan.actions.shift()!;
            const target = this.aiPlan.target,
              active = this.opponent.active;
            if (
              action.type === "HARD_DROP" &&
              target &&
              active &&
              (target.type !== active.type ||
                target.x !== active.x ||
                target.rotation !== active.rotation)
            )
              this.aiPlan = null;
            else this.apply(action, true);
          }
        }
        if (
          this.mode === "ai" &&
          (isFinished(this.player) ||
            (this.opponent && isFinished(this.opponent)))
        )
          this.outcome = isFinished(this.player)
            ? this.opponent && isFinished(this.opponent)
              ? "draw"
              : "loss"
            : "win";
        this.accumulator -= STEP_MS;
      }
    } else this.accumulator = 0;
    for (const painter of this.painters) painter();
    if (
      now - this.lastUi >= 100 ||
      this.player.phase === "finished" ||
      this.outcome
    ) {
      this.lastUi = now;
      this.publish();
    }
    this.frameId = requestAnimationFrame(this.frame);
  };
  stop() {
    cancelAnimationFrame(this.frameId);
    this.started = false;
    this.cleanupInput?.();
    this.cleanupInput = null;
    this.worker?.terminate();
    this.worker = null;
    this.thinking = false;
    this.aiPlan = null;
    this.queue = [];
    this.accumulator = 0;
    document.removeEventListener("visibilitychange", this.visibility);
  }
}
