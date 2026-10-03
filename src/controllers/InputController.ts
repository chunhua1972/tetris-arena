import { ARR_MS, DAS_MS } from "../domain/rules/arenaV1";
import type { InputAction } from "../domain/types";
export type Control =
  "left" | "right" | "down" | "cw" | "ccw" | "drop" | "hold";
const keyMap: Record<string, Control> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowDown: "down",
  KeyS: "down",
  ArrowUp: "cw",
  KeyX: "cw",
  KeyZ: "ccw",
  Space: "drop",
  KeyC: "hold",
  ShiftLeft: "hold",
  ShiftRight: "hold",
};
export class InputController {
  private held = new Map<string, { control: Control; order: number }>();
  private serial = 0;
  private horizontal: Control | null = null;
  private horizontalMs = 0;
  private nextRepeatMs = DAS_MS;
  private softMs = 0;
  constructor(
    private submit: (action: InputAction) => void,
    private pause: () => void,
    private enabled: () => boolean,
  ) {}
  press(control: Control, source = `touch:${control}`) {
    if (!this.enabled() || this.held.has(source)) return;
    this.held.set(source, { control, order: ++this.serial });
    if (control === "left" || control === "right") {
      this.horizontal = control;
      this.horizontalMs = 0;
      this.nextRepeatMs = DAS_MS;
      this.submit({ type: "MOVE", dx: control === "left" ? -1 : 1 });
    } else if (control === "down") {
      this.submit({ type: "SOFT_DROP" });
      this.softMs = 0;
    } else
      this.submit(
        control === "hold"
          ? { type: "HOLD" }
          : control === "drop"
            ? { type: "HARD_DROP" }
            : { type: "ROTATE", direction: control === "cw" ? 1 : -1 },
      );
  }
  release(source: string) {
    this.held.delete(source);
    const latest = [...this.held.values()]
      .filter((h) => h.control === "left" || h.control === "right")
      .sort((a, b) => b.order - a.order)[0];
    if (this.horizontal !== (latest?.control ?? null)) {
      this.horizontal = latest?.control ?? null;
      this.horizontalMs = 0;
      this.nextRepeatMs = DAS_MS;
    }
  }
  clear() {
    this.held.clear();
    this.horizontal = null;
    this.horizontalMs = 0;
    this.softMs = 0;
  }
  tick(dt: number) {
    if (!this.enabled()) {
      this.clear();
      return;
    }
    if (this.horizontal) {
      this.horizontalMs += dt;
      while (this.horizontalMs + 1e-7 >= this.nextRepeatMs) {
        this.submit({ type: "MOVE", dx: this.horizontal === "left" ? -1 : 1 });
        this.nextRepeatMs += ARR_MS;
      }
    }
    if ([...this.held.values()].some((h) => h.control === "down")) {
      this.softMs += dt;
      while (this.softMs + 1e-7 >= 50) {
        this.submit({ type: "SOFT_DROP" });
        this.softMs -= 50;
      }
    }
  }
  attach() {
    const keydown = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if (e.code === "Escape" || e.code === "KeyP") {
        if (!e.repeat) this.pause();
        return;
      }
      const control = keyMap[e.code];
      if (control) {
        e.preventDefault();
        if (this.enabled() && !e.repeat) this.press(control, e.code);
      }
    };
    const keyup = (e: KeyboardEvent) => this.release(e.code);
    const blur = () => this.clear();
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      this.clear();
    };
  }
}
