export const RULES_VERSION = "arena-v1" as const;
export const WIDTH = 10;
export const HEIGHT = 22;
export const HIDDEN_ROWS = 2;
export const STEP_MS = 1000 / 60;
export const LOCK_DELAY_MS = 500;
export const MAX_LOCK_RESETS = 15;
export const DAS_MS = 150;
export const ARR_MS = 40;
export const GRAVITY_FRAMES = Object.freeze([
  60, 48, 38, 30, 24, 19, 15, 12, 9, 7, 5, 4, 3, 2, 1,
]);
export const gravityMs = (level: number) =>
  GRAVITY_FRAMES[Math.min(level - 1, GRAVITY_FRAMES.length - 1)] * STEP_MS;
