"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { getVisualTowerHeight } from "@/lib/tower-height.js";

type Direction = "north" | "east" | "south" | "west";
type Viewpoint = { direction: Direction; index: number } | null;

export type CameraAngles = {
  tilt: number;
  rotation: number;
};

export type ThreeCityViewHandle = {
  setCamera: (
    camera: CameraAngles,
    animate?: boolean,
    viewpoint?: Viewpoint,
  ) => void;
};

type ThreeCityViewProps = {
  camera: CameraAngles;
  grid: number[][];
  heightHues: readonly number[];
  size: number;
  viewpoint: Viewpoint;
};

type Disposable = {
  dispose: () => void;
};

type Cell = {
  col: number;
  height: number;
  row: number;
};

const CAMERA_PERSPECTIVE = 950;
const CAMERA_TRANSITION_MS = 450;
const RISE_TRANSITION_MS = 350;
const TOWER_INSET_RATIO = 0.07;

function easeOutCubic(progress: number) {
  return 1 - Math.pow(1 - progress, 3);
}

function shortestRotation(from: number, to: number) {
  return from + ((((to - from) % 360) + 540) % 360) - 180;
}

function colorFromHsl(hue: number, saturation: number, lightness: number) {
  return new Color().setStyle(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
}

function overlayColor(base: Color, overlay: Color, opacity: number) {
  return base.clone().lerp(overlay, opacity);
}

function createLabelTexture(height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 64;
  const context = canvas.getContext("2d");

  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#111522";
    context.font = "900 44px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(height), canvas.width / 2, canvas.height / 2 + 2);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

function createRoofDetailTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");

  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#ffffff45";
    context.lineWidth = 3;
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

class CityRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 1, 2200);
  private readonly orthographicCamera = new OrthographicCamera(
    -1,
    1,
    1,
    -1,
    1,
    2200,
  );
  private readonly world = new Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly resources: Disposable[] = [];
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private readonly matrix = new Matrix4();
  private cameraAnimationFrame: number | null = null;
  private renderFrame: number | null = null;
  private riseAnimationFrame: number | null = null;
  private currentCamera: CameraAngles;
  private currentFocusX = 0;
  private focusViewpoint: Viewpoint = null;
  private grid: number[][] = [];
  private heightHues: readonly number[] = [];
  private size = 0;
  private viewpoint: Viewpoint = null;
  private worldSize = 0;
  private firstBuild = true;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLDivElement,
    initialCamera: CameraAngles,
  ) {
    this.currentCamera = { ...initialCamera };
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(this.world);
    this.applyCameraView(this.currentCamera);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setData(
    grid: number[][],
    size: number,
    viewpoint: Viewpoint,
    heightHues: readonly number[],
  ) {
    this.grid = grid;
    this.size = size;
    this.viewpoint = viewpoint;
    this.heightHues = heightHues;
    this.rebuildWorld();
  }

  setCamera(
    target: CameraAngles,
    animate = true,
    viewpoint: Viewpoint = this.focusViewpoint,
  ) {
    if (this.cameraAnimationFrame !== null) {
      cancelAnimationFrame(this.cameraAnimationFrame);
      this.cameraAnimationFrame = null;
    }

    const targetFocusX = this.focusOffsetFor(viewpoint, target);
    this.focusViewpoint = viewpoint;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduceMotion) {
      this.currentCamera = { ...target };
      this.currentFocusX = targetFocusX;
      this.focusViewpoint = viewpoint;
      this.applyCameraView(this.currentCamera);
      this.requestRender();
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
      this.applyCameraView(this.currentCamera);
      this.renderNow();

      if (elapsed < 1) {
        this.cameraAnimationFrame = requestAnimationFrame(update);
      } else {
        this.currentCamera = { ...target };
        this.currentFocusX = targetFocusX;
        this.focusViewpoint = viewpoint;
        this.applyCameraView(this.currentCamera);
        this.cameraAnimationFrame = null;
      }
    };

    this.cameraAnimationFrame = requestAnimationFrame(update);
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    if (this.cameraAnimationFrame !== null) {
      cancelAnimationFrame(this.cameraAnimationFrame);
    }
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    if (this.riseAnimationFrame !== null) {
      cancelAnimationFrame(this.riseAnimationFrame);
    }
    this.clearWorld();
    this.renderer.dispose();
  }

  private track<T extends Disposable>(resource: T) {
    this.resources.push(resource);
    return resource;
  }

  private clearWorld() {
    if (this.riseAnimationFrame !== null) {
      cancelAnimationFrame(this.riseAnimationFrame);
      this.riseAnimationFrame = null;
    }
    this.world.clear();
    while (this.resources.length > 0) {
      this.resources.pop()?.dispose();
    }
  }

  private resize() {
    if (this.disposed) return;
    const width = Math.max(1, Math.round(this.container.clientWidth));
    const height = Math.max(1, Math.round(this.container.clientHeight));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);

    const isMobile = window.matchMedia("(max-width: 760px)").matches;
    const stageTop = isMobile ? 88 : 92;
    const stageBottom = isMobile ? 80 : 78;
    const stageHeight = Math.max(1, height - stageTop - stageBottom);
    const perspectiveOriginY =
      height / 2 - (stageTop + stageHeight * 0.42);
    const groundCenterY = (stageBottom - stageTop) / 2;

    this.camera.aspect = width / height;
    this.camera.fov =
      (2 * Math.atan(height / (2 * CAMERA_PERSPECTIVE)) * 180) / Math.PI;
    this.camera.position.set(0, perspectiveOriginY, CAMERA_PERSPECTIVE);
    this.camera.updateProjectionMatrix();
    this.camera.projectionMatrix.elements[9] =
      (-2 * perspectiveOriginY) / height;
    this.camera.projectionMatrixInverse
      .copy(this.camera.projectionMatrix)
      .invert();
    this.orthographicCamera.left = -width / 2;
    this.orthographicCamera.right = width / 2;
    this.orthographicCamera.top = height / 2;
    this.orthographicCamera.bottom = -height / 2;
    this.orthographicCamera.position.set(0, 0, CAMERA_PERSPECTIVE);
    this.orthographicCamera.updateProjectionMatrix();
    this.world.position.y = groundCenterY;

    const nextWorldSize = Math.min(
      isMobile ? 320 : 520,
      width * (isMobile ? 0.7 : 0.67),
      height * (isMobile ? 0.58 : 0.64),
    );
    const sizeChanged = Math.abs(nextWorldSize - this.worldSize) > 0.5;
    this.worldSize = nextWorldSize;
    this.currentFocusX = this.focusOffsetFor(
      this.focusViewpoint,
      this.currentCamera,
    );
    this.applyCameraView(this.currentCamera);
    if (sizeChanged && this.size > 0) this.rebuildWorld();
    this.requestRender();
  }

  private rebuildWorld() {
    if (this.disposed || this.size < 1 || this.worldSize <= 0) return;
    this.clearWorld();

    const groundSize = this.worldSize * 1.08;
    const cellSize = this.worldSize / this.size;
    const padSize = Math.max(2, cellSize - 6);
    const towerSize = cellSize * (1 - TOWER_INSET_RATIO * 2);

    this.addGround(groundSize);
    this.addLots(cellSize, padSize);

    const towerLayer = new Group();
    const cells = this.grid.flatMap((row, rowIndex) =>
      row.flatMap((height, colIndex) =>
        height > 0
          ? [{ row: rowIndex, col: colIndex, height }]
          : [],
      ),
    );
    this.addTowers(towerLayer, cells, cellSize, towerSize);
    this.world.add(towerLayer);

    if (
      this.firstBuild &&
      cells.length > 0 &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      this.animateRise(towerLayer);
    }
    this.firstBuild = false;
    this.requestRender();
  }

  private addGround(groundSize: number) {
    const shadowGeometry = this.track(new PlaneGeometry(groundSize + 28, groundSize + 28));
    const shadowMaterial = this.track(
      new MeshBasicMaterial({
        color: "#080b12",
        opacity: 0.42,
        transparent: true,
      }),
    );
    const shadow = new Mesh(shadowGeometry, shadowMaterial);
    shadow.position.z = -5;
    this.world.add(shadow);

    const frameGeometry = this.track(new BoxGeometry(groundSize + 22, groundSize + 22, 2));
    const frameMaterial = this.track(new MeshBasicMaterial({ color: "#212837" }));
    const frame = new Mesh(frameGeometry, frameMaterial);
    frame.position.z = -3;
    this.world.add(frame);

    const groundGeometry = this.track(new BoxGeometry(groundSize, groundSize, 2));
    const groundMaterial = this.track(new MeshBasicMaterial({ color: "#303a4e" }));
    const ground = new Mesh(groundGeometry, groundMaterial);
    ground.position.z = -1.5;
    this.world.add(ground);

    const linePositions: number[] = [];
    const half = groundSize / 2;
    for (let index = 0; index <= this.size; index += 1) {
      const offset = -half + (groundSize * index) / this.size;
      linePositions.push(-half, offset, 0, half, offset, 0);
      linePositions.push(offset, -half, 0, offset, half, 0);
    }
    const lineGeometry = this.track(new BufferGeometry());
    lineGeometry.setAttribute(
      "position",
      new Float32BufferAttribute(linePositions, 3),
    );
    const lineMaterial = this.track(
      new LineBasicMaterial({
        color: "#98a3b0",
        opacity: 0.14,
        transparent: true,
      }),
    );
    const lines = new LineSegments(lineGeometry, lineMaterial);
    lines.position.z = 0.05;
    this.world.add(lines);
  }

  private addLots(cellSize: number, padSize: number) {
    const count = this.size * this.size;
    const borderGeometry = this.track(new BoxGeometry(1, 1, 1));
    const borderMaterial = this.track(
      new MeshBasicMaterial({ color: "#ffffff", vertexColors: true }),
    );
    const borders = new InstancedMesh(borderGeometry, borderMaterial, count);

    const padGeometry = this.track(new BoxGeometry(1, 1, 1));
    const padMaterial = this.track(
      new MeshBasicMaterial({ color: "#ffffff", vertexColors: true }),
    );
    const pads = new InstancedMesh(padGeometry, padMaterial, count);

    const dotGeometry = this.track(new PlaneGeometry(3, 3));
    const dotMaterial = this.track(new MeshBasicMaterial({ color: "#697286" }));
    const dots = new InstancedMesh(dotGeometry, dotMaterial, count);

    const emptyPad = new Color("#242c3c");
    const emptyBorder = new Color("#687288");
    const lotBase = new Color("#303a4e");
    let instanceIndex = 0;

    for (let row = 0; row < this.size; row += 1) {
      for (let col = 0; col < this.size; col += 1) {
        const height = this.grid[row]?.[col] ?? 0;
        const hue = this.hueFor(height);
        const x = -this.worldSize / 2 + (col + 0.5) * cellSize;
        const y = this.worldSize / 2 - (row + 0.5) * cellSize;

        this.setMatrix(borders, instanceIndex, x, y, 0.75, padSize, padSize, 1.4);
        this.setMatrix(
          pads,
          instanceIndex,
          x,
          y,
          1.55,
          Math.max(1, padSize - 2),
          Math.max(1, padSize - 2),
          0.6,
        );
        this.setMatrix(dots, instanceIndex, x, y, 2, 1, 1, 1);

        if (height > 0) {
          const accent = colorFromHsl(hue, 72, 62);
          const fill = colorFromHsl(hue, 66, 45);
          borders.setColorAt(
            instanceIndex,
            overlayColor(emptyBorder, accent, 0.58),
          );
          pads.setColorAt(instanceIndex, overlayColor(lotBase, fill, 0.2));
        } else {
          borders.setColorAt(instanceIndex, emptyBorder);
          pads.setColorAt(instanceIndex, emptyPad);
        }
        instanceIndex += 1;
      }
    }

    borders.instanceMatrix.needsUpdate = true;
    pads.instanceMatrix.needsUpdate = true;
    dots.instanceMatrix.needsUpdate = true;
    if (borders.instanceColor) borders.instanceColor.needsUpdate = true;
    if (pads.instanceColor) pads.instanceColor.needsUpdate = true;
    this.world.add(borders, pads, dots);
  }

  private addTowers(
    layer: Group,
    cells: Cell[],
    cellSize: number,
    towerSize: number,
  ) {
    const cellsByHeight = new Map<number, Cell[]>();
    for (const cell of cells) {
      const group = cellsByHeight.get(cell.height) ?? [];
      group.push(cell);
      cellsByHeight.set(cell.height, group);
    }

    for (const [height, heightCells] of cellsByHeight) {
      const visualHeight = getVisualTowerHeight(height, this.size);
      const hue = this.hueFor(height);
      const geometry = this.track(new BoxGeometry(1, 1, 1));
      const materials = [
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 68, 43) })),
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 64, 31) })),
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 67, 35) })),
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 74, 53) })),
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 78, 70) })),
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 64, 31) })),
      ];
      const towers = new InstancedMesh(geometry, materials, heightCells.length);

      const labelTexture = this.track(createLabelTexture(height));
      const labelGeometry = this.track(new PlaneGeometry(1, 1));
      const labelMaterial = this.track(
        new MeshBasicMaterial({
          depthWrite: false,
          map: labelTexture,
          side: DoubleSide,
          transparent: true,
        }),
      );
      const labels = new InstancedMesh(
        labelGeometry,
        labelMaterial,
        heightCells.length,
      );

      heightCells.forEach((cell, index) => {
        const x = -this.worldSize / 2 + (cell.col + 0.5) * cellSize;
        const y = this.worldSize / 2 - (cell.row + 0.5) * cellSize;
        this.setMatrix(
          towers,
          index,
          x,
          y,
          visualHeight / 2 + 2,
          towerSize,
          towerSize,
          visualHeight,
        );
        this.setMatrix(
          labels,
          index,
          x,
          y,
          visualHeight + 2.9,
          height > 9 ? 15 : 11,
          9,
          1,
        );
      });
      towers.instanceMatrix.needsUpdate = true;
      labels.instanceMatrix.needsUpdate = true;
      layer.add(towers, labels);
    }

    if (cells.length > 0) {
      this.addTowerEdges(
        layer,
        cells,
        cellSize,
        towerSize,
        0.8,
        "#0b1027",
        0.5,
      );
      this.addRoofDetails(layer, cells, cellSize, towerSize);
      this.addHighlights(layer, cells, cellSize, towerSize);
    }
  }

  private addTowerEdges(
    layer: Group,
    cells: Cell[],
    cellSize: number,
    towerSize: number,
    expansion: number,
    color: string,
    opacity: number,
  ) {
    const positions: number[] = [];
    const edgePairs = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ] as const;

    for (const cell of cells) {
      const x = -this.worldSize / 2 + (cell.col + 0.5) * cellSize;
      const y = this.worldSize / 2 - (cell.row + 0.5) * cellSize;
      const visualHeight = getVisualTowerHeight(cell.height, this.size);
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

      for (const [start, end] of edgePairs) {
        positions.push(...vertices[start], ...vertices[end]);
      }
    }

    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(positions, 3),
    );
    const material = this.track(
      new LineBasicMaterial({
        color,
        opacity,
        transparent: true,
      }),
    );
    layer.add(new LineSegments(geometry, material));
  }

  private addRoofDetails(
    layer: Group,
    cells: Cell[],
    cellSize: number,
    towerSize: number,
  ) {
    const texture = this.track(createRoofDetailTexture());
    const geometry = this.track(new PlaneGeometry(1, 1));
    const material = this.track(
      new MeshBasicMaterial({
        depthWrite: false,
        map: texture,
        side: DoubleSide,
        transparent: true,
      }),
    );
    const details = new InstancedMesh(geometry, material, cells.length);
    cells.forEach((cell, index) => {
      const x = -this.worldSize / 2 + (cell.col + 0.5) * cellSize;
      const y = this.worldSize / 2 - (cell.row + 0.5) * cellSize;
      const visualHeight = getVisualTowerHeight(cell.height, this.size);
      this.setMatrix(
        details,
        index,
        x,
        y,
        visualHeight + 2.5,
        towerSize * 0.8,
        towerSize * 0.8,
        1,
      );
    });
    details.instanceMatrix.needsUpdate = true;
    layer.add(details);
  }

  private addHighlights(
    layer: Group,
    cells: Cell[],
    cellSize: number,
    towerSize: number,
  ) {
    if (!this.viewpoint) return;
    const highlighted = cells.filter((cell) =>
      this.viewpoint?.direction === "north" ||
      this.viewpoint?.direction === "south"
        ? cell.col === this.viewpoint.index
        : cell.row === this.viewpoint?.index,
    );
    if (highlighted.length === 0) return;

    this.addTowerEdges(
      layer,
      highlighted,
      cellSize,
      towerSize,
      2.2,
      "#f4f7ff",
      0.95,
    );
  }

  private animateRise(layer: Group) {
    const startTime = performance.now();
    layer.position.z = -18;
    const update = (time: number) => {
      if (this.disposed) return;
      const elapsed = Math.min(1, (time - startTime) / RISE_TRANSITION_MS);
      layer.position.z = -18 * (1 - easeOutCubic(elapsed));
      this.renderNow();
      if (elapsed < 1) {
        this.riseAnimationFrame = requestAnimationFrame(update);
      } else {
        layer.position.z = 0;
        this.riseAnimationFrame = null;
      }
    };
    this.riseAnimationFrame = requestAnimationFrame(update);
  }

  private hueFor(height: number) {
    if (this.heightHues.length === 0) return 235;
    return this.heightHues[Math.max(0, height - 1) % this.heightHues.length];
  }

  private setMatrix(
    mesh: InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
  ) {
    this.position.set(x, y, z);
    this.scale.set(width, height, depth);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    mesh.setMatrixAt(index, this.matrix);
  }

  private focusOffsetFor(viewpoint: Viewpoint, camera: CameraAngles) {
    if (!viewpoint || this.size < 1 || this.worldSize <= 0) return 0;

    const cellSize = this.worldSize / this.size;
    const localX =
      -this.worldSize / 2 + (viewpoint.index + 0.5) * cellSize;
    const localY =
      this.worldSize / 2 - (viewpoint.index + 0.5) * cellSize;
    const rotation = (camera.rotation * Math.PI) / 180;
    const lineCenterX =
      viewpoint.direction === "north" || viewpoint.direction === "south"
        ? Math.cos(rotation) * localX
        : Math.sin(rotation) * localY;

    return -lineCenterX;
  }

  private applyCameraView(camera: CameraAngles) {
    this.world.rotation.set(
      (-camera.tilt * Math.PI) / 180,
      0,
      (-camera.rotation * Math.PI) / 180,
      "XYZ",
    );
    this.world.position.x = this.currentFocusX;
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
    this.renderer.render(
      this.scene,
      this.focusViewpoint ? this.orthographicCamera : this.camera,
    );
  }
}

