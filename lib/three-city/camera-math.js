import { DEFAULT_CAMERA } from "./constants.js";

const CLUE_ROTATIONS = {
  north: 180,
  east: 90,
  south: 0,
  west: -90,
};

export function easeOutCubic(progress) {
  return 1 - Math.pow(1 - progress, 3);
}

export function shortestRotation(from, to) {
  return from + ((((to - from) % 360) + 540) % 360) - 180;
}

export function cameraForDirection(direction) {
  return { tilt: 90, rotation: CLUE_ROTATIONS[direction] };
}

export function viewTargetFor(command) {
  if (command.mode === "clue") {
    return {
      camera: cameraForDirection(command.direction),
      viewpoint: { direction: command.direction, index: command.index },
    };
  }

  if (command.mode === "free") {
    return { camera: command.camera, viewpoint: null };
  }

  return { camera: DEFAULT_CAMERA, viewpoint: null };
}

export function projectionModeFor(viewpoint) {
  return viewpoint ? "orthographic" : "perspective";
}

export function focusOffsetFor(viewpoint, camera, size, worldSize) {
  if (!viewpoint || size < 1 || worldSize <= 0) return 0;

  const cellSize = worldSize / size;
  const localX = -worldSize / 2 + (viewpoint.index + 0.5) * cellSize;
  const localY = worldSize / 2 - (viewpoint.index + 0.5) * cellSize;
  const rotation = (camera.rotation * Math.PI) / 180;
  const lineCenterX =
    viewpoint.direction === "north" || viewpoint.direction === "south"
      ? Math.cos(rotation) * localX
      : Math.sin(rotation) * localY;

  return -lineCenterX;
}
