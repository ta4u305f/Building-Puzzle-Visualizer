"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  lazy,
  useMemo,
  Suspense,
  useRef,
  useState,
} from "react";
import {
  formatPuzzleText,
  MAX_PUZZLE_SIZE,
  MIN_PUZZLE_SIZE,
  parsePuzzleText,
} from "@/lib/puzzle-text.js";
import type { ThreeCityViewHandle } from "@/app/ThreeCityView";
import { cameraForDirection } from "@/lib/three-city/camera-math.js";
import { DEFAULT_CAMERA } from "@/lib/three-city/constants.js";
import type {
  CameraAngles,
  Direction,
  Viewpoint,
} from "@/lib/three-city/types";

const ThreeCityView = lazy(() => import("@/app/ThreeCityView"));

type CellPosition = { row: number; col: number };
type Puzzle = {
  solution: number[][];
  clues: Record<Direction, number[]>;
};
type ParserFeedback = {
  kind: "idle" | "success" | "error";
  text: string;
};

const INITIAL_SEED = 47;
const MIN_SIZE = MIN_PUZZLE_SIZE;
const MAX_SIZE = MAX_PUZZLE_SIZE;
const EXAMPLE_TEXT = `3 2 2 1 2 3 1 2 4 2 1 2 1 2 4 2

1 2 3 4
3 4 1 2
4 3 2 1
2 1 4 3`;
const INITIAL_DATA = parsePuzzleText(EXAMPLE_TEXT);
const INITIAL_SIZE = INITIAL_DATA.size;

const directionLabels: Record<Direction, string> = {
  north: "COL TOP",
  east: "ROW RIGHT",
  south: "COL BOTTOM",
  west: "ROW LEFT",
};
const directionArrows: Record<Direction, string> = {
  north: "↓",
  east: "←",
  south: "↑",
  west: "→",
};
const allDirections: Direction[] = ["north", "east", "south", "west"];
const HEIGHT_HUES = [
  235, 108, 2, 293, 34,
  177, 332, 216, 63, 262,
  145, 16, 194, 315, 86,
] as const;
function heightHue(height: number) {
  const paletteIndex = Math.max(0, height - 1) % HEIGHT_HUES.length;
  return HEIGHT_HUES[paletteIndex];
}

