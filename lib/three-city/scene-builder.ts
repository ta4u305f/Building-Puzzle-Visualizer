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
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { getVisualTowerHeight } from "../tower-height.js";
import {
  RISE_TRANSITION_MS,
  TOWER_HIGHLIGHT_COLOR,
  TOWER_INSET_RATIO,
} from "./constants.js";
import { easeOutCubic } from "./camera-math.js";
import { cellCenter, writeTowerEdgePositions } from "./tower-geometry";
import type { Cell, Viewpoint } from "./types";

type Disposable = {
  dispose: () => void;
};

type HeightLayer = {
  labels: InstancedMesh;
  towers: InstancedMesh;
};

type EdgeLayer = {
  attribute: Float32BufferAttribute;
  geometry: BufferGeometry;
};

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

function sameGrid(left: readonly number[][], right: readonly number[][]) {
  if (left.length !== right.length) return false;
  return left.every(
    (row, rowIndex) =>
      row.length === right[rowIndex]?.length &&
      row.every((height, colIndex) => height === right[rowIndex][colIndex]),
  );
}

function sameViewpoint(left: Viewpoint, right: Viewpoint) {
  if (!left || !right) return left === right;
  return left.direction === right.direction && left.index === right.index;
}

export class CitySceneBuilder {
  private readonly resources: Disposable[] = [];
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private readonly matrix = new Matrix4();
  private readonly heightLayers = new Map<number, HeightLayer>();
  private grid: number[][] = [];
  private cells: Cell[] = [];
  private heightHues: readonly number[] = [];
  private size = 0;
  private worldSize = 0;
  private layoutKey = "";
  private viewpoint: Viewpoint = null;
  private borders: InstancedMesh | null = null;
  private pads: InstancedMesh | null = null;
  private roofDetails: InstancedMesh | null = null;
  private normalEdges: EdgeLayer | null = null;
  private highlightEdges: EdgeLayer | null = null;
  private towerLayer: Group | null = null;
  private riseAnimationFrame: number | null = null;
  private firstBuild = true;
  private disposed = false;

  constructor(
    private readonly world: Group,
    private readonly render: () => void,
  ) {}

  setData(
    grid: number[][],
    size: number,
    heightHues: readonly number[],
    worldSize: number,
  ) {
    if (this.disposed || size < 1 || worldSize <= 0) return;

    const nextLayoutKey = `${size}:${worldSize.toFixed(3)}:${heightHues.join(",")}`;
    const layoutChanged = nextLayoutKey !== this.layoutKey;
    const gridChanged = !sameGrid(this.grid, grid);

    this.size = size;
    this.worldSize = worldSize;
    this.heightHues = [...heightHues];
    this.grid = grid.map((row) => [...row]);

    if (layoutChanged) {
      this.layoutKey = nextLayoutKey;
      this.rebuild();
    } else if (gridChanged) {
      this.updateGrid();
    }
  }

  setViewpoint(viewpoint: Viewpoint) {
    if (sameViewpoint(this.viewpoint, viewpoint)) return false;
    this.viewpoint = viewpoint ? { ...viewpoint } : null;
    this.updateHighlights();
    return true;
  }

  dispose() {
    this.disposed = true;
    this.clear();
  }

  private rebuild() {
    this.clear();

    const groundSize = this.worldSize * 1.08;
    const cellSize = this.worldSize / this.size;
    const padSize = Math.max(2, cellSize - 6);
    const capacity = this.size * this.size;

    this.addGround(groundSize);
    this.addLots(cellSize, padSize, capacity);
    this.addTowerLayers(capacity);
    this.addRoofDetails(capacity);
    this.normalEdges = this.addEdgeLayer(capacity, "#0b1027", 0.5);
    this.highlightEdges = this.addEdgeLayer(
      capacity,
      TOWER_HIGHLIGHT_COLOR,
      0.95,
    );

    this.updateGrid();
    if (
      this.firstBuild &&
      this.cells.length > 0 &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      this.animateRise();
    }
    this.firstBuild = false;
  }

  private clear() {
    if (this.riseAnimationFrame !== null) {
      cancelAnimationFrame(this.riseAnimationFrame);
      this.riseAnimationFrame = null;
    }
    this.world.clear();
    this.heightLayers.clear();
    this.borders = null;
    this.pads = null;
    this.roofDetails = null;
    this.normalEdges = null;
    this.highlightEdges = null;
    this.towerLayer = null;
    while (this.resources.length > 0) this.resources.pop()?.dispose();
  }

  private track<T extends Disposable>(resource: T) {
    this.resources.push(resource);
    return resource;
  }

