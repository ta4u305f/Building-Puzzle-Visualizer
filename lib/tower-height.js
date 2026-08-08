export const MIN_VISUAL_TOWER_HEIGHT = 20;
export const MAX_VISUAL_TOWER_HEIGHT = 300;
export const SINGLE_TOWER_HEIGHT = 140;
export const MAX_GROWTH_RATE = 2;

export function getVisualTowerHeight(height, size) {
  if (height <= 0) return 0;
  if (size <= 1) return SINGLE_TOWER_HEIGHT;

  const growthToFit = Math.pow(
    MAX_VISUAL_TOWER_HEIGHT / MIN_VISUAL_TOWER_HEIGHT,
    1 / (size - 1),
  );
  const growthRate = Math.min(MAX_GROWTH_RATE, growthToFit);
  const boundedHeight = Math.min(height, size);

  return Math.round(
    MIN_VISUAL_TOWER_HEIGHT * Math.pow(growthRate, boundedHeight - 1),
  );
}
