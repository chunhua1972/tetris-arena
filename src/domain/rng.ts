import { PIECES, type PieceType } from "./types";
export function seedHash(seed: string): number {
  let n = 2166136261;
  for (const char of seed) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return n >>> 0 || 0x9e3779b9;
}
export function nextRandom(state: number): [number, number] {
  let n = state || 0x9e3779b9;
  n ^= n << 13;
  n ^= n >>> 17;
  n ^= n << 5;
  return [n >>> 0, n >>> 0];
}
export function shuffledBag(state: number): {
  state: number;
  bag: PieceType[];
} {
  const bag: PieceType[] = [...PIECES];
  for (let i = bag.length - 1; i > 0; i--) {
    let n: number;
    [state, n] = nextRandom(state);
    const j = n % (i + 1);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return { state, bag };
}
