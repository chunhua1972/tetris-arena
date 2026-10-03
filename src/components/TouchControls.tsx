import type { PointerEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronsDown,
  RotateCcw,
  RotateCw,
  RefreshCw,
} from "lucide-react";
import type { Control, InputController } from "../controllers/InputController";
const controls = [
  ["hold", "保留", RefreshCw],
  ["ccw", "左旋", RotateCcw],
  ["cw", "右旋", RotateCw],
  ["left", "左移", ArrowLeft],
  ["down", "軟降", ArrowDown],
  ["right", "右移", ArrowRight],
  ["drop", "硬降", ChevronsDown],
] as const;
export function TouchControls({
  input,
  disabled = false,
}: {
  input: InputController;
  disabled?: boolean;
}) {
  const release = (e: PointerEvent<HTMLButtonElement>) =>
    input.release(`pointer:${e.pointerId}`);
  return (
    <div className="touch-controls" aria-label="觸控遊戲控制">
      {controls.map(([control, label, Icon]) => (
        <button
          key={control}
          className={control === "drop" ? "drop-control" : ""}
          aria-label={label}
          disabled={disabled}
          onPointerDown={(e) => {
            e.preventDefault();
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* The OS may have already cancelled this pointer. */
            }
            input.press(control as Control, `pointer:${e.pointerId}`);
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              input.press(control, `button:${control}`);
            }
          }}
          onKeyUp={(e) => {
            if (e.key === "Enter") input.release(`button:${control}`);
          }}
          onBlur={() => input.release(`button:${control}`)}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
