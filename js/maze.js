/**
 * maze.js — Maze generation, "smart wandering" exploration, and drawing.
 *
 * Nothing in this file affects the statistics. It only decides what path a
 * individual's sprite walks and how long that walk visually takes (which is set
 * to match the completion time computed in study.js). You could delete the
 * whole animation and the experiment's conclusions wouldn't change — that
 * separation is intentional, and it's what keeps the math in study.js easy
 * to reason about.
 */

import { CONFIG, GROUP_COLORS } from "./config.js";

function createEmptyGrid(cols, rows) {
  const grid = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      row.push({ x, y, walls: { n: true, e: true, s: true, w: true }, visited: false });
    }
    grid.push(row);
  }
  return grid;
}

const DIRECTIONS = [
  { dx: 0, dy: -1, wall: "n", opposite: "s" },
  { dx: 1, dy: 0, wall: "e", opposite: "w" },
  { dx: 0, dy: 1, wall: "s", opposite: "n" },
  { dx: -1, dy: 0, wall: "w", opposite: "e" },
];

/** Randomized depth-first search — the standard "perfect maze" algorithm (exactly one path between any two cells). */
export function generateMaze(cols, rows) {
  const grid = createEmptyGrid(cols, rows);
  const stack = [];
  let current = grid[0][0];
  current.visited = true;
  stack.push(current);

  while (stack.length > 0) {
    current = stack[stack.length - 1];
    const neighbors = DIRECTIONS.map(({ dx, dy, wall, opposite }) => {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return null;
      const next = grid[ny][nx];
      if (next.visited) return null;
      return { next, wall, opposite };
    }).filter(Boolean);

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    const { next, wall, opposite } = neighbors[Math.floor(Math.random() * neighbors.length)];
    current.walls[wall] = false;
    next.walls[opposite] = false;
    next.visited = true;
    stack.push(next);
  }

  return grid;
}

function getOpenNeighbors(grid, x, y) {
  const rows = grid.length;
  const cols = grid[0].length;
  const cell = grid[y][x];
  const moves = [];

  if (!cell.walls.n && y > 0) moves.push({ x, y: y - 1 });
  if (!cell.walls.e && x < cols - 1) moves.push({ x: x + 1, y });
  if (!cell.walls.s && y < rows - 1) moves.push({ x, y: y + 1 });
  if (!cell.walls.w && x > 0) moves.push({ x: x - 1, y });

  return moves;
}

/** Shortest path (BFS) — used as a reference length, and as the guaranteed-fast fallback below. */
export function findShortestPath(grid, start, end) {
  const rows = grid.length;
  const cols = grid[0].length;
  const key = (x, y) => `${x},${y}`;
  const queue = [{ x: start.x, y: start.y, path: [{ x: start.x, y: start.y }] }];
  const seen = new Set([key(start.x, start.y)]);

  while (queue.length > 0) {
    const node = queue.shift();
    if (node.x === end.x && node.y === end.y) return node.path;

    const cell = grid[node.y][node.x];
    const moves = [];
    if (!cell.walls.n) moves.push({ x: node.x, y: node.y - 1 });
    if (!cell.walls.e) moves.push({ x: node.x + 1, y: node.y });
    if (!cell.walls.s) moves.push({ x: node.x, y: node.y + 1 });
    if (!cell.walls.w) moves.push({ x: node.x - 1, y: node.y });

    for (const m of moves) {
      const k = key(m.x, m.y);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ x: m.x, y: m.y, path: [...node.path, m] });
    }
  }

  return [{ x: start.x, y: start.y }];
}

/**
 * Pick next cell: prefer unvisited, bias toward goal, random tie-break.
 * Never choose a branch that has already been proven dead, and never reverse
 * immediately when another legal direction still exists.
 */
