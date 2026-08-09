import {
  Group,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { CameraController } from "./camera-controller";
import { DEFAULT_CAMERA } from "./constants.js";
import { CitySceneBuilder } from "./scene-builder";
import { viewTargetFor } from "./camera-math.js";
import type { CityViewCommand, Viewpoint } from "./types";

export class CityRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly world = new Group();
  private readonly cameraController: CameraController;
  private readonly sceneBuilder: CitySceneBuilder;
  private readonly resizeObserver: ResizeObserver;
  private grid: number[][] = [];
  private heightHues: readonly number[] = [];
  private size = 0;
  private worldSize = 0;
  private renderFrame: number | null = null;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly container: HTMLDivElement,
  ) {
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(this.world);
    this.cameraController = new CameraController(this.world, DEFAULT_CAMERA);
    this.sceneBuilder = new CitySceneBuilder(this.world, () => this.renderNow());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setData(
    grid: number[][],
    size: number,
    heightHues: readonly number[],
  ) {
    this.grid = grid;
    this.size = size;
    this.heightHues = heightHues;
    this.sceneBuilder.setData(grid, size, heightHues, this.worldSize);
    this.cameraController.resize(this.viewport());
    this.requestRender();
  }

  setView(command: CityViewCommand) {
    const { viewpoint } = viewTargetFor(command);
    this.sceneBuilder.setViewpoint(viewpoint);
    this.cameraController.setView(command, () => this.renderNow());
  }

  setViewpoint(viewpoint: Viewpoint) {
    this.sceneBuilder.setViewpoint(viewpoint);
    this.requestRender();
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    this.cameraController.dispose();
    this.sceneBuilder.dispose();
    this.renderer.dispose();
  }

  private resize() {
    if (this.disposed) return;
    const { height, isMobile, width } = this.viewport();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);

    const nextWorldSize = Math.min(
      isMobile ? 320 : 520,
      width * (isMobile ? 0.7 : 0.67),
      height * (isMobile ? 0.58 : 0.64),
    );
    const sizeChanged = Math.abs(nextWorldSize - this.worldSize) > 0.5;
    this.worldSize = nextWorldSize;
    this.cameraController.resize(this.viewport());
    if (sizeChanged && this.size > 0) {
      this.sceneBuilder.setData(
        this.grid,
        this.size,
        this.heightHues,
        this.worldSize,
      );
    }
    this.requestRender();
  }

  private viewport() {
    return {
      width: Math.max(1, Math.round(this.container.clientWidth)),
      height: Math.max(1, Math.round(this.container.clientHeight)),
      isMobile: window.matchMedia("(max-width: 760px)").matches,
      size: this.size,
      worldSize: this.worldSize,
    };
  }

  private requestRender() {
    if (this.renderFrame !== null || this.disposed) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.renderNow();
    });
  }

  private renderNow() {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.cameraController.activeCamera);
  }
}
