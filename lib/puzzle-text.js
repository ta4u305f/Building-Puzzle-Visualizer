export const MIN_PUZZLE_SIZE = 1;
export const MAX_PUZZLE_SIZE = 11;

function parseNumberTokens(tokens, label) {
  const invalid = tokens.find((token) => !/^\d+$/.test(token));
  if (invalid !== undefined) {
    throw new Error(
      `${label}に整数ではない値「${invalid}」があります。半角整数を空白で区切ってください。`,
    );
  }
  return tokens.map(Number);
}

function looksLikeMissingSeparator(lines) {
  for (let size = MIN_PUZZLE_SIZE; size <= MAX_PUZZLE_SIZE; size += 1) {
    if (lines.length <= size) continue;
    const clueLines = lines.slice(0, -size);
    const buildingLines = lines.slice(-size);
    const clueCount = clueLines.join(" ").trim().split(/\s+/).length;
    const hasBuildingShape = buildingLines.every(
      (line) => line.trim().split(/\s+/).length === size,
    );
    if (clueCount === size * 4 && hasBuildingShape) return true;
  }
  return false;
}

export function parsePuzzleText(source) {
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    throw new Error("入力が空です。条件値とビルの高さを入力してください。");
  }

  const sections = normalized.split(/\n[ \t]*\n+/);
  if (sections.length > 2) {
    throw new Error(
      "空行で区切るセクションは、条件値とビルの高さの2つだけにしてください。",
    );
  }

  const sourceLines = normalized.split("\n").filter((line) => line.trim());
  if (sections.length === 1 && looksLikeMissingSeparator(sourceLines)) {
    throw new Error("回答を含める場合は、条件値との間に空行を1行入れてください。");
  }

  const clueTokens = sections[0].trim().split(/\s+/);
  if (clueTokens.length % 4 !== 0) {
    throw new Error(
      `条件値は COL TOP / COL BOTTOM / ROW LEFT / ROW RIGHT の順に同数必要です。現在は ${clueTokens.length} 個です。`,
    );
  }

  const size = clueTokens.length / 4;
  if (size < MIN_PUZZLE_SIZE || size > MAX_PUZZLE_SIZE) {
    throw new Error(
      `条件値から算出したサイズは ${size}×${size} です。サイズは ${MIN_PUZZLE_SIZE}〜${MAX_PUZZLE_SIZE} にしてください。`,
    );
  }

  const clueValues = parseNumberTokens(clueTokens, "条件値");
  const invalidClue = clueValues.find((value) => value < 0 || value > size);
  if (invalidClue !== undefined) {
    throw new Error(
      `条件値「${invalidClue}」は範囲外です。0（未設定）または1〜${size}を入力してください。`,
    );
  }

  const hasBuildings = sections.length === 2 && Boolean(sections[1].trim());
  let grid = Array.from({ length: size }, () => Array(size).fill(0));

  if (hasBuildings) {
    const buildingLines = sections[1]
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (buildingLines.length !== size) {
      throw new Error(
        `ビルの行数が ${buildingLines.length} 行です。${size}×${size} なので ${size} 行必要です。`,
      );
    }

    grid = buildingLines.map((line, rowIndex) => {
      const tokens = line.split(/\s+/);
      if (tokens.length !== size) {
        throw new Error(
          `ROW ${rowIndex + 1} の値は ${tokens.length} 個です。${size} 個の高さを入力してください。`,
        );
      }
      const values = parseNumberTokens(tokens, `ROW ${rowIndex + 1}`);
      const invalidHeight = values.find((value) => value < 0 || value > size);
      if (invalidHeight !== undefined) {
        throw new Error(
          `ROW ${rowIndex + 1} の高さ「${invalidHeight}」は範囲外です。0（空マス）または1〜${size}を入力してください。`,
        );
      }
      return values;
    });
  }

  const north = clueValues.slice(0, size);
  const south = clueValues.slice(size, size * 2);
  const west = clueValues.slice(size * 2, size * 3);
  const east = clueValues.slice(size * 3, size * 4);

  return {
    size,
    grid,
    hasBuildings,
    puzzle: {
      solution: grid.map((row) => [...row]),
      clues: { north, east, south, west },
    },
  };
}

export function formatPuzzleText(puzzle, grid) {
  const clues = [
    ...puzzle.clues.north,
    ...puzzle.clues.south,
    ...puzzle.clues.west,
    ...puzzle.clues.east,
  ];
  const clueText = clues.join(" ");
  const hasBuildings = grid.some((row) => row.some((height) => height > 0));
  if (!hasBuildings) return clueText;

  return `${clueText}

${grid.map((row) => row.join(" ")).join("\n")}`;
}
