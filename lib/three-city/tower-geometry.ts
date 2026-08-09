import { getVisualTowerHeight } from "../tower-height.js";
import type { Cell } from "./types";

export const CUBOID_EDGE_PAIRS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const;

export function cellCenter(
  cell: Pick<Cell, "col" | "row">,
  size: number,
  worldSize: number,
) {
  const cellSize = worldSize / size;
  return {
    x: -worldSize / 2 + (cell.col + 0.5) * cellSize,
    y: worldSize / 2 - (cell.row + 0.5) * cellSize,
  };
}

export function writeTowerEdgePositions(
  target: Float32Array,
  cells: readonly Cell[],
  size: number,
  worldSize: number,
  towerSize: number,
  expansion: number,
) {
  let offset = 0;

  for (const cell of cells) {
    const { x, y } = cellCenter(cell, size, worldSize);
    const visualHeight = getVisualTowerHeight(cell.height, size);
    const half = (towerSize + expansion) / 2;
    const bottom = 2 - expansion / 2;
    const top = visualHeight + 2 + expansion / 2;
    const vertices = [
      [x - half, y - half, bottom],
      [x + half, y - half, bottom],
      [x + half, y + half, bottom],
      [x - half, y + half, bottom],
      [x - half, y - half, top],
      [x + half, y - half, top],
      [x + half, y + half, top],
      [x - half, y + half, top],
    ] as const;

    for (const [start, end] of CUBOID_EDGE_PAIRS) {
      for (const coordinate of vertices[start]) target[offset++] = coordinate;
      for (const coordinate of vertices[end]) target[offset++] = coordinate;
    }
  }

  return offset / 3;
}
