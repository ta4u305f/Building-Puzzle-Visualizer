import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cameraForDirection,
  focusOffsetFor,
  projectionModeFor,
  shortestRotation,
  viewTargetFor,
} from "../lib/three-city/camera-math.js";
import {
  CUBOID_EDGE_PAIRS,
  writeTowerEdgePositions,
} from "../lib/three-city/tower-geometry.ts";
import {
  formatPuzzleText,
  parsePuzzleText,
} from "../lib/puzzle-text.js";
import {
  MAX_VISUAL_TOWER_HEIGHT,
  MIN_VISUAL_TOWER_HEIGHT,
  getVisualTowerHeight,
} from "../lib/tower-height.js";

const root = new URL("../", import.meta.url);
const example = `3 2 2 1 2 3 1 2 4 2 1 2 1 2 4 2

1 2 3 4
3 4 1 2
4 3 2 1
2 1 4 3`;

test("parses and formats the requirements example in ROW/COL order", () => {
  const parsed = parsePuzzleText(example);

  assert.equal(parsed.size, 4);
  assert.deepEqual(parsed.puzzle.clues.north, [3, 2, 2, 1]);
  assert.deepEqual(parsed.puzzle.clues.south, [2, 3, 1, 2]);
  assert.deepEqual(parsed.puzzle.clues.west, [4, 2, 1, 2]);
  assert.deepEqual(parsed.puzzle.clues.east, [1, 2, 4, 2]);
  assert.deepEqual(parsed.grid[2], [4, 3, 2, 1]);
  assert.equal(parsed.hasBuildings, true);
  assert.equal(formatPuzzleText(parsed.puzzle, parsed.grid), example);
});

test("accepts clues without a building answer", () => {
  const clueOnlyText = example.split("\n\n")[0];
  const parsed = parsePuzzleText(clueOnlyText);

  assert.equal(parsed.size, 4);
  assert.equal(parsed.hasBuildings, false);
  assert.deepEqual(parsed.grid, Array.from({ length: 4 }, () => [0, 0, 0, 0]));
  assert.equal(formatPuzzleText(parsed.puzzle, parsed.grid), clueOnlyText);
});

test("returns specific messages for malformed puzzle text", () => {
  assert.throws(
    () => parsePuzzleText(example.replace("\n\n", "\n")),
    /空行を1行/,
  );
  assert.throws(
    () => parsePuzzleText(example.split("\n").slice(0, -1).join("\n")),
    /4 行必要/,
  );
  assert.throws(
    () => parsePuzzleText(example.replace("1 2 3 4", "1 2 X 4")),
    /整数ではない値「X」/,
  );
});

test("accepts the full 1 to 11 size range", () => {
  const sizeOne = parsePuzzleText("1 1 1 1\n\n1");
  assert.equal(sizeOne.size, 1);

  const maxClues = Array.from({ length: 11 * 4 }, () => 1).join(" ");
  const maxRow = Array.from({ length: 11 }, () => 1).join(" ");
  const maxGrid = Array.from({ length: 11 }, () => maxRow).join("\n");
  const sizeEleven = parsePuzzleText(`${maxClues}\n\n${maxGrid}`);
  assert.equal(sizeEleven.size, 11);
  assert.equal(sizeEleven.grid.length, 11);
  assert.equal(sizeEleven.grid[0].length, 11);
});

test("uses a perceptual tower-height scale with visible differences", () => {
  assert.deepEqual(
    [1, 2, 3, 4].map((height) => getVisualTowerHeight(height, 4)),
    [20, 40, 80, 160],
  );

  const elevenLevels = Array.from(
    { length: 11 },
    (_, index) => getVisualTowerHeight(index + 1, 11),
  );
  assert.equal(elevenLevels[0], MIN_VISUAL_TOWER_HEIGHT);
  assert.equal(elevenLevels[10], MAX_VISUAL_TOWER_HEIGHT);
  assert.ok(
    elevenLevels.every(
      (height, index) => index === 0 || height > elevenLevels[index - 1],
    ),
  );
});

