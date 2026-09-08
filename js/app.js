/**
 * app.js — Main controller
 */

import { CONFIG, LITTER_FUR, round1 } from "./config.js";
import {
  exploreMazePath,
  estimatePathLength,
  fitCanvas,
  drawMaze,
  animateMazeRuns,
  createMazeBundle,
} from "./maze.js";
import {
  createMice,
  buildExperiment,
  computeRunMetrics,
  getMazeKey,
  groupRunBatches,
  summarizeResults,
  getChartLabels,
  usesBlockCharts,
  usesMatchedDifference,
} from "./study.js";
import { createChartManager } from "./charts.js";

const sampleSizeInput = document.getElementById("sample-size");
const randomMazeToggle = document.getElementById("random-maze");
const runBtn = document.getElementById("run-btn");
const resetBtn = document.getElementById("reset-btn");
const fastForwardBtn = document.getElementById("fast-forward-btn");
const statusEl = document.getElementById("status");
const mazeCanvas = document.getElementById("maze-canvas");
const mazeTitle = document.getElementById("maze-title");
const runInfo = document.getElementById("run-info");
const chartCaption = document.getElementById("chart-caption");
const summaryEl = document.getElementById("summary");
const chartsGrid = document.getElementById("charts-grid");

let histograms = createChartManager("random", chartsGrid);
let isRunning = false;
let fastForwardRequested = false;
let finishedRecords = [];
let mazeMemory = new Set();
/** Tracks control & drug times per mouse for matched pairs */
const pairTracker = new Map();

function resetPairTracker() {
  pairTracker.clear();
}

function tryCompletePair(mouseId, group, time, litter) {
  if (!pairTracker.has(mouseId)) {
    pairTracker.set(mouseId, { control: null, drug: null, litter, charted: false });
  }
  const p = pairTracker.get(mouseId);
  p[group] = time;
  p.litter = litter;

  if (p.control != null && p.drug != null && !p.charted) {
    p.charted = true;
    return {
      type: "difference",
      time: round1(p.control - p.drug),
      mouseId,
      litter,
      control: p.control,
      drug: p.drug,
    };
  }
  return null;
}

function ingestRunRecords(records, assignmentType) {
  if (usesMatchedDifference(assignmentType)) {
    const newDiffs = [];
    for (const rec of records) {
      const diffRec = tryCompletePair(rec.mouseId, rec.group, rec.time, rec.litter);
      if (diffRec) {
        finishedRecords.push(diffRec);
        newDiffs.push(diffRec.time);
      }
    }
    if (newDiffs.length === 1) {
      histograms.addDifference(newDiffs[0]);
    } else if (newDiffs.length > 1) {
      histograms.addDifferencesBatch(newDiffs);
    }
    return;
  }

  finishedRecords.push(...records);

  if (records.length > 10) {
    histograms.addResultsBatch(records);
  } else if (usesBlockCharts(assignmentType)) {
    records.forEach((rec) => histograms.addResult(rec.group, rec.time, rec.litter));
  } else {
    records.forEach((rec) => histograms.addResult(rec.group, rec.time));
  }
}

function getAssignmentType() {
  return document.querySelector('input[name="assignment"]:checked').value;
}

function randomMazeEachRun() {
  return randomMazeToggle.checked;
}

function updateFastForwardButton() {
  fastForwardBtn.hidden = !randomMazeEachRun();
  fastForwardBtn.disabled = !isRunning || !randomMazeEachRun();
}

