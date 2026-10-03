import { cells, COLORS, pieceId } from "../domain/rules/pieces";
import type { PieceType } from "../domain/types";
export function PiecePreview({ type }: { type: PieceType | null }) {
  if (!type)
    return (
      <div className="empty-piece" aria-label="尚未保留方塊">
        —
      </div>
    );
  const points = cells(type, 0),
    minX = Math.min(...points.map((p) => p[0])),
    maxX = Math.max(...points.map((p) => p[0])),
    minY = Math.min(...points.map((p) => p[1])),
    maxY = Math.max(...points.map((p) => p[1]));
  return (
    <svg
      className="piece-preview"
      viewBox={`0 0 ${(maxX - minX + 1) * 16} ${(maxY - minY + 1) * 16}`}
      role="img"
      aria-label={`${type} 方塊`}
    >
      {points.map(([x, y]) => (
        <g key={`${x},${y}`}>
          <rect
            x={(x - minX) * 16 + 1}
            y={(y - minY) * 16 + 1}
            width="14"
            height="14"
            rx="1.5"
            fill={COLORS[pieceId(type)]}
          />
          <path
            d={`M${(x - minX) * 16 + 3} ${(y - minY) * 16 + 3}h10`}
            stroke="#ffffff66"
          />
        </g>
      ))}
    </svg>
  );
}