test("maps every clue direction to a horizontal orthographic view", () => {
  assert.deepEqual(cameraForDirection("north"), { tilt: 90, rotation: 180 });
  assert.deepEqual(cameraForDirection("east"), { tilt: 90, rotation: 90 });
  assert.deepEqual(cameraForDirection("south"), { tilt: 90, rotation: 0 });
  assert.deepEqual(cameraForDirection("west"), { tilt: 90, rotation: -90 });
  assert.equal(
    projectionModeFor({ direction: "south", index: 0 }),
    "orthographic",
  );
  assert.equal(projectionModeFor(null), "perspective");
  assert.equal(shortestRotation(350, 10), 370);

  assert.deepEqual(
    viewTargetFor({
      mode: "clue",
      direction: "south",
      index: 0,
      animate: true,
    }),
    {
      camera: { tilt: 90, rotation: 0 },
      viewpoint: { direction: "south", index: 0 },
    },
  );
});

test("centers first, middle, and last clue lines without changing depth scale", () => {
  const worldSize = 520;
  const size = 11;
  const halfLineRange = worldSize / 2 - worldSize / size / 2;

  assert.ok(
    Math.abs(
      focusOffsetFor(
        { direction: "south", index: 0 },
        cameraForDirection("south"),
        size,
        worldSize,
      ) - halfLineRange,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      focusOffsetFor(
        { direction: "south", index: 5 },
        cameraForDirection("south"),
        size,
        worldSize,
      ),
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      focusOffsetFor(
        { direction: "south", index: 10 },
        cameraForDirection("south"),
        size,
        worldSize,
      ) + halfLineRange,
    ) < 1e-9,
  );
});

test("keeps the supplied COL BOTTOM 1 far height 11 visible above near height 10", () => {
  const grid = [
    [11, 6, 7, 10, 5, 2, 4, 8, 3, 9, 1],
    [7, 2, 8, 6, 9, 3, 5, 10, 4, 1, 11],
    [5, 7, 9, 11, 2, 8, 6, 1, 10, 3, 4],
    [1, 10, 11, 8, 4, 6, 3, 7, 2, 5, 9],
    [3, 1, 4, 9, 10, 11, 8, 5, 7, 6, 2],
    [4, 11, 5, 1, 6, 7, 10, 9, 8, 2, 3],
    [8, 3, 10, 2, 1, 4, 9, 6, 5, 11, 7],
    [6, 5, 2, 4, 7, 9, 11, 3, 1, 8, 10],
    [9, 8, 1, 7, 3, 10, 2, 11, 6, 4, 5],
    [2, 9, 3, 5, 8, 1, 7, 4, 11, 10, 6],
    [10, 4, 6, 3, 11, 5, 1, 2, 9, 7, 8],
  ];
  const colBottomOne = grid.map((row) => row[0]).reverse();

  assert.deepEqual(colBottomOne, [10, 2, 9, 6, 8, 4, 3, 1, 5, 7, 11]);
  assert.equal(
    projectionModeFor({ direction: "south", index: 0 }),
    "orthographic",
  );
  assert.ok(getVisualTowerHeight(11, 11) > getVisualTowerHeight(10, 11));
});

test("creates only the 12 cuboid edges and no face diagonals", () => {
  const positions = new Float32Array(12 * 2 * 3);
  const vertexCount = writeTowerEdgePositions(
    positions,
    [{ row: 0, col: 0, height: 4 }],
    4,
    320,
    68.8,
    0.8,
  );

  assert.equal(CUBOID_EDGE_PAIRS.length, 12);
  assert.equal(vertexCount, 24);
  for (let edge = 0; edge < 12; edge += 1) {
    const start = positions.slice(edge * 6, edge * 6 + 3);
    const end = positions.slice(edge * 6 + 3, edge * 6 + 6);
    const changedAxes = start.reduce(
      (count, coordinate, axis) => count + Number(coordinate !== end[axis]),
      0,
    );
    assert.equal(changedAxes, 1);
  }
});