function setControlsEnabled(enabled) {
  runBtn.disabled = !enabled;
  sampleSizeInput.disabled = !enabled;
  randomMazeToggle.disabled = !enabled;
  document.querySelectorAll('input[name="assignment"]').forEach((el) => {
    el.disabled = !enabled;
  });
  if (!enabled) {
    fastForwardBtn.disabled = false;
  } else {
    updateFastForwardButton();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupCharts(assignmentType, newMazeEachRun) {
  histograms.destroy();
  histograms = createChartManager(assignmentType, chartsGrid);
  chartCaption.textContent = getChartLabels(assignmentType, newMazeEachRun).caption;
}

function getMazeFromCache(run, assignmentType, cache) {
  const key = getMazeKey(run, assignmentType, randomMazeEachRun());
  if (!cache.has(key)) {
    const { mazeCols, mazeRows } = CONFIG;
    fitCanvas(mazeCanvas, mazeCols, mazeRows);
    cache.set(key, createMazeBundle(mazeCols, mazeRows));
  }
  return cache.get(key);
}

function cellKey(x, y) {
  return `${x},${y}`;
}

/** Remember cells explored (for learning on phase 2) */
function rememberPath(path) {
  for (const { x, y } of path) {
    mazeMemory.add(cellKey(x, y));
  }
}

function prepareRunner(run, mazeBundle, assignmentType, newMazeEachRun, fastMode) {
  const { grid, start, end, shortestLength } = mazeBundle;

  const isRepeatMaze =
    !newMazeEachRun && assignmentType === "matched" && run.phase === 2;

  const knownCells = isRepeatMaze ? mazeMemory : null;

  let path;
  let pathHint;

  if (fastMode) {
    pathHint = estimatePathLength(shortestLength, isRepeatMaze);
    path = isRepeatMaze ? mazeBundle.shortestPath : mazeBundle.shortestPath;
  } else {
    path = exploreMazePath(grid, start, end, knownCells);
    pathHint = path.length;
  }

  const metrics = computeRunMetrics(
    run.mouse,
    { hasDrug: run.hasDrug, isRepeatMaze, assignmentType },
    pathHint
  );

  return {
    run,
    path: path ?? mazeBundle.shortestPath,
    completionTime: metrics.completionTime,
    fur: run.fur,
    hasDrug: run.hasDrug,
    metrics,
    isRepeatMaze,
    cellSize: mazeBundle.cellSize,
    padding: mazeBundle.padding,
  };
}

function recordResults(runners, times, assignmentType) {
  const batch = runners.map((runner, i) => ({
    group: runner.run.group,
    time: times[i],
    litter: runner.run.mouse.litter,
    mouseId: runner.run.mouse.id,
  }));

  ingestRunRecords(batch, assignmentType);
}

/** Fast bulk simulation — no pathfinding animation, batched chart updates */
async function bulkSimulateRuns(runs, assignmentType, newMazeEachRun, mazeCache) {
  const batchSize = CONFIG.fastForwardBatchSize;
  let pending = [];
  let phase1MemoryFilled = mazeMemory.size > 0;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];

    if (
      assignmentType === "matched" &&
      !newMazeEachRun &&
      run.phase === 2 &&
      !phase1MemoryFilled
    ) {
      const bundle = mazeCache.get("shared-maze");
      if (bundle) rememberPath(bundle.shortestPath);
      phase1MemoryFilled = true;
    }

    const mazeBundle = getMazeFromCache(run, assignmentType, mazeCache);
    const runner = prepareRunner(run, mazeBundle, assignmentType, newMazeEachRun, true);
    pending.push({
      group: runner.run.group,
      time: runner.completionTime,
      litter: runner.run.mouse.litter,
      mouseId: runner.run.mouse.id,
    });

    if (pending.length >= batchSize || i === runs.length - 1) {
      ingestRunRecords(pending, assignmentType);
      pending = [];

      statusEl.textContent = `Fast-forward: ${i + 1} / ${runs.length} runs simulated…`;
      summaryEl.textContent = summarizeResults(finishedRecords, assignmentType, newMazeEachRun);
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
}

async function runSimulation() {
  if (isRunning) return;
  isRunning = true;
  fastForwardRequested = false;
  setControlsEnabled(false);
  finishedRecords = [];
  mazeMemory = new Set();
  resetPairTracker();

  const sampleSize = parseInt(sampleSizeInput.value, 10);
  const assignmentType = getAssignmentType();
  const newMazeEachRun = randomMazeEachRun();

  setupCharts(assignmentType, newMazeEachRun);
  histograms.reset();
  summaryEl.textContent = "";

  const mice = createMice(sampleSize);
  const runs = buildExperiment(mice, assignmentType);
  const totalRuns = runs.length;
  const mazeCache = new Map();
  let completedRuns = 0;

  statusEl.textContent = `Running 0 / ${totalRuns}…`;

  const batches = groupRunBatches(runs, assignmentType, newMazeEachRun);

  for (const batch of batches) {
    if (fastForwardRequested) {
      const remaining = runs.slice(completedRuns);
      await bulkSimulateRuns(remaining, assignmentType, newMazeEachRun, mazeCache);
      completedRuns = totalRuns;
      break;
    }

    const mazeBundle = getMazeFromCache(batch[0], assignmentType, mazeCache);
    const { grid } = mazeBundle;

    const runners = batch.map((run) =>
      prepareRunner(run, mazeBundle, assignmentType, newMazeEachRun, false)
    );

    const isMulti = batch.length > 1;
    mazeTitle.textContent = isMulti ? "All mice — shared maze" : "Maze run";

    if (isMulti) {
      const phaseNote =
        assignmentType === "matched" ? ` · Phase ${batch[0].phase}` : "";
      runInfo.textContent =
        `${batch.length} mice exploring together${phaseNote} · ` +
        `${newMazeEachRun ? "New maze each" : "Shared maze"} · Smart routing (no backtracking)`;
    } else {
      const r = runners[0];
      const run = r.run;
      runInfo.textContent =
        `Mouse #${run.mouse.id} · ${run.fur.name} litter · ` +
        `${run.hasDrug ? "Drug" : "Control"} · ${r.path.length} steps · Speed ${r.metrics.speed}`;
    }

    statusEl.textContent = `Running ${completedRuns + 1}–${completedRuns + batch.length} / ${totalRuns}…`;

    drawMaze(mazeCanvas.getContext("2d"), grid, {
      cellSize: mazeBundle.cellSize,
      padding: mazeBundle.padding,
    });

    const times = await animateMazeRuns(
      mazeCanvas,
      grid,
      runners.map((r) => ({
        path: r.path,
        completionTime: r.completionTime,
        fur: r.fur,
        hasDrug: r.hasDrug,
      })),
      {
        cellSize: mazeBundle.cellSize,
        padding: mazeBundle.padding,
        animTimeScale: isMulti ? CONFIG.animTimeScale * 0.6 : CONFIG.animTimeScale,
        shouldSkip: () => fastForwardRequested,
      }
    );

    recordResults(runners, times, assignmentType);

    if (assignmentType === "matched" && batch[0].phase === 1 && !newMazeEachRun) {
      for (const r of runners) rememberPath(r.path);
    }

    completedRuns += batch.length;
    summaryEl.textContent = summarizeResults(finishedRecords, assignmentType, newMazeEachRun);

    if (fastForwardRequested) {
      const remaining = runs.slice(completedRuns);
      if (remaining.length > 0) {
        await bulkSimulateRuns(remaining, assignmentType, newMazeEachRun, mazeCache);
      }
      completedRuns = totalRuns;
      break;
    }

    if (completedRuns < totalRuns) {
      await sleep(CONFIG.pauseBetweenRuns);
    }
  }

  statusEl.textContent = `Done! ${totalRuns} runs completed.`;
  isRunning = false;
  fastForwardRequested = false;
  setControlsEnabled(true);
}

function resetAll() {
  if (isRunning) return;

  finishedRecords = [];
  mazeMemory = new Set();
  resetPairTracker();
  histograms.reset();
  summaryEl.textContent = "";
  statusEl.textContent = "Ready. Choose settings and click Run simulation.";
  runInfo.textContent = "—";

  const assignmentType = getAssignmentType();
  setupCharts(assignmentType, randomMazeEachRun());

  const { mazeCols, mazeRows } = CONFIG;
  fitCanvas(mazeCanvas, mazeCols, mazeRows);
  const bundle = createMazeBundle(mazeCols, mazeRows);
  drawMaze(mazeCanvas.getContext("2d"), bundle.grid, {
    cellSize: bundle.cellSize,
    padding: bundle.padding,
  });
}

runBtn.addEventListener("click", () => {
  runSimulation().catch((err) => {
    console.error(err);
    statusEl.textContent = "Something went wrong. Check the console.";
    isRunning = false;
    fastForwardRequested = false;
    setControlsEnabled(true);
  });
});

resetBtn.addEventListener("click", resetAll);

fastForwardBtn.addEventListener("click", () => {
  if (!isRunning) return;
  fastForwardRequested = true;
  fastForwardBtn.disabled = true;
  statusEl.textContent = "Fast-forwarding…";
});

document.querySelectorAll('input[name="assignment"]').forEach((el) => {
  el.addEventListener("change", () => {
    if (!isRunning) setupCharts(getAssignmentType(), randomMazeEachRun());
  });
});

randomMazeToggle.addEventListener("change", updateFastForwardButton);

function buildLitterLegend() {
  const list = document.getElementById("litter-legend");
  list.innerHTML = LITTER_FUR.map(
    (fur, i) =>
      `<li><span class="swatch fur" style="background:${fur.fur}"></span> Litter ${i + 1} — ${fur.name}</li>`
  ).join("");
}

buildLitterLegend();
updateFastForwardButton();
resetAll();
