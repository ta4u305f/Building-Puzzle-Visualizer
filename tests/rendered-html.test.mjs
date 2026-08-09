import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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

test("keeps parser, interactions, three.js rendering, and GitHub Pages assets", async () => {
  const [page, css, renderer, parser, config, workflow] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/ThreeCityView.tsx", root), "utf8"),
    readFile(new URL("lib/puzzle-text.js", root), "utf8"),
    readFile(new URL("next.config.ts", root), "utf8"),
    readFile(new URL(".github/workflows/deploy-pages.yml", root), "utf8"),
  ]);

  assert.match(page, /MIN_PUZZLE_SIZE/);
  assert.match(page, /MAX_PUZZLE_SIZE/);
  assert.match(page, /parsePuzzleText/);
  assert.match(page, /formatPuzzleText/);
  assert.match(page, /const HEIGHT_HUES/);
  assert.match(renderer, /getVisualTowerHeight\(height, this.size\)/);
  assert.match(page, /north: 180/);
  assert.match(page, /south: 0/);
  assert.match(page, /west: -90/);
  assert.match(page, /east: 90/);
  assert.match(page, /return \{ tilt: 90/);
  assert.match(page, /Math\.min\(90, drag\.tilt/);
  assert.match(page, /const INITIAL_DATA = parsePuzzleText\(EXAMPLE_TEXT\)/);
  assert.match(page, /copyGrid\(INITIAL_DATA\.grid\)/);
  assert.match(page, /setGrid\(copyGrid\(nextPuzzle\.solution\)\)/);
  assert.match(page, /className="height-legend"/);
  assert.match(page, /視点ボタンを隠す/);
  assert.match(page, /aria-controls="viewpoint-controls"/);
  assert.match(renderer, /高さ \$\{height\} の直方体/);
  assert.match(page, /入力を反映/);
  assert.match(page, /回答を復元/);
  assert.match(page, /条件のみ生成/);
  assert.match(page, /条件・回答を再生成/);
  assert.match(page, /回答を一括クリア/);
  assert.match(page, /const generateCluesOnly/);
  assert.match(page, /const clearAnswer/);
  assert.match(page, /setGrid\(emptyGrid\(size\)\)/);
  assert.match(page, /<details className="parser-panel">/);
  assert.match(page, /<details className="rules-details">/);
  assert.match(page, /ビルディングパズルのルール/);
  assert.match(page, /条件値だけで反映できます/);
  assert.doesNotMatch(page, /value > 0 && <i/);
  assert.doesNotMatch(page, /progress-readout|board-axis-note|<small>R\{rowIndex/);
  assert.ok(
    page.indexOf('<details className="parser-panel">') <
      page.indexOf('<section className="control-strip"'),
  );
  assert.doesNotMatch(page, /FREE VIEW|LOCAL STATE|LIVE SYNC|axis-legend|panel-number|>CAMERA</);
  assert.doesNotMatch(page, /高さを復元|brand-mark/);
  assert.match(page, /onPointerMove=\{dragCamera\}/);
  assert.match(page, /cityViewRef\.current\?\.setCamera\(nextCamera, false\)/);
  assert.match(renderer, /new WebGLRenderer/);
  assert.match(renderer, /new InstancedMesh/);
  assert.match(renderer, /requestRender\(\)/);
  assert.doesNotMatch(renderer, /setAnimationLoop/);
  assert.doesNotMatch(renderer, /wireframe: true/);
  assert.match(renderer, /const edgePairs/);
  assert.match(renderer, /focusOffsetFor/);
  assert.match(renderer, /currentFocusX/);
  assert.match(renderer, /new OrthographicCamera/);
  assert.match(renderer, /focusViewpoint \? this\.orthographicCamera/);
  assert.match(renderer, /"#f4f7ff"/);
  assert.doesNotMatch(renderer, /"#d9ff70"/);
  assert.match(css, /\.city-panel \{[^}]*display: flex/s);
  assert.match(css, /\.three-city-canvas/);
  assert.doesNotMatch(css, /transform-style: preserve-3d/);
  assert.match(page, /selectView\("north"/);
  assert.doesNotMatch(css, /\.tower\s*\{[^}]*filter:/s);
  assert.doesNotMatch(css, /\.puzzle-cell i/);
  assert.doesNotMatch(css, /\.progress-readout|\.board-axis-note|\.puzzle-cell small/);
  assert.doesNotMatch(css, /\.tool-meta|\.live-badge|\.axis-legend|\.panel-number/);
  assert.match(css, /\.disclosure-summary::after/);
  assert.match(parser, /MAX_PUZZLE_SIZE = 11/);
  assert.match(config, /output: "export"/);
  assert.match(config, /assetPrefix: pagesUrl/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: dist\/client/);
});