test("exports the internal building puzzle visualizer", async () => {
  const html = await readFile(new URL("dist/client/index.html", root), "utf8");

  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<title>Building Puzzle Visualizer<\/title>/);
  assert.match(html, /BUILDING PUZZLE/);
  assert.match(html, /パズルデータ/);
  assert.match(html, /GRID/);
  assert.match(html, /3D View/);
  assert.match(html, /COL TOP/);
  assert.match(html, /ROW LEFT/);
  assert.doesNotMatch(html, /数字から、|HOW TO PLAY|BUILD\. ROTATE\. SOLVE\./);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("keeps the UI while separating React, camera, scene, and rendering", async () => {
  const [
    page,
    css,
    view,
    renderer,
    sceneBuilder,
    cameraController,
    constants,
    parser,
    config,
    workflow,
  ] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/ThreeCityView.tsx", root), "utf8"),
    readFile(new URL("lib/three-city/renderer.ts", root), "utf8"),
    readFile(new URL("lib/three-city/scene-builder.ts", root), "utf8"),
    readFile(new URL("lib/three-city/camera-controller.ts", root), "utf8"),
    readFile(new URL("lib/three-city/constants.js", root), "utf8"),
    readFile(new URL("lib/puzzle-text.js", root), "utf8"),
    readFile(new URL("next.config.ts", root), "utf8"),
    readFile(new URL(".github/workflows/deploy-pages.yml", root), "utf8"),
  ]);

  assert.match(page, /MIN_PUZZLE_SIZE/);
  assert.match(page, /MAX_PUZZLE_SIZE/);
  assert.match(page, /parsePuzzleText/);
  assert.match(page, /formatPuzzleText/);
  assert.match(page, /const HEIGHT_HUES/);
  assert.match(page, /Math\.min\(90, drag\.tilt/);
  assert.match(page, /mode: "clue"/);
  assert.match(page, /mode: "free"/);
  assert.match(page, /mode: "overview"/);
  assert.match(page, /className="height-legend"/);
  assert.match(page, /視点ボタンを隠す/);
  assert.match(page, /aria-controls="viewpoint-controls"/);
  assert.match(page, /入力を反映/);
  assert.match(page, /回答を復元/);
  assert.match(page, /条件のみ生成/);
  assert.match(page, /条件・回答を再生成/);
  assert.match(page, /回答を一括クリア/);
  assert.match(page, /<details className="parser-panel">/);
  assert.match(page, /<details className="rules-details">/);
  assert.match(page, /ビルディングパズルのルール/);
  assert.match(view, /高さ \$\{height\} の直方体/);
  assert.match(view, /setView\(command\)/);
  assert.match(renderer, /new WebGLRenderer/);
  assert.match(renderer, /requestRender\(\)/);
  assert.doesNotMatch(renderer, /setAnimationLoop/);
  assert.match(sceneBuilder, /new InstancedMesh/);
  assert.match(sceneBuilder, /else if \(gridChanged\)/);
  assert.match(sceneBuilder, /setViewpoint\(viewpoint/);
  assert.match(sceneBuilder, /this\.updateHighlights\(\)/);
  assert.doesNotMatch(sceneBuilder, /wireframe: true|rebuildWorld/);
  assert.match(cameraController, /new OrthographicCamera/);
  assert.match(cameraController, /projectionModeFor\(this\.focusViewpoint\)/);
  assert.match(constants, /"#f4f7ff"/);
  assert.doesNotMatch(sceneBuilder + constants, /"#d9ff70"/);
  assert.match(css, /\.city-panel \{[^}]*display: flex/s);
  assert.match(css, /\.three-city-canvas/);
  assert.doesNotMatch(css, /transform-style: preserve-3d/);
  assert.doesNotMatch(css, /\.tower\s*\{[^}]*filter:/s);
  assert.match(css, /\.disclosure-summary::after/);
  assert.match(parser, /MAX_PUZZLE_SIZE = 11/);
  assert.match(config, /output: "export"/);
  assert.match(config, /assetPrefix: pagesUrl/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: dist\/client/);
});