const ThreeCityView = forwardRef<ThreeCityViewHandle, ThreeCityViewProps>(
  function ThreeCityView({ camera, grid, heightHues, size, viewpoint }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fallbackRef = useRef<HTMLParagraphElement>(null);
    const rendererRef = useRef<CityRenderer | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        setCamera(nextCamera, animate = true, nextViewpoint) {
          rendererRef.current?.setCamera(
            nextCamera,
            animate,
            nextViewpoint,
          );
        },
      }),
      [],
    );

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      try {
        rendererRef.current = new CityRenderer(canvas, container, camera);
        if (fallbackRef.current) fallbackRef.current.hidden = true;
      } catch {
        if (fallbackRef.current) fallbackRef.current.hidden = false;
      }

      return () => {
        rendererRef.current?.dispose();
        rendererRef.current = null;
      };
    }, [camera]);

    useEffect(() => {
      rendererRef.current?.setData(grid, size, viewpoint, heightHues);
    }, [grid, heightHues, size, viewpoint]);

    return (
      <div className="three-city-layer" ref={containerRef}>
        <canvas className="three-city-canvas" ref={canvasRef} aria-hidden="true" />
        <p className="three-city-fallback" ref={fallbackRef} hidden>
          このブラウザでは3D表示を利用できません。
        </p>
        <div className="three-city-a11y">
          {grid.flatMap((row, rowIndex) =>
            row.map((height, colIndex) =>
              height > 0 ? (
                <span
                  role="img"
                  aria-label={`高さ ${height} の直方体`}
                  key={`tower-description-${rowIndex}-${colIndex}`}
                />
              ) : null,
            ),
          )}
        </div>
      </div>
    );
  },
);

export default ThreeCityView;
