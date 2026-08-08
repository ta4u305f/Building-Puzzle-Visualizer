export type PuzzleTextDirection = "north" | "east" | "south" | "west";

export type PuzzleTextData = {
  solution: number[][];
  clues: Record<PuzzleTextDirection, number[]>;
};

export type ParsedPuzzleText = {
  size: number;
  puzzle: PuzzleTextData;
  grid: number[][];
  hasBuildings: boolean;
};

export const MIN_PUZZLE_SIZE: 1;
export const MAX_PUZZLE_SIZE: 11;

export function parsePuzzleText(source: string): ParsedPuzzleText;
export function formatPuzzleText(
  puzzle: PuzzleTextData,
  grid: number[][],
): string;
