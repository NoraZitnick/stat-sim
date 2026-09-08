/**
 * maze.js — Maze generation, smart exploration, mouse drawing
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

/** Shortest path (BFS) — used as reference length, not for mouse movement */
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
 * Marks dead-end branches so mice don't re-enter explored territory.
 */
function pickNextCell(grid, cx, cy, end, visited, blocked) {
  const key = (x, y) => `${x},${y}`;
  const neighbors = getOpenNeighbors(grid, cx, cy);
  const options = neighbors.filter((n) => !blocked.has(key(n.x, n.y)));
  const unvisited = options.filter((n) => !visited.has(key(n.x, n.y)));

  const pool = unvisited.length > 0 ? unvisited : options;
  if (pool.length === 0) return null;

  const scored = pool.map((n) => {
    const dist = Math.abs(n.x - end.x) + Math.abs(n.y - end.y);
    const goalBias = 1 / (dist + 1);
    const novelty = visited.has(key(n.x, n.y)) ? 0.15 : 1;
    return { n, score: goalBias * novelty + Math.random() * 0.6 };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].n;
}

/**
 * Explore maze: random turns at junctions, backtrack at dead ends,
 * never re-enter blocked branches. With knownCells, mouse takes a direct route (learned maze).
 */
export function exploreMazePath(grid, start, end, knownCells = null) {
  if (knownCells && knownCells.size > 8) {
    return findShortestPath(grid, start, end);
  }

  const key = (x, y) => `${x},${y}`;
  const trail = [{ x: start.x, y: start.y }];
  let cx = start.x;
  let cy = start.y;

  const visited = new Set([key(start.x, start.y)]);

  const blocked = new Set();
  const stack = [{ x: cx, y: cy, tried: new Set() }];

  let steps = 0;
  while ((cx !== end.x || cy !== end.y) && steps < CONFIG.maxExploreSteps) {
    steps++;
    const next = pickNextCell(grid, cx, cy, end, visited, blocked);

    if (next) {
      cx = next.x;
      cy = next.y;
      if (!visited.has(key(cx, cy))) visited.add(key(cx, cy));
      stack.push({ x: cx, y: cy, tried: new Set() });
      trail.push({ x: cx, y: cy });
    } else {
      const dead = stack.pop();
      if (!dead || stack.length === 0) break;

      const from = stack[stack.length - 1];
      blocked.add(`${dead.x},${dead.y}->${from.x},${from.y}`);
      blocked.add(`${from.x},${from.y}->${dead.x},${dead.y}`);

      if (cx !== from.x || cy !== from.y) {
        cx = from.x;
        cy = from.y;
        trail.push({ x: cx, y: cy });
      }
    }
  }

  return trail;
}

/** Fast estimate of walk length without simulating every step */
export function estimatePathLength(shortestLength, isRepeatMaze) {
  const efficiency = isRepeatMaze
    ? 1.05 + Math.abs(randomEfficiency(0.08))
    : 1.15 + Math.abs(randomEfficiency(0.12));
  return Math.max(shortestLength, Math.round(shortestLength * efficiency));
}

function randomEfficiency(scale) {
  return (Math.random() + Math.random()) * scale;
}

export function pathToPixels(path, cellSize, padding) {
  return path.map(({ x, y }) => ({
    px: padding + x * cellSize + cellSize / 2,
    py: padding + y * cellSize + cellSize / 2,
  }));
}

export function getPathPosition(path, progress, cellSize, padding) {
  const pixels = pathToPixels(path, cellSize, padding);
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

export function drawMaze(ctx, grid, options = {}) {
  const { cellSize = 32, padding = 8, mice = [] } = options;
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

  for (const mouse of mice) {
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

export function animateMazeRuns(canvas, grid, runners, options = {}) {
  const cellSize = options.cellSize ?? 32;
  const padding = options.padding ?? 8;
  const animTimeScale = options.animTimeScale ?? 0.09;
  const shouldSkip = options.shouldSkip ?? (() => false);
  const ctx = canvas.getContext("2d");

  const states = runners.map((r) => ({ ...r, progress: 0, finished: false }));

  return new Promise((resolve) => {
    let lastTime = null;

    function finishAll() {
      states.forEach((s) => (s.finished = true));
      resolve(states.map((s) => s.completionTime));
    }

    function frame(timestamp) {
      if (shouldSkip()) {
        finishAll();
        return;
      }

      if (lastTime === null) lastTime = timestamp;
      const dt = (timestamp - lastTime) / 1000;
      lastTime = timestamp;

      for (const s of states) {
        if (s.finished) continue;
        const animDuration = Math.max(1, s.completionTime * animTimeScale);
        const speed = Math.max(1, (s.path.length - 1) / animDuration);
        s.progress += speed * dt;
        if (s.progress >= s.path.length - 1) s.finished = true;
      }

      const mice = states
        .filter((s) => s.progress > 0 && !s.finished)
        .map((s) => {
          const pos = getPathPosition(s.path, s.progress, cellSize, padding);
          return { px: pos.px, py: pos.py, angle: pos.angle, fur: s.fur, hasDrug: s.hasDrug, finished: false };
        });

      drawMaze(ctx, grid, { cellSize, padding, mice });

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
