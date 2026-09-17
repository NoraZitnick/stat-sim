/**
 * maze.js — Maze generation, "smart wandering" exploration, and drawing.
 *
 * Nothing in this file affects the statistics. It only decides what path a
 * mouse's sprite walks and how long that walk visually takes (which is set
 * to match the completion time computed in study.js). You could delete the
 * whole animation and the experiment's conclusions wouldn't change — that
 * separation is intentional, and it's what keeps the math in study.js easy
 * to reason about.
 */

import { CONFIG } from "./config.js";

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
 * never re-enter blocked branches. With knownCells, mouse takes a direct route (learned maze).
 *
 * `CONFIG.maxExploreSteps` is a safety cap, not a tuning knob for realism —
 * if wandering ever ran away for one mouse, it would freeze the browser tab
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
export function drawMazeBackground(ctx, grid, options = {}) {
  const { cellSize = 32, padding = 8 } = options;
  const cols = grid[0].length;
  const rows = grid.length;
  const width = padding * 2 + cols * cellSize;
  const height = padding * 2 + rows * cellSize;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(34, 197, 94, 0.25)";
  ctx.fillRect(padding, padding, cellSize, cellSize);
  ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
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

/** Full maze draw: background + every mouse sprite. Fine for one-off draws; the animation loop below avoids re-running the background half of this every frame. */
export function drawMaze(ctx, grid, options = {}) {
  drawMazeBackground(ctx, grid, options);
  for (const mouse of options.mice ?? []) {
    drawMouseSprite(ctx, mouse);
  }
}

export function drawMouseSprite(ctx, { px, py, angle, fur, hasDrug, finished }) {
  if (finished) return;

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

/**
 * Animates every runner's mouse sprite along its path at a speed matched to
 * its completion time, calling `onRunnerFinish` with the batch of mice that
 * crossed the finish line on each frame (usually zero or one, but can be
 * many at once with a large shared-maze sample).
 *
 * Two things here specifically target low-power laptops (Chromebooks):
 *   1. Each mouse's path is converted to pixel coordinates ONCE, up front,
 *      instead of being recomputed on every single animation frame — with
 *      dozens of mice on screen at 60fps that recomputation was the actual
 *      bottleneck.
 *   2. The maze's walls are drawn to an offscreen canvas ONCE and then
 *      copied into place each frame with a single fast image blit, instead
 *      of redrawing ~900 individual wall-line segments every frame.
 */
export function animateMazeRuns(canvas, grid, runners, options = {}) {
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
  drawMazeBackground(background.getContext("2d"), grid, { cellSize, padding });

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
        drawMouseSprite(ctx, { px: pos.px, py: pos.py, angle: pos.angle, fur: s.fur, hasDrug: s.hasDrug, finished: false });
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