function pickNextCell(grid, cx, cy, end, visited, blocked, previous = null) {
  const key = (x, y) => `${x},${y}`;
  const edgeKey = (ax, ay, bx, by) => `${key(ax, ay)}->${key(bx, by)}`;

  const candidates = getOpenNeighbors(grid, cx, cy).filter((n) => {
    const dirKey = edgeKey(cx, cy, n.x, n.y);
    const reverseKey = edgeKey(n.x, n.y, cx, cy);
    if (blocked.has(dirKey) || blocked.has(reverseKey)) return false;
    if (previous && n.x === previous.x && n.y === previous.y) return false;
    return true;
  });

  const nonReverse = candidates.filter((n) => !(previous && n.x === previous.x && n.y === previous.y));
  const pool = nonReverse.length > 0 ? nonReverse : candidates;
  if (pool.length === 0) return null;

  const unvisited = pool.filter((n) => !visited.has(key(n.x, n.y)));
  const choices = unvisited.length > 0 ? unvisited : pool;

  const scored = choices.map((n) => {
    const dist = Math.abs(n.x - end.x) + Math.abs(n.y - end.y);
    const goalBias = 1 / (dist + 1);
    const novelty = visited.has(key(n.x, n.y)) ? 0.25 : 1;
    return { n, score: goalBias * novelty + Math.random() * 0.7 };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].n;
}

/**
 * Explore maze: random turns at junctions, backtrack at dead ends,
 * never re-enter blocked branches. With knownCells, individual takes a direct route (learned maze).
 *
 * `CONFIG.maxExploreSteps` is a safety cap, not a tuning knob for realism —
 * if wandering ever ran away for one individual, it would freeze the browser tab
 * for everyone. If the cap is ever hit, we just fall back to the guaranteed
 * BFS shortest path below, so lowering the cap only ever makes this safer.
 */
export function exploreMazePath(grid, start, end, knownCells = null) {
  if (knownCells && knownCells.size > 8) {
    return findShortestPath(grid, start, end);
  }

  const key = (x, y) => `${x},${y}`;
  const edgeKey = (ax, ay, bx, by) => `${key(ax, ay)}->${key(bx, by)}`;
  const trail = [{ x: start.x, y: start.y }];
  let cx = start.x;
  let cy = start.y;

  const visited = new Set([key(start.x, start.y)]);
  const blocked = new Set();
  const stack = [{ x: cx, y: cy }];

  let steps = 0;
  let previous = null;

  while ((cx !== end.x || cy !== end.y) && steps < CONFIG.maxExploreSteps) {
    steps++;
    const next = pickNextCell(grid, cx, cy, end, visited, blocked, previous);

    if (next) {
      const prev = { x: cx, y: cy };
      cx = next.x;
      cy = next.y;
      if (!visited.has(key(cx, cy))) visited.add(key(cx, cy));
      stack.push({ x: cx, y: cy });
      trail.push({ x: cx, y: cy });
      previous = prev;
      continue;
    }

    const current = stack[stack.length - 1];
    const parent = stack[stack.length - 2];
    if (!parent) break;

    blocked.add(edgeKey(current.x, current.y, parent.x, parent.y));
    blocked.add(edgeKey(parent.x, parent.y, current.x, current.y));

    previous = { x: current.x, y: current.y };
    stack.pop();
    cx = parent.x;
    cy = parent.y;
    trail.push({ x: cx, y: cy });
  }

  if (cx !== end.x || cy !== end.y) {
    return findShortestPath(grid, start, end);
  }

  return trail;
}

/** Converts a cell-coordinate path into pixel positions once, so the animation loop never has to redo this per frame. */
export function pathToPixels(path, cellSize, padding) {
  return path.map(({ x, y }) => ({
    px: padding + x * cellSize + cellSize / 2,
    py: padding + y * cellSize + cellSize / 2,
  }));
}

/** Interpolated pixel position and facing angle at a given point along a precomputed pixel path. */
export function getPathPosition(pixels, progress) {
  const maxIdx = pixels.length - 1;
  const idx = Math.min(progress, maxIdx);
  const i = Math.floor(idx);
  const frac = idx - i;
  const a = pixels[i];
  const b = pixels[Math.min(i + 1, maxIdx)];
  const px = a.px + (b.px - a.px) * frac;
  const py = a.py + (b.py - a.py) * frac;
  const angle = Math.atan2(b.py - a.py, b.px - a.px);
  return { px, py, angle };
}

/** Draws only the parts of the maze that never change during an animation: background, start/end tiles, walls. */
export function drawMazeBackground(ctx, grid, options = {}, individualName = "mouse") {
  const { cellSize = 32, padding = 8 } = options;
  const cols = grid[0].length;
  const rows = grid.length;
  const width = padding * 2 + cols * cellSize;
  const height = padding * 2 + rows * cellSize;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = individualName === "turtle" ? "#d3edff" : "#fafafa";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(34, 197, 94, 0.73)";
  ctx.fillRect(padding, padding, cellSize, cellSize);
  ctx.fillStyle = "rgba(239, 68, 68, 0.73)";
  ctx.fillRect(
    padding + (cols - 1) * cellSize,
    padding + (rows - 1) * cellSize,
    cellSize,
    cellSize
  );

  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 2;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cx = padding + x * cellSize;
      const cy = padding + y * cellSize;
      const { walls } = grid[y][x];
      ctx.beginPath();
      if (walls.n) { ctx.moveTo(cx, cy); ctx.lineTo(cx + cellSize, cy); }
      if (walls.e) { ctx.moveTo(cx + cellSize, cy); ctx.lineTo(cx + cellSize, cy + cellSize); }
      if (walls.s) { ctx.moveTo(cx, cy + cellSize); ctx.lineTo(cx + cellSize, cy + cellSize); }
      if (walls.w) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + cellSize); }
      ctx.stroke();
    }
  }
}