function conditionLabel(direction: Direction, index: number) {
  if (direction === "north") return `COL ${index + 1} TOP`;
  if (direction === "south") return `COL ${index + 1} BOTTOM`;
  if (direction === "west") return `ROW ${index + 1} LEFT`;
  return `ROW ${index + 1} RIGHT`;
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(size: number, random: () => number) {
  const values = Array.from({ length: size }, (_, index) => index);
  for (let index = size - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

function visibleCount(line: number[]) {
  let tallest = 0;
  let visible = 0;
  for (const height of line) {
    if (height > tallest) {
      tallest = height;
      visible += 1;
    }
  }
  return visible;
}

function createPuzzle(size: number, seed: number): Puzzle {
  const random = seededRandom(seed + size * 97);
  const rows = shuffled(size, random);
  const columns = shuffled(size, random);
  const heights = shuffled(size, random).map((height) => height + 1);
  const solution = rows.map((row) =>
    columns.map((column) => heights[(row + column) % size]),
  );
  const north = Array.from({ length: size }, (_, column) =>
    visibleCount(solution.map((row) => row[column])),
  );
  const south = Array.from({ length: size }, (_, column) =>
    visibleCount(solution.map((row) => row[column]).reverse()),
  );
  const west = solution.map((row) => visibleCount(row));
  const east = solution.map((row) => visibleCount([...row].reverse()));
  return { solution, clues: { north, east, south, west } };
}

function copyGrid(grid: number[][]) {
  return grid.map((row) => [...row]);
}

function emptyGrid(size: number) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function getConflicts(grid: number[][]) {
  const conflicts = new Set<number>();
  const size = grid.length;
  for (let row = 0; row < size; row += 1) {
    for (let first = 0; first < size; first += 1) {
      if (grid[row][first] === 0) continue;
      for (let second = first + 1; second < size; second += 1) {
        if (grid[row][first] === grid[row][second]) {
          conflicts.add(row * size + first);
          conflicts.add(row * size + second);
        }
      }
    }
  }
  for (let column = 0; column < size; column += 1) {
    for (let first = 0; first < size; first += 1) {
      if (grid[first][column] === 0) continue;
      for (let second = first + 1; second < size; second += 1) {
        if (grid[first][column] === grid[second][column]) {
          conflicts.add(first * size + column);
          conflicts.add(second * size + column);
        }
      }
    }
  }
  return conflicts;
}

function getLine(grid: number[][], direction: Direction, index: number) {
  if (direction === "west") return grid[index];
  if (direction === "east") return [...grid[index]].reverse();
  const column = grid.map((row) => row[index]);
  return direction === "north" ? column : column.reverse();
}

export default function Home() {
  const [size, setSize] = useState(INITIAL_SIZE);
  const [seed, setSeed] = useState(INITIAL_SEED);
  const [puzzle, setPuzzle] = useState<Puzzle>(() => INITIAL_DATA.puzzle);
  const [grid, setGrid] = useState<number[][]>(() => copyGrid(INITIAL_DATA.grid));
  const [selected, setSelected] = useState<CellPosition | null>(null);
  const [viewpoint, setViewpoint] = useState<Viewpoint>(null);
  const [showViewControls, setShowViewControls] = useState(true);
  const [message, setMessage] = useState("入力例の高さをGRIDと3Dビューへ反映しています。");
  const [parserText, setParserText] = useState(EXAMPLE_TEXT);
  const [parserFeedback, setParserFeedback] = useState<ParserFeedback>({
    kind: "success",
    text: "4×4入力例を初期表示しています。",
  });
  const dragState = useRef<{
    pointerId: number;
    x: number;
    y: number;
    tilt: number;
    rotation: number;
  } | null>(null);
  const cameraRef = useRef<CameraAngles>({ ...DEFAULT_CAMERA });
  const cityViewRef = useRef<ThreeCityViewHandle>(null);

  const conflicts = useMemo(() => getConflicts(grid), [grid]);
  const filled = grid.flat().filter(Boolean).length;
  const total = size * size;
  const cellSize = size > 9 ? 52 : size > 6 ? 58 : 72;
  const puzzleWidth = 76 + size * cellSize + (size + 1) * 3;

  const clueState = (direction: Direction, index: number) => {
    const clue = puzzle.clues[direction][index];
    if (clue === 0) return "pending";
    const line = getLine(grid, direction, index);
    if (!line.every((value) => value > 0)) return "pending";
    return visibleCount(line) === clue ? "correct" : "wrong";
  };

  const placeValue = (value: number) => {
    if (!selected) {
      setMessage("先に高さを入力するマスを選択してください。");
      return;
    }
    setGrid((current) =>
      current.map((row, rowIndex) =>
        row.map((cell, columnIndex) =>
          rowIndex === selected.row && columnIndex === selected.col ? value : cell,
        ),
      ),
    );
    setMessage(value === 0 ? "選択マスを空にしました。" : `高さ ${value} を入力しました。`);
  };

  const moveSelection = (row: number, col: number) => {
    const next = { row: (row + size) % size, col: (col + size) % size };
    setSelected(next);
    requestAnimationFrame(() => {
      document.getElementById(`cell-${next.row}-${next.col}`)?.focus();
    });
  };

  const handleCellKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    row: number,
    col: number,
  ) => {
    if (/^[1-9]$/.test(event.key)) {
      const value = Number(event.key);
      if (value <= size) {
        event.preventDefault();
        setSelected({ row, col });
        setGrid((current) =>
          current.map((currentRow, rowIndex) =>
            currentRow.map((cell, columnIndex) =>
              rowIndex === row && columnIndex === col ? value : cell,
            ),
          ),
        );
      }
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
      event.preventDefault();
      setSelected({ row, col });
      setGrid((current) =>
        current.map((currentRow, rowIndex) =>
          currentRow.map((cell, columnIndex) =>
            rowIndex === row && columnIndex === col ? 0 : cell,
          ),
        ),
      );
      return;
    }
    const movement: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowRight: [0, 1],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
    };
    if (movement[event.key]) {
      event.preventDefault();
      const [rowStep, columnStep] = movement[event.key];
      moveSelection(row + rowStep, col + columnStep);
    }
  };

  const selectView = (direction: Direction, index: number) => {
    const nextCamera = cameraForDirection(direction);
    setViewpoint({ direction, index });
    cameraRef.current = nextCamera;
    cityViewRef.current?.setView({
      mode: "clue",
      direction,
      index,
      animate: true,
    });
    setMessage(`${conditionLabel(direction, index)} の視点に切り替えました。`);
  };

  const resetCamera = () => {
    setViewpoint(null);
    cameraRef.current = { ...DEFAULT_CAMERA };
    cityViewRef.current?.setView({ mode: "overview", animate: true });
    setMessage("俯瞰表示に戻しました。3Dエリアはドラッグで回転できます。");
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      tilt: cameraRef.current.tilt,
      rotation: cameraRef.current.rotation,
    };
    event.currentTarget.classList.add("is-dragging");
    cityViewRef.current?.setView({
      mode: "free",
      camera: cameraRef.current,
      animate: false,
    });
    setViewpoint(null);
  };

  const dragCamera = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextCamera = {
      tilt: Math.max(34, Math.min(90, drag.tilt + (event.clientY - drag.y) * 0.18)),
      rotation: drag.rotation + (event.clientX - drag.x) * 0.32,
    };
    cameraRef.current = nextCamera;
    cityViewRef.current?.setView({
      mode: "free",
      camera: nextCamera,
      animate: false,
    });
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
      event.currentTarget.classList.remove("is-dragging");
    }
  };

  const resetInteraction = () => {
    setSelected(null);
    setViewpoint(null);
    cameraRef.current = { ...DEFAULT_CAMERA };
    cityViewRef.current?.setView({ mode: "overview", animate: true });
  };

  const changeSize = (nextSize: number) => {
    const nextSeed = seed + 11;
    const nextPuzzle = createPuzzle(nextSize, nextSeed);
    setSize(nextSize);
    setSeed(nextSeed);
    setPuzzle(nextPuzzle);
    setGrid(copyGrid(nextPuzzle.solution));
    resetInteraction();
    setMessage(`${nextSize}×${nextSize} の高さをGRIDと3Dビューへ反映しました。`);
  };

  const newPuzzle = () => {
    const nextSeed = seed + 1;
    const nextPuzzle = createPuzzle(size, nextSeed);
    setSeed(nextSeed);
    setPuzzle(nextPuzzle);
    setGrid(copyGrid(nextPuzzle.solution));
    resetInteraction();
    setMessage("条件値とすべてのビルの高さを再生成しました。");
  };

  const generateCluesOnly = () => {
    const nextSeed = seed + 1;
    const nextPuzzle = createPuzzle(size, nextSeed);
    setSeed(nextSeed);
    setPuzzle(nextPuzzle);
    setGrid(emptyGrid(size));
    resetInteraction();
    setMessage("新しい条件値を生成しました。回答は未入力です。");
  };

  const fillDemo = () => {
    setGrid(copyGrid(puzzle.solution));
    setMessage("回答を盤面と3Dビューへ復元しました。");
  };

  const clearAnswer = () => {
    setGrid(emptyGrid(size));
    setSelected(null);
    setMessage("入力されていた回答をすべてクリアしました。");
  };

  const importPuzzle = () => {
    try {
      const parsed = parsePuzzleText(parserText);
      setSize(parsed.size);
      setPuzzle(parsed.puzzle);
      setGrid(parsed.grid);
      resetInteraction();
      setParserFeedback({
        kind: "success",
        text: parsed.hasBuildings
          ? `${parsed.size}×${parsed.size} の条件値とビル ${parsed.size * parsed.size} 個を読み込みました。`
          : `${parsed.size}×${parsed.size} の条件値を読み込みました。回答は未入力です。`,
      });
      setMessage(
        parsed.hasBuildings
          ? "テキスト入力をGRIDと3Dビューへ反映しました。"
          : "条件値を反映しました。回答を入力すると3D表示へ反映されます。",
      );
    } catch (error) {
      setParserFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "入力を解析できませんでした。",
      });
    }
  };

  const showExample = () => {
    setParserText(EXAMPLE_TEXT);
    setParserFeedback({
      kind: "idle",
      text: "4×4の入力例をセットしました。「入力を反映」で確認できます。",
    });
  };

  const exportCurrent = () => {
    setParserText(formatPuzzleText(puzzle, grid));
    setParserFeedback({
      kind: "success",
      text: "現在の条件値と盤面をテキストに変換しました。",
    });
  };

  const checkAnswer = () => {
    const wrongClues = allDirections.filter((direction) =>
      puzzle.clues[direction].some(
        (_, index) => clueState(direction, index) === "wrong",
      ),
    ).length;
    if (filled < total) {
      setMessage(`未入力はあと ${total - filled} マスです。赤いマスはROWまたはCOL内で重複しています。`);
    } else if (conflicts.size > 0 || wrongClues > 0) {
      setMessage("高さの重複、またはROW / COLの条件値との不一致があります。");
    } else {
      setMessage("すべてのROW / COL条件と盤面が一致しています。");
    }
  };

  const isHighlighted = (row: number, col: number) => {
    if (!viewpoint) return true;
    return viewpoint.direction === "north" || viewpoint.direction === "south"
      ? col === viewpoint.index
      : row === viewpoint.index;
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Building Puzzle Visualizer">
          <strong>BUILDING PUZZLE VISUALIZER</strong>
        </div>
      </header>

      <details className="parser-panel">
        <summary className="parser-summary disclosure-summary">
          <div>
            <h1>パズルデータ</h1>
            <p>条件値・ビル回答のテキスト入出力（任意）</p>
          </div>
        </summary>
        <div className="parser-body">
          <div className="parser-editor">
            <label htmlFor="puzzle-text">入力データ</label>
            <textarea
              id="puzzle-text"
              value={parserText}
              onChange={(event) => {
                setParserText(event.target.value);
                setParserFeedback({
                  kind: "idle",
                  text: "入力内容を変更しました。読み込むと盤面へ反映されます。",
                });
              }}
              placeholder={EXAMPLE_TEXT}
              spellCheck={false}
            />
            <div className="parser-actions">
              <button className="button button--accent" type="button" onClick={importPuzzle}>
                入力を反映 <span aria-hidden="true">→</span>
              </button>
              <button className="button button--ghost" type="button" onClick={showExample}>入力例</button>
              <button className="button button--ghost" type="button" onClick={exportCurrent}>現在値をテキスト化</button>
            </div>
            <p
              className={`parser-feedback parser-feedback--${parserFeedback.kind}`}
              role="status"
              aria-live="polite"
            >
              {parserFeedback.text}
            </p>
          </div>
          <div className="format-guide">
            <h2>入力形式</h2>
            <p>
              最初に、サイズNに対して4N個の条件値を半角スペース区切りで入力します。
              条件値は次の順番です。
            </p>
            <p className="format-sequence">
              <code>COL TOP</code><span>→</span>
              <code>COL BOTTOM</code><span>→</span>
              <code>ROW LEFT</code><span>→</span>
              <code>ROW RIGHT</code>
            </p>
            <p>
              回答も読み込む場合は、条件値の後に空行を1行入れ、
              続くN行へ各ROWの高さをN個ずつ入力します。
            </p>
            <p>
              回答がない場合は条件値だけで反映できます。値はすべて半角整数です。
            </p>
          </div>
        </div>
      </details>

      <section className="control-strip" aria-label="盤面設定">
        <label className="size-control">
          <span>GRID SIZE</span>
          <select value={size} onChange={(event) => changeSize(Number(event.target.value))}>
            {Array.from(
              { length: MAX_SIZE - MIN_SIZE + 1 },
              (_, index) => index + MIN_SIZE,
            ).map((value) => (
              <option key={value} value={value}>{value} × {value}</option>
            ))}
          </select>
        </label>
        <div className="control-actions">
          <button className="button button--ghost" type="button" onClick={fillDemo}>
            回答を復元
          </button>
          <button className="button button--ghost" type="button" onClick={generateCluesOnly}>
            条件のみ生成
          </button>
          <button className="button button--ink" type="button" onClick={newPuzzle}>
            条件・回答を再生成
          </button>
        </div>
      </section>

      <section className="workspace">
        <article className="panel puzzle-panel" aria-labelledby="puzzle-title">
          <div className="panel-heading">
            <h2 id="puzzle-title">GRID</h2>
          </div>

          <details className="rules-details">
            <summary className="rules-summary disclosure-summary">
              <span>ビルディングパズルのルール</span>
            </summary>
            <div className="rules-body">
              <p>各ROW・COLに、高さ1〜Nのビルを1つずつ置きます。</p>
              <p>外側の条件値は、その方向から見えるビルの数です。</p>
              <p>手前の高いビルは、奥にある低いビルを隠します。</p>
            </div>
          </details>

          <div className="board-wrap">
            <div
              className="clue-grid"
              style={{
                gridTemplateColumns: `38px repeat(${size}, ${cellSize}px) 38px`,
                width: `${puzzleWidth}px`,
              }}
            >
              <span className="grid-corner" />
              {puzzle.clues.north.map((clue, index) => (
                <button
                  className={`clue clue--north clue--${clueState("north", index)} ${viewpoint?.direction === "north" && viewpoint.index === index ? "is-active" : ""}`}
                  key={`north-${index}`}
                  type="button"
                  onClick={() => selectView("north", index)}
                  title={`${conditionLabel("north", index)} = ${clue || "–"}`}
                  aria-label={`${conditionLabel("north", index)}、条件値${clue || "未設定"}`}
                >
                  <span>{clue || "–"}</span><small>↓</small>
                </button>
              ))}
              <span className="grid-corner" />

              {grid.map((row, rowIndex) => (
                <div className="contents" key={`row-${rowIndex}`}>
                  <button
                    className={`clue clue--west clue--${clueState("west", rowIndex)} ${viewpoint?.direction === "west" && viewpoint.index === rowIndex ? "is-active" : ""}`}
                    type="button"
                    onClick={() => selectView("west", rowIndex)}
                    title={`${conditionLabel("west", rowIndex)} = ${puzzle.clues.west[rowIndex] || "–"}`}
                    aria-label={`${conditionLabel("west", rowIndex)}、条件値${puzzle.clues.west[rowIndex] || "未設定"}`}
                  >
                    <span>{puzzle.clues.west[rowIndex] || "–"}</span><small>→</small>
                  </button>
                  {row.map((value, colIndex) => {
                    const index = rowIndex * size + colIndex;
                    const selectedCell = selected?.row === rowIndex && selected?.col === colIndex;
                    const duplicate = conflicts.has(index);
                    return (
                      <button
                        id={`cell-${rowIndex}-${colIndex}`}
                        key={`cell-${rowIndex}-${colIndex}`}
                        type="button"
                        className={`puzzle-cell ${selectedCell ? "is-selected" : ""} ${duplicate ? "has-error" : ""} ${viewpoint && isHighlighted(rowIndex, colIndex) ? "is-line" : ""}`}
                        onClick={() => setSelected({ row: rowIndex, col: colIndex })}
                        onKeyDown={(event) => handleCellKey(event, rowIndex, colIndex)}
                        aria-label={`ROW ${rowIndex + 1}, COL ${colIndex + 1}、${value ? `高さ${value}` : "空"}${duplicate ? "、重複あり" : ""}`}
                      >
                        <strong>{value || ""}</strong>
                      </button>
                    );
                  })}
                  <button
                    className={`clue clue--east clue--${clueState("east", rowIndex)} ${viewpoint?.direction === "east" && viewpoint.index === rowIndex ? "is-active" : ""}`}
                    type="button"
                    onClick={() => selectView("east", rowIndex)}
                    title={`${conditionLabel("east", rowIndex)} = ${puzzle.clues.east[rowIndex] || "–"}`}
                    aria-label={`${conditionLabel("east", rowIndex)}、条件値${puzzle.clues.east[rowIndex] || "未設定"}`}
                  >
                    <small>←</small><span>{puzzle.clues.east[rowIndex] || "–"}</span>
                  </button>
                </div>
              ))}

              <span className="grid-corner" />
              {puzzle.clues.south.map((clue, index) => (
                <button
                  className={`clue clue--south clue--${clueState("south", index)} ${viewpoint?.direction === "south" && viewpoint.index === index ? "is-active" : ""}`}
                  key={`south-${index}`}
                  type="button"
                  onClick={() => selectView("south", index)}
                  title={`${conditionLabel("south", index)} = ${clue || "–"}`}
                  aria-label={`${conditionLabel("south", index)}、条件値${clue || "未設定"}`}
                >
                  <small>↑</small><span>{clue || "–"}</span>
                </button>
              ))}
              <span className="grid-corner" />
            </div>
          </div>

          <div className="number-pad" aria-label="高さを入力">
            <span>HEIGHT</span>
            <div>
              {Array.from({ length: size }, (_, index) => index + 1).map((height) => (
                <button type="button" key={height} onClick={() => placeValue(height)}>{height}</button>
              ))}
              <button className="erase-key" type="button" onClick={() => placeValue(0)} aria-label="選択マスを消去">×</button>
            </div>
            <button className="clear-answer" type="button" onClick={clearAnswer}>
              回答を一括クリア
            </button>
          </div>

          <div className="board-footer">
            <p role="status" aria-live="polite">{message}</p>
            <button className="button button--accent" type="button" onClick={checkAnswer}>
              条件をチェック <span aria-hidden="true">→</span>
            </button>
          </div>
        </article>

        <article className="panel city-panel" aria-labelledby="city-title">
          <div className="panel-heading panel-heading--dark">
            <h2 id="city-title">3D View</h2>
            <div className="view-actions">
              <button
                className="view-toggle"
                type="button"
                aria-controls="viewpoint-controls"
                aria-expanded={showViewControls}
                onClick={() => setShowViewControls((current) => !current)}
              >
                {showViewControls ? "視点ボタンを隠す" : "視点ボタンを表示"}
              </button>
              <button className="reset-view" type="button" onClick={resetCamera}>
                俯瞰表示
              </button>
            </div>
          </div>

          <div
            className="scene"
            onPointerDown={startDrag}
            onPointerMove={dragCamera}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
            aria-label="3Dビル表示。ドラッグして視点を回転できます"
          >
            <div className="scene-note">ドラッグで回転</div>

            <div
              className="view-controls"
              id="viewpoint-controls"
              hidden={!showViewControls}
            >
              {(["north", "south", "west", "east"] as Direction[]).map((direction) => (
                <div
                  className={`view-rail view-rail--${direction} ${size > 10 ? "is-dense" : ""}`}
                  key={direction}
                >
                  <b>{directionLabels[direction]} {directionArrows[direction]}</b>
                  <div>
                    {Array.from({ length: size }, (_, index) => (
                      <button
                        type="button"
                        key={index}
                        className={viewpoint?.direction === direction && viewpoint.index === index ? "is-active" : ""}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => selectView(direction, index)}
                        aria-label={`${conditionLabel(direction, index)} の視点`}
                        title={conditionLabel(direction, index)}
                      >
                        {index + 1}
                      </button>
                    ))}
                </div>
              </div>
            ))}
            </div>

            <Suspense fallback={null}>
              <ThreeCityView
                grid={grid}
                heightHues={HEIGHT_HUES}
                ref={cityViewRef}
                size={size}
                viewpoint={viewpoint}
              />
            </Suspense>
          </div>

          <div className="view-footer">
            <div>
              <span>VIEWPOINT</span>
              <strong>{viewpoint ? conditionLabel(viewpoint.direction, viewpoint.index) : "俯瞰表示"}</strong>
            </div>
            <div className="height-legend" aria-label="高さと色の対応">
              <span>HEIGHT COLOR</span>
              <div>
                {Array.from({ length: size }, (_, index) => index + 1).map((height) => (
                  <span
                    className="height-swatch"
                    key={height}
                    style={{ "--swatch-hue": `${heightHue(height)}` } as CSSProperties}
                    aria-label={`高さ ${height}`}
                  >
                    <b>{height}</b>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}
