import type {
  CameraAngles,
  CityViewCommand,
  Direction,
  ProjectionMode,
  Viewpoint,
} from "./types";

export function easeOutCubic(progress: number): number;
export function shortestRotation(from: number, to: number): number;
export function cameraForDirection(direction: Direction): CameraAngles;
export function viewTargetFor(command: CityViewCommand): {
  camera: CameraAngles;
  viewpoint: Viewpoint;
};
export function projectionModeFor(viewpoint: Viewpoint): ProjectionMode;
export function focusOffsetFor(
  viewpoint: Viewpoint,
  camera: CameraAngles,
  size: number,
  worldSize: number,
): number;
