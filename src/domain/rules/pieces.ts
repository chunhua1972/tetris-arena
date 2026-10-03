import { PIECES, type PieceType, type Rotation } from "../types";
export type Point = readonly [number, number];
const origins: Record<PieceType, readonly Point[]> = {
  I: [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
  ],
  O: [
    [1, 0],
    [2, 0],
    [1, 1],
    [2, 1],
  ],
  T: [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  S: [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
  Z: [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
  J: [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  L: [
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
};
export const SHAPES = Object.freeze(
  Object.fromEntries(
    PIECES.map((type) => {
      const rotations: (readonly Point[])[] = [Object.freeze(origins[type])];
      for (let r = 1; r < 4; r++) {
        const center = type === "I" ? 1.5 : 1;
        rotations.push(
          Object.freeze(
            type === "O"
              ? origins.O
              : rotations[r - 1].map(
                  ([x, y]) =>
                    [center - (y - center), center + (x - center)] as Point,
                ),
          ),
        );
      }
      return [type, Object.freeze(rotations)];
    }),
  ) as Record<PieceType, readonly (readonly Point[])[]>,
);
// SRS offsets converted from the conventional y-up table to board y-down.
export const JLSTZ_KICKS: Readonly<Record<string, readonly Point[]>> =
  Object.freeze({
    "0>1": [
      [0, 0],
      [-1, 0],
      [-1, -1],
      [0, 2],
      [-1, 2],
    ],
    "1>0": [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, -2],
      [1, -2],
    ],
    "1>2": [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, -2],
      [1, -2],
    ],
    "2>1": [
      [0, 0],
      [-1, 0],
      [-1, -1],
      [0, 2],
      [-1, 2],
    ],
    "2>3": [
      [0, 0],
      [1, 0],
      [1, -1],
      [0, 2],
      [1, 2],
    ],
    "3>2": [
      [0, 0],
      [-1, 0],
      [-1, 1],
      [0, -2],
      [-1, -2],
    ],
    "3>0": [
      [0, 0],
      [-1, 0],
      [-1, 1],
      [0, -2],
      [-1, -2],
    ],
    "0>3": [
      [0, 0],
      [1, 0],
      [1, -1],
      [0, 2],
      [1, 2],
    ],
  });
export const I_KICKS: Readonly<Record<string, readonly Point[]>> =
  Object.freeze({
    "0>1": [
      [0, 0],
      [-2, 0],
      [1, 0],
      [-2, 1],
      [1, -2],
    ],
    "1>0": [
      [0, 0],
      [2, 0],
      [-1, 0],
      [2, -1],
      [-1, 2],
    ],
    "1>2": [
      [0, 0],
      [-1, 0],
      [2, 0],
      [-1, -2],
      [2, 1],
    ],
    "2>1": [
      [0, 0],
      [1, 0],
      [-2, 0],
      [1, 2],
      [-2, -1],
    ],
    "2>3": [
      [0, 0],
      [2, 0],
      [-1, 0],
      [2, -1],
      [-1, 2],
    ],
    "3>2": [
      [0, 0],
      [-2, 0],
      [1, 0],
      [-2, 1],
      [1, -2],
    ],
    "3>0": [
      [0, 0],
      [1, 0],
      [-2, 0],
      [1, 2],
      [-2, -1],
    ],
    "0>3": [
      [0, 0],
      [-1, 0],
      [2, 0],
      [-1, -2],
      [2, 1],
    ],
  });
export const cells = (type: PieceType, rotation: Rotation) =>
  SHAPES[type][rotation];
export const pieceId = (type: PieceType) => PIECES.indexOf(type) + 1;
export const COLORS = [
  "#000000",
  "#62d9ee",
  "#f4d16b",
  "#b897f9",
  "#b5e774",
  "#f18195",
  "#7c9cf5",
  "#f3a766",
  "#657087",
];