/** Full maze draw: background + every individual sprite. Fine for one-off draws; the animation loop below avoids re-running the background half of this every frame. */
export function drawMaze(ctx, grid, individualName, options = {}) {
  drawMazeBackground(ctx, grid, options, individualName);
  for (const individual of options.individuals ?? []) {
    drawIndividualSprite(ctx, individual, individualName);
  }
}

export function drawIndividualSprite(ctx, { px, py, angle, fur, shellColor, limbColor, antColor, hasDrug, finished }, individualName = "mouse") {
  if (finished) return;
  if (individualName === "ant") {
    const bodyColor = antColor ?? fur.fur;
    const darker = bodyColor;
    const headColor = bodyColor;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    // Slightly smaller overall
    ctx.scale(0.72, 0.72);

    // =====================================================
    // ABDOMEN — large rear section
    // =====================================================
    ctx.fillStyle = headColor;
    ctx.strokeStyle = darker;
    ctx.lineWidth = 1.4;

    ctx.beginPath();
    ctx.ellipse(-5, 0, 4.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();


    ctx.globalAlpha = 1;

    // =====================================================
    // THORAX — middle section
    // =====================================================
    ctx.fillStyle = headColor;
    ctx.strokeStyle = darker;
    ctx.lineWidth = 1.3;

    ctx.beginPath();
    ctx.ellipse(5, 0, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // =====================================================
    // SIX LEGS
    // =====================================================
    const drawLeg = (x, y, side, forward = 0, curvature) => {
      ctx.save();

      ctx.translate(x, y);

      ctx.strokeStyle = darker;
      ctx.lineWidth = 1.7;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      ctx.moveTo(0, 0);

      // First joint
      ctx.lineTo((4 + forward)*curvature, side * 5);

      // Second joint / foot
      ctx.lineTo((9 + forward)*curvature, side * 8);

      ctx.stroke();

      ctx.restore();
    };

    // Rear pair
    drawLeg(0, -5, -1, -1, -1);
    drawLeg(0, 5, 1, -1, -1);

    // Middle pair
    drawLeg(3.5, -6, -1, 0, -0.2);
    drawLeg(3.5, 6, 1, 0, -0.2);

    // Front pair
    drawLeg(7, -5, -1, 2, 1);
    drawLeg(7, 5, 1, 2, 1);

    // =====================================================
    // HEAD
    // =====================================================
    ctx.fillStyle = headColor;
    ctx.strokeStyle = darker;
    ctx.lineWidth = 1.3;

    ctx.beginPath();
    ctx.ellipse(15, 0, 6.2, 5.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // =====================================================
    // ANTENNAE
    // =====================================================
    ctx.strokeStyle = darker;
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";

    ctx.beginPath();

    // Upper antenna
    ctx.moveTo(18, -3);
    ctx.quadraticCurveTo(21, -7, 25, -9);

    // Lower antenna
    ctx.moveTo(18, 3);
    ctx.quadraticCurveTo(21, 7, 25, 9);

    ctx.stroke();

    // Antenna tips
    ctx.fillStyle = darker;

    ctx.beginPath();
    ctx.arc(25, -9, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(25, 9, 1.2, 0, Math.PI * 2);
    ctx.fill();


    // =====================================================
    // SMALL MANDIBLES
    // =====================================================
    ctx.strokeStyle = darker;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(20, -2);
    ctx.lineTo(23, -3);

    ctx.moveTo(20, 2);
    ctx.lineTo(23, 3);

    ctx.stroke();

    // =====================================================
    // DRUG / CONTROL STATUS
    //
    // Orange = drugged
    // Gray   = not drugged
    // =====================================================
    const markingColors = GROUP_COLORS.ant;
    ctx.fillStyle = hasDrug ? markingColors.drug : markingColors.control;
    ctx.strokeStyle = "#394234";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.arc(15, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  } else if (individualName === "turtle") {
    const turtleShellColor = shellColor ?? fur.fur;
    const turtleLimbColor = limbColor ?? fur.tail;
    const darker = turtleLimbColor;
    const headColor = turtleLimbColor;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    // A little smaller than the original sprite
    ctx.scale(0.5, 0.5);

    // --------------------
    // Flippers
    // --------------------
    const drawBackFlipper = (x, y, rotation, scale, flipX = 1) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.scale(flipX*scale, scale);

      ctx.fillStyle = headColor;
      ctx.strokeStyle = darker;
      ctx.lineWidth = 1.1;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(5, -4.5, 12, -3.5);
      ctx.quadraticCurveTo(16, -1, 14, 2.5);
      ctx.quadraticCurveTo(10, 6, 4, 5.5);
      ctx.quadraticCurveTo(1, 4, 0, 0);
      ctx.closePath();

      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    const drawFrontFlipper = (x, y, rotation, scale, flipX = 1, flipY = 1) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.scale(flipX*scale, flipY*scale);

      ctx.fillStyle = headColor;
      ctx.strokeStyle = darker;
      ctx.lineWidth = 1.1;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(5, 4.5, 12, -3.5);
      ctx.quadraticCurveTo(16, -1, 14, 2.5);
      ctx.quadraticCurveTo(10, 6, 4, 5.5);
      ctx.quadraticCurveTo(1, 4, 0, 0);
      ctx.closePath();

      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    // Front flippers — larger
    drawFrontFlipper(8, -11, -0.45, 1.5,  1, 1);
    drawFrontFlipper(8, 11, 0.45, 1.5,  1, -1);

    // Rear flippers — smaller
    drawBackFlipper(-10, -10, 0.55, 1, -1);
    drawBackFlipper(-10, 10, -0.55, 1, -1);

    // --------------------
    // Tail
    // --------------------
    ctx.fillStyle = darker;

    ctx.beginPath();
    ctx.moveTo(-15, -3.2);
    ctx.lineTo(-15, 3.2);
    ctx.lineTo(-23, 0);
    ctx.closePath();
    ctx.fill();

    // --------------------
    // Main shell
    // --------------------
    ctx.fillStyle = turtleShellColor;
    ctx.strokeStyle = darker;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 13.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // --------------------
    // Shell scute pattern
    // --------------------
    ctx.strokeStyle = darker;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.8;

    ctx.beginPath();

    // Top and bottom shell divisions
    ctx.moveTo(-8, -10);
    ctx.quadraticCurveTo(0, -13, 8, -10);

    ctx.moveTo(-8, 10);
    ctx.quadraticCurveTo(0, 13, 8, 10);

    // Vertical divisions
    ctx.moveTo(-5, -12);
    ctx.quadraticCurveTo(-2, 0, -5, 12);

    ctx.moveTo(0, -13);
    ctx.quadraticCurveTo(0, 0, 0, 13);

    ctx.moveTo(5, -12);
    ctx.quadraticCurveTo(2, 0, 5, 12);

    ctx.stroke();

    // Curved central scute divisions
    ctx.beginPath();
    ctx.arc(0, 0, 8, Math.PI * 0.18, Math.PI * 0.82);
    ctx.arc(0, 0, 8, Math.PI * 1.18, Math.PI * 1.82);
    ctx.stroke();

    ctx.globalAlpha = 1;

    // --------------------
    // Neck
    // --------------------
    ctx.fillStyle = headColor;
    ctx.strokeStyle = darker;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.roundRect(14, -4.3, 8, 8.6, 3);
    ctx.fill();
    ctx.stroke();

    // --------------------
    // Head
    // --------------------
    ctx.beginPath();
    ctx.ellipse(23, 0, 6.5, 5.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // --------------------
    // Drug/control status
    // Orange = drugged
    // Gray = not drugged
    // --------------------
    const markingColors = GROUP_COLORS.turtle;
    ctx.fillStyle = hasDrug ? markingColors.drug : markingColors.control;
    ctx.strokeStyle = "#394234";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.scale(0.95, 0.95);

    ctx.strokeStyle = fur.tail;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-11, 0);
    ctx.quadraticCurveTo(-18, 4, -22, 10);
    ctx.stroke();

    ctx.fillStyle = fur.fur;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fur.belly;
    ctx.beginPath();
    ctx.ellipse(2, 1, 5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fur.fur;
    ctx.beginPath();
    ctx.arc(9, 0, 5.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fur.ear;
    ctx.beginPath();
    ctx.arc(7, -5, 3, 0, Math.PI * 2);
    ctx.arc(7, 5, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fur.nose;
    ctx.beginPath();
    ctx.arc(13.5, 0, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = hasDrug ? "#16a34a" : "#94a3b8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(4, 0, 6.5, -0.8, 0.8);
    ctx.stroke();

    ctx.restore();
  }
}

/**
 * Animates every runner's individual sprite along its path at a speed matched to
 * its completion time, calling `onRunnerFinish` with the batch of individuals that
 * crossed the finish line on each frame (usually zero or one, but can be
 * many at once with a large shared-maze sample).
 *
 * Two things here specifically target low-power laptops (Chromebooks):
 *   1. Each individual's path is converted to pixel coordinates ONCE, up front,
 *      instead of being recomputed on every single animation frame — with
 *      dozens of individuals on screen at 60fps that recomputation was the actual
 *      bottleneck.
 *   2. The maze's walls are drawn to an offscreen canvas ONCE and then
 *      copied into place each frame with a single fast image blit, instead
 *      of redrawing ~900 individual wall-line segments every frame.
 */
export function animateMazeRuns(canvas, grid, runners, options = {}, individualName = "mouse") {
  const cellSize = options.cellSize ?? 32;
  const padding = options.padding ?? 8;
  const animTimeScale = options.animTimeScale ?? 1;
  const shouldSkip = options.shouldSkip ?? (() => false);
  const isCancelled = options.isCancelled ?? (() => false);
  const onRunnerFinish = options.onRunnerFinish ?? (() => {});
  const ctx = canvas.getContext("2d");

  const states = runners.map((r) => ({
    ...r,
    progress: 0,
    finished: false,
    pixels: pathToPixels(r.path, cellSize, padding),
  }));

  const background = document.createElement("canvas");
  background.width = canvas.width;
  background.height = canvas.height;
  drawMazeBackground(background.getContext("2d"), grid, { cellSize, padding }, individualName);

  return new Promise((resolve) => {
    let lastTime = null;

    function finishAll() {
      const newlyFinished = states.filter((s) => !s.finished);
      newlyFinished.forEach((s) => (s.finished = true));
      if (newlyFinished.length > 0) onRunnerFinish(newlyFinished);
      resolve(states.map((s) => s.completionTime));
    }

    function frame(timestamp) {
      if (isCancelled()) {
        resolve(null);
        return;
      }

      if (shouldSkip()) {
        finishAll();
        return;
      }

      if (lastTime === null) lastTime = timestamp;
      const dt = (timestamp - lastTime) / 1000;
      lastTime = timestamp;

      const justFinished = [];
      for (const s of states) {
        if (s.finished) continue;
        const pathSteps = Math.max(1, s.pixels.length - 1);
        const animDuration = Math.max(0.25, s.completionTime * animTimeScale);
        const speed = pathSteps / animDuration;
        s.progress += speed * dt;
        if (s.progress >= pathSteps) {
          s.finished = true;
          justFinished.push(s);
        }
      }

      ctx.drawImage(background, 0, 0);
      for (const s of states) {
        if (s.progress <= 0 || s.finished) continue;
        const pos = getPathPosition(s.pixels, s.progress);
        drawIndividualSprite(ctx, { px: pos.px, py: pos.py, angle: pos.angle, fur: s.fur, shellColor: s.shellColor, limbColor: s.limbColor, antColor: s.antColor, hasDrug: s.hasDrug, finished: false }, individualName);
      }

      if (justFinished.length > 0) onRunnerFinish(justFinished);

      if (states.every((s) => s.finished)) {
        resolve(states.map((s) => s.completionTime));
        return;
      }
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  });
}

export function fitCanvas(canvas, cols, rows, cellSize = 32, padding = 8) {
  canvas.width = padding * 2 + cols * cellSize;
  canvas.height = padding * 2 + rows * cellSize;
}

export function createMazeBundle(cols, rows, cellSize = 32, padding = 8) {
  const grid = generateMaze(cols, rows);
  const start = { x: 0, y: 0 };
  const end = { x: cols - 1, y: rows - 1 };
  const shortestPath = findShortestPath(grid, start, end);
  return { grid, start, end, shortestPath, shortestLength: shortestPath.length, cellSize, padding };
}