  private addGround(groundSize: number) {
    const shadowGeometry = this.track(
      new PlaneGeometry(groundSize + 28, groundSize + 28),
    );
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

    const frameGeometry = this.track(
      new BoxGeometry(groundSize + 22, groundSize + 22, 2),
    );
    const frameMaterial = this.track(
      new MeshBasicMaterial({ color: "#212837" }),
    );
    const frame = new Mesh(frameGeometry, frameMaterial);
    frame.position.z = -3;
    this.world.add(frame);

    const groundGeometry = this.track(new BoxGeometry(groundSize, groundSize, 2));
    const groundMaterial = this.track(
      new MeshBasicMaterial({ color: "#303a4e" }),
    );
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

  private addLots(cellSize: number, padSize: number, capacity: number) {
    const borderGeometry = this.track(new BoxGeometry(1, 1, 1));
    const borderMaterial = this.track(
      new MeshBasicMaterial({ color: "#ffffff", vertexColors: true }),
    );
    this.borders = new InstancedMesh(
      borderGeometry,
      borderMaterial,
      capacity,
    );
    this.borders.frustumCulled = false;

    const padGeometry = this.track(new BoxGeometry(1, 1, 1));
    const padMaterial = this.track(
      new MeshBasicMaterial({ color: "#ffffff", vertexColors: true }),
    );
    this.pads = new InstancedMesh(padGeometry, padMaterial, capacity);
    this.pads.frustumCulled = false;

    const dotGeometry = this.track(new PlaneGeometry(3, 3));
    const dotMaterial = this.track(
      new MeshBasicMaterial({ color: "#697286" }),
    );
    const dots = new InstancedMesh(dotGeometry, dotMaterial, capacity);
    dots.frustumCulled = false;

    let instanceIndex = 0;
    for (let row = 0; row < this.size; row += 1) {
      for (let col = 0; col < this.size; col += 1) {
        const { x, y } = cellCenter({ row, col }, this.size, this.worldSize);
        this.setMatrix(
          this.borders,
          instanceIndex,
          x,
          y,
          0.75,
          padSize,
          padSize,
          1.4,
        );
        this.setMatrix(
          this.pads,
          instanceIndex,
          x,
          y,
          1.55,
          Math.max(1, padSize - 2),
          Math.max(1, padSize - 2),
          0.6,
        );
        this.setMatrix(dots, instanceIndex, x, y, 2, 1, 1, 1);
        instanceIndex += 1;
      }
    }
    this.borders.instanceMatrix.needsUpdate = true;
    this.pads.instanceMatrix.needsUpdate = true;
    dots.instanceMatrix.needsUpdate = true;
    this.world.add(this.borders, this.pads, dots);
  }

  private addTowerLayers(capacity: number) {
    this.towerLayer = new Group();
    const towerGeometry = this.track(new BoxGeometry(1, 1, 1));
    const labelGeometry = this.track(new PlaneGeometry(1, 1));

    for (let height = 1; height <= this.size; height += 1) {
      const hue = this.hueFor(height);
      const materials = [
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 68, 43) })),
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 64, 31) })),
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 67, 35) })),
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 74, 53) })),
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 78, 70) })),
        this.track(new MeshBasicMaterial({ color: colorFromHsl(hue, 64, 31) })),
      ];
      const towers = new InstancedMesh(towerGeometry, materials, capacity);
      towers.count = 0;
      towers.frustumCulled = false;

      const labelTexture = this.track(createLabelTexture(height));
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
        capacity,
      );
      labels.count = 0;
      labels.frustumCulled = false;
      this.heightLayers.set(height, { labels, towers });
      this.towerLayer.add(towers, labels);
    }

    this.world.add(this.towerLayer);
  }

  private addRoofDetails(capacity: number) {
    if (!this.towerLayer) return;
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
    this.roofDetails = new InstancedMesh(geometry, material, capacity);
    this.roofDetails.count = 0;
    this.roofDetails.frustumCulled = false;
    this.towerLayer.add(this.roofDetails);
  }

  private addEdgeLayer(
    capacity: number,
    color: string,
    opacity: number,
  ): EdgeLayer {
    const attribute = new Float32BufferAttribute(
      new Float32Array(capacity * 12 * 2 * 3),
      3,
    );
    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute("position", attribute);
    geometry.setDrawRange(0, 0);
    const material = this.track(
      new LineBasicMaterial({ color, opacity, transparent: true }),
    );
    const edges = new LineSegments(geometry, material);
    edges.frustumCulled = false;
    this.towerLayer?.add(edges);
    return { attribute, geometry };
  }

  private updateGrid() {
    if (!this.borders || !this.pads || !this.roofDetails) return;
    const cellsByHeight = new Map<number, Cell[]>();
    this.cells = this.grid.flatMap((row, rowIndex) =>
      row.flatMap((height, colIndex) => {
        if (height <= 0) return [];
        const cell = { row: rowIndex, col: colIndex, height };
        const heightCells = cellsByHeight.get(height) ?? [];
        heightCells.push(cell);
        cellsByHeight.set(height, heightCells);
        return [cell];
      }),
    );

    this.updateLots();
    const cellSize = this.worldSize / this.size;
    const towerSize = cellSize * (1 - TOWER_INSET_RATIO * 2);

    for (let height = 1; height <= this.size; height += 1) {
      const layer = this.heightLayers.get(height);
      if (!layer) continue;
      const heightCells = cellsByHeight.get(height) ?? [];
      const visualHeight = getVisualTowerHeight(height, this.size);

      heightCells.forEach((cell, index) => {
        const { x, y } = cellCenter(cell, this.size, this.worldSize);
        this.setMatrix(
          layer.towers,
          index,
          x,
          y,
          visualHeight / 2 + 2,
          towerSize,
          towerSize,
          visualHeight,
        );
        this.setMatrix(
          layer.labels,
          index,
          x,
          y,
          visualHeight + 2.9,
          height > 9 ? 15 : 11,
          9,
          1,
        );
      });
      layer.towers.count = heightCells.length;
      layer.labels.count = heightCells.length;
      layer.towers.instanceMatrix.needsUpdate = true;
      layer.labels.instanceMatrix.needsUpdate = true;
    }

    this.cells.forEach((cell, index) => {
      const { x, y } = cellCenter(cell, this.size, this.worldSize);
      const visualHeight = getVisualTowerHeight(cell.height, this.size);
      this.setMatrix(
        this.roofDetails!,
        index,
        x,
        y,
        visualHeight + 2.5,
        towerSize * 0.8,
        towerSize * 0.8,
        1,
      );
    });
    this.roofDetails.count = this.cells.length;
    this.roofDetails.instanceMatrix.needsUpdate = true;
    this.updateEdges(this.normalEdges, this.cells, towerSize, 0.8);
    this.updateHighlights();
  }

  private updateLots() {
    if (!this.borders || !this.pads) return;
    const emptyPad = new Color("#242c3c");
    const emptyBorder = new Color("#687288");
    const lotBase = new Color("#303a4e");
    let instanceIndex = 0;

    for (let row = 0; row < this.size; row += 1) {
      for (let col = 0; col < this.size; col += 1) {
        const height = this.grid[row]?.[col] ?? 0;
        if (height > 0) {
          const hue = this.hueFor(height);
          const accent = colorFromHsl(hue, 72, 62);
          const fill = colorFromHsl(hue, 66, 45);
          this.borders.setColorAt(
            instanceIndex,
            overlayColor(emptyBorder, accent, 0.58),
          );
          this.pads.setColorAt(
            instanceIndex,
            overlayColor(lotBase, fill, 0.2),
          );
        } else {
          this.borders.setColorAt(instanceIndex, emptyBorder);
          this.pads.setColorAt(instanceIndex, emptyPad);
        }
        instanceIndex += 1;
      }
    }

    if (this.borders.instanceColor) {
      this.borders.instanceColor.needsUpdate = true;
    }
    if (this.pads.instanceColor) this.pads.instanceColor.needsUpdate = true;
  }

  private updateHighlights() {
    if (!this.highlightEdges) return;
    const highlighted = !this.viewpoint
      ? []
      : this.cells.filter((cell) =>
          this.viewpoint?.direction === "north" ||
          this.viewpoint?.direction === "south"
            ? cell.col === this.viewpoint.index
            : cell.row === this.viewpoint?.index,
        );
    const towerSize =
      (this.worldSize / this.size) * (1 - TOWER_INSET_RATIO * 2);
    this.updateEdges(this.highlightEdges, highlighted, towerSize, 2.2);
  }

  private updateEdges(
    layer: EdgeLayer | null,
    cells: readonly Cell[],
    towerSize: number,
    expansion: number,
  ) {
    if (!layer) return;
    const vertexCount = writeTowerEdgePositions(
      layer.attribute.array as Float32Array,
      cells,
      this.size,
      this.worldSize,
      towerSize,
      expansion,
    );
    layer.attribute.needsUpdate = true;
    layer.geometry.setDrawRange(0, vertexCount);
  }

  private animateRise() {
    if (!this.towerLayer) return;
    const layer = this.towerLayer;
    const startTime = performance.now();
    layer.position.z = -18;

    const update = (time: number) => {
      if (this.disposed) return;
      const elapsed = Math.min(1, (time - startTime) / RISE_TRANSITION_MS);
      layer.position.z = -18 * (1 - easeOutCubic(elapsed));
      this.render();
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
    return this.heightHues[
      Math.max(0, height - 1) % this.heightHues.length
    ];
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
}
