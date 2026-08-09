import {
  type Camera,
  Group,
  OrthographicCamera,
  PerspectiveCamera,
} from "three";
import {
  CAMERA_PERSPECTIVE,
  CAMERA_TRANSITION_MS,
} from "./constants.js";
import {
  easeOutCubic,
  focusOffsetFor,
  projectionModeFor,
  shortestRotation,
  viewTargetFor,
} from "./camera-math.js";
import type {
  CameraAngles,
  CityViewCommand,
  Viewpoint,
} from "./types";

type Viewport = {
  height: number;
  isMobile: boolean;
  size: number;
  width: number;
  worldSize: number;
};

export class CameraController {
  private readonly perspectiveCamera = new PerspectiveCamera(45, 1, 1, 2200);
  private readonly orthographicCamera = new OrthographicCamera(
    -1,
    1,
    1,
    -1,
    1,
    2200,
  );
  private animationFrame: number | null = null;
  private currentCamera: CameraAngles;
  private currentFocusX = 0;
  private focusViewpoint: Viewpoint = null;
  private size = 0;
  private worldSize = 0;
  private disposed = false;

  constructor(
    private readonly world: Group,
    initialCamera: CameraAngles,
  ) {
    this.currentCamera = { ...initialCamera };
    this.applyView();
  }

  get activeCamera(): Camera {
    return projectionModeFor(this.focusViewpoint) === "orthographic"
      ? this.orthographicCamera
      : this.perspectiveCamera;
  }

  resize({ height, isMobile, size, width, worldSize }: Viewport) {
    const stageTop = isMobile ? 88 : 92;
    const stageBottom = isMobile ? 80 : 78;
    const stageHeight = Math.max(1, height - stageTop - stageBottom);
    const perspectiveOriginY =
      height / 2 - (stageTop + stageHeight * 0.42);
    const groundCenterY = (stageBottom - stageTop) / 2;

    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.fov =
      (2 * Math.atan(height / (2 * CAMERA_PERSPECTIVE)) * 180) / Math.PI;
    this.perspectiveCamera.position.set(
      0,
      perspectiveOriginY,
      CAMERA_PERSPECTIVE,
    );
    this.perspectiveCamera.updateProjectionMatrix();
    this.perspectiveCamera.projectionMatrix.elements[9] =
      (-2 * perspectiveOriginY) / height;
    this.perspectiveCamera.projectionMatrixInverse
      .copy(this.perspectiveCamera.projectionMatrix)
      .invert();

    this.orthographicCamera.left = -width / 2;
    this.orthographicCamera.right = width / 2;
    this.orthographicCamera.top = height / 2;
    this.orthographicCamera.bottom = -height / 2;
    this.orthographicCamera.position.set(0, 0, CAMERA_PERSPECTIVE);
    this.orthographicCamera.updateProjectionMatrix();

    this.size = size;
    this.worldSize = worldSize;
    this.currentFocusX = focusOffsetFor(
      this.focusViewpoint,
      this.currentCamera,
      size,
      worldSize,
    );
    this.world.position.y = groundCenterY;
    this.applyView();
  }

  setView(command: CityViewCommand, render: () => void) {
    this.cancelAnimation();
    const { camera: target, viewpoint } = viewTargetFor(command);
    const targetFocusX = focusOffsetFor(
      viewpoint,
      target,
      this.size,
      this.worldSize,
    );

    // Switch projection at the start so the whole clue transition is depth-neutral.
    this.focusViewpoint = viewpoint;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (command.animate === false || reduceMotion) {
      this.currentCamera = { ...target };
      this.currentFocusX = targetFocusX;
      this.applyView();
      render();
      return;
    }

    const startCamera = { ...this.currentCamera };
    const startFocusX = this.currentFocusX;
    const endCamera = {
      tilt: target.tilt,
      rotation: shortestRotation(startCamera.rotation, target.rotation),
    };
    const startTime = performance.now();

    const update = (time: number) => {
      if (this.disposed) return;
      const elapsed = Math.min(1, (time - startTime) / CAMERA_TRANSITION_MS);
      const progress = easeOutCubic(elapsed);
      this.currentCamera = {
        tilt: startCamera.tilt + (endCamera.tilt - startCamera.tilt) * progress,
        rotation:
          startCamera.rotation +
          (endCamera.rotation - startCamera.rotation) * progress,
      };
      this.currentFocusX =
        startFocusX + (targetFocusX - startFocusX) * progress;
      this.applyView();
      render();

      if (elapsed < 1) {
        this.animationFrame = requestAnimationFrame(update);
      } else {
        this.currentCamera = { ...target };
        this.currentFocusX = targetFocusX;
        this.applyView();
        this.animationFrame = null;
        render();
      }
    };

    this.animationFrame = requestAnimationFrame(update);
  }

  dispose() {
    this.disposed = true;
    this.cancelAnimation();
  }

  private cancelAnimation() {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  private applyView() {
    this.world.rotation.set(
      (-this.currentCamera.tilt * Math.PI) / 180,
      0,
      (-this.currentCamera.rotation * Math.PI) / 180,
      "XYZ",
    );
    this.world.position.x = this.currentFocusX;
  }
}
