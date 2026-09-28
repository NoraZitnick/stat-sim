/**
 * app.js — Main controller
 */

import { CONFIG, CLUTCH_FUR, round1 } from "./config.js";
import {
  exploreMazePath,
  fitCanvas,
  drawMaze,
  animateMazeRuns,
  createMazeBundle,
} from "./maze.js";
import {
  createTurtles,
  buildExperiment,
  computeRunMetrics,
  getMazeKey,
  groupRunBatches,
  summarizeResults,
  describeSignificance,
  getChartLabels,
  usesBlockCharts,
  usesMatchedDifference,
  getCurrentDiff,
} from "./study.js";
import {HistogramRunHistory, createChartManager } from "./charts.js";

const sampleSizeInput = document.getElementById("sample-size");
const randomMazeToggle = document.getElementById("random-maze");
const runBtn = document.getElementById("run-btn");
const resetBtn = document.getElementById("reset-btn");
const fastForwardBtn = document.getElementById("fast-forward-btn");
const statusEl = document.getElementById("status");
const mazeCanvas = document.getElementById("maze-canvas");
const mazeTitle = document.getElementById("maze-title");
const chartCaption = document.getElementById("chart-caption");
const summaryEl = document.getElementById("summary");
const pvalueEl = document.getElementById("pvalue");
const chartsGrid = document.getElementById("charts-grid");
const chartButtons = document.querySelectorAll(".chart-button");

let isRunning = false;
let fastForwardRequested = false;
let cancelRequested = false;
let multiRunCancelRequested = false;
let finishedRecords = [];
let diffRecords = [[], [], []];
let chartMode = "run";
let histograms = createChartManager("random", chartsGrid, chartMode, diffRecords);
let mazeMemory = new Set();
/** Tracks control & drug times per turtle for matched pairs */
const pairTracker = new Map();

function resetPairTracker() {
  pairTracker.clear();
}

function tryCompletePair(turtleId, group, time, clutch) {
  if (!pairTracker.has(turtleId)) {
    pairTracker.set(turtleId, { control: null, drug: null, clutch, charted: false });
  }
  const p = pairTracker.get(turtleId);
  p[group] = time;
  p.clutch = clutch;

  if (p.control != null && p.drug != null && !p.charted) {
    p.charted = true;
    return {
      type: "difference",
      time: round1(p.control - p.drug),
      turtleId,
      clutch,
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
      const diffRec = tryCompletePair(rec.turtleId, rec.group, rec.time, rec.clutch);
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
    records.forEach((rec) => histograms.addResult(rec.group, rec.time, rec.clutch));
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
  fastForwardBtn.disabled = !isRunning;
}

function setControlsEnabled(enabled) {
  runBtn.disabled = !enabled;
  sampleSizeInput.disabled = !enabled;
  randomMazeToggle.disabled = !enabled;
  document.querySelectorAll('input[name="assignment"]').forEach((el) => {
    el.disabled = !enabled;
  });
  chartButtons.forEach((button) => {
    button.disabled = !enabled || isRunning;
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

function updateChartButtons() {
  chartButtons.forEach((button) => {
    const isActive = button.dataset.mode === chartMode;
    button.classList.toggle("is-active", isActive);
    button.disabled = isRunning;
  });
}

function setupCharts(assignmentType, newMazeEachRun) {
  if (chartMode === "multi" && histograms instanceof HistogramRunHistory) {
    chartCaption.textContent = "";
    chartCaption.style.display = "block";
    renderRunCountBox();
  } else {
    histograms.destroy();
    histograms = createChartManager(assignmentType, chartsGrid, chartMode, diffRecords);
    chartCaption.textContent = getChartLabels(assignmentType, newMazeEachRun).caption;
    chartCaption.style.display = "block";
  }
  updateChartButtons();
}

function refreshSummary(assignmentType, newMazeEachRun) {
  let text = summarizeResults(finishedRecords, assignmentType, newMazeEachRun);
  if (chartMode !== "multi") {
    summaryEl.textContent = text;
    pvalueEl.textContent = describeSignificance(finishedRecords, assignmentType);
  }
  if (chartMode === "multi") {
    pvalueEl.textContent = "";
    histograms.syncFromRecords(diffRecords, assignmentType);
    renderRunCountBox();
  }
}

function renderRunCountBox() {
    summaryEl.textContent = "";
    let label = document.createElement("label");
    label.className = "multi-run-count-field";
    let runCountBox = document.createElement("input");
    runCountBox.type = "number";
    runCountBox.min = 1;
    runCountBox.max = 1000;
    runCountBox.id = "multi-run-count";
    runCountBox.step = 2;
    label.appendChild(runCountBox);
    summaryEl.appendChild(label);
    runCountBox.insertAdjacentHTML('afterend', '<span class="side-text"> experiments to graph</span>');
    runCountBox.insertAdjacentHTML('beforebegin', '<span class="side-text"> Add </span>');
    runCountBox.addEventListener("change", () => {
      addRuns(parseInt(runCountBox.value, 0));
    });
}

async function addRuns(runs) {
  const count = Number.parseInt(runs, 0);
  if (!Number.isFinite(count) || count <= 0) return;
  multiRunCancelRequested = false;
  for (let i = 0; i < count; i++) {
    try {
      await runSimulation(true);
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Something went wrong. Check the console.";
      isRunning = false;
      cancelRequested = false;
      fastForwardRequested = false;
      setControlsEnabled(true);
      break;
    }
    if (multiRunCancelRequested) {
      multiRunCancelRequested = false;
      break;
    }
  }
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
  const { grid, start, end } = mazeBundle;

  const isRepeatMaze =
    !newMazeEachRun && assignmentType === "matched" && run.phase === 2;

  const knownCells = isRepeatMaze ? mazeMemory : null;

  // Fast-forward mode skips the wandering search and takes the shortest
  // path instead — nobody watches the animation during fast-forward, so
  // nothing is lost, and it avoids running the (slower) search for every
  // single turtle when simulating a large sample.
  const path = fastMode
    ? mazeBundle.shortestPath
    : exploreMazePath(grid, start, end, knownCells);

  const metrics = computeRunMetrics(run.turtle, {
    hasDrug: run.hasDrug,
    isRepeatMaze,
    assignmentType,
    newMazeEachRun,
  });

  // Displayed speed is derived FROM the path and the time, after the fact —
  // it's just cells-per-second, not a separate random number. That keeps it
  // honest: a turtle that finishes faster will always show a higher speed,
  // because that's literally how it's computed.
  const speed = round1(path.length / metrics.completionTime);

  return {
    run,
    path,
    completionTime: metrics.completionTime,
    speed,
    fur: run.fur,
    hasDrug: run.hasDrug,
    isRepeatMaze,
    cellSize: mazeBundle.cellSize,
    padding: mazeBundle.padding,
  };
}

/** Fast bulk simulation — no pathfinding animation, batched chart updates */
async function bulkSimulateRuns(runs, assignmentType, newMazeEachRun, mazeCache) {
  const batchSize = CONFIG.fastForwardBatchSize;
  let pending = [];
  let phase1MemoryFilled = mazeMemory.size > 0;

  for (let i = 0; i < runs.length; i++) {
    if (cancelRequested) return;
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
      clutch: runner.run.turtle.clutch,
      turtleId: runner.run.turtle.id,
    });

    if (pending.length >= batchSize || i === runs.length - 1) {
      ingestRunRecords(pending, assignmentType);
      pending = [];

      statusEl.textContent = `Fast-forward: ${i + 1} / ${runs.length} runs simulated…`;
      refreshSummary(assignmentType, newMazeEachRun);
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
}

async function runSimulation(fastMode = false) {
  if (isRunning) return;
  isRunning = true;
  fastForwardRequested = fastMode;
  cancelRequested = false;
  setControlsEnabled(false);
  finishedRecords = [];
  mazeMemory = new Set();
  resetPairTracker();

  const sampleSize = parseInt(sampleSizeInput.value, 10);
  const assignmentType = getAssignmentType();
  const newMazeEachRun = randomMazeEachRun();

  setupCharts(assignmentType, newMazeEachRun);
  if (chartMode !== "multi") {
    histograms.reset();
  }
  resetPValueAndSummary();

  const turtles = createTurtles(sampleSize);
  const runs = buildExperiment(turtles, assignmentType);
  const totalRuns = runs.length;
  const mazeCache = new Map();
  let completedRuns = 0;

  statusEl.textContent = `Running 0 / ${totalRuns}…`;

  const batches = groupRunBatches(runs, assignmentType, newMazeEachRun);

  batchLoop:
  for (const batch of batches) {
    if (cancelRequested) break;

    if (fastForwardRequested) {
      const remaining = runs.slice(completedRuns);
      await bulkSimulateRuns(remaining, assignmentType, newMazeEachRun, mazeCache);
      if (cancelRequested) break;
      completedRuns = totalRuns;
      break;
    }

    const mazeBundle = getMazeFromCache(batch[0], assignmentType, mazeCache);
    const { grid } = mazeBundle;

    const runners = batch.map((run) =>
      prepareRunner(run, mazeBundle, assignmentType, newMazeEachRun, false)
    );

    const isMulti = batch.length > 1;
    mazeTitle.textContent = isMulti ? "All turtles — shared maze" : "Maze run";

    if (isMulti) {
      const phaseNote =
        assignmentType === "matched" ? ` · Phase ${batch[0].phase}` : "";
    } else {
      const r = runners[0];
      const run = r.run;
    }

    statusEl.textContent = `Running ${completedRuns + 1}–${completedRuns + batch.length} / ${totalRuns}…`;

    drawMaze(mazeCanvas.getContext("2d"), grid, {
      cellSize: mazeBundle.cellSize,
      padding: mazeBundle.padding,
    });

    let finishedInBatch = 0;

    const times = await animateMazeRuns(
      mazeCanvas,
      grid,
      runners.map((r) => ({
        path: r.path,
        completionTime: r.completionTime,
        fur: r.fur,
        hasDrug: r.hasDrug,
        group: r.run.group,
        clutch: r.run.turtle.clutch,
        turtleId: r.run.turtle.id,
      })),
      {
        cellSize: mazeBundle.cellSize,
        padding: mazeBundle.padding,
        animTimeScale: CONFIG.animTimeScale,
        shouldSkip: () => fastForwardRequested,
        isCancelled: () => cancelRequested,
        // finishedStates can hold more than one turtle when several cross the
        // finish line on the same animation frame (common with a large,
        // shared-maze sample) — batching them into one ingest + one chart
        // refresh, instead of one each, avoids re-rendering the histograms
        // dozens of times per frame.
        onRunnerFinish: (finishedStates) => {
          finishedInBatch += finishedStates.length;
          ingestRunRecords(
            finishedStates.map((s) => ({
              group: s.group,
              time: s.completionTime,
              clutch: s.clutch,
              turtleId: s.turtleId,
            })),
            assignmentType
          );
          if (isMulti) {
            statusEl.textContent =
              `Running batch ${completedRuns + finishedInBatch}/${totalRuns} · ` +
              `${finishedInBatch}/${batch.length} turtles finished this maze…`;
          }
          refreshSummary(assignmentType, newMazeEachRun);
        },
      }
    );

    if (times === null || cancelRequested) {
      break batchLoop;
    }

    if (assignmentType === "matched" && batch[0].phase === 1 && !newMazeEachRun) {
      for (const r of runners) rememberPath(r.path);
    }

    completedRuns += batch.length;
    refreshSummary(assignmentType, newMazeEachRun);

    if (fastForwardRequested) {
      const remaining = runs.slice(completedRuns);
      if (remaining.length > 0) {
        await bulkSimulateRuns(remaining, assignmentType, newMazeEachRun, mazeCache);
      }
      if (cancelRequested) break;
      completedRuns = totalRuns;
      break;
    }

    if (completedRuns < totalRuns) {
      await sleep(CONFIG.pauseBetweenRuns);
    }
  }

  isRunning = false;
  fastForwardRequested = false;
  let index = assignmentType === "random" ? 0 : assignmentType === "block" ? 1 : 2;
  if (diffRecords[index][0] !== sampleSize) {
    diffRecords[index] = [sampleSize];
  }
  diffRecords[index].push(getCurrentDiff());
  if (chartMode === "multi") {
    histograms.syncFromRecords(diffRecords, assignmentType);
  }
  console.log("All diffs recorded:", diffRecords);
  setControlsEnabled(true);

  if (cancelRequested) {
    cancelRequested = false;
    resetAll();
    return;
  }

  statusEl.textContent = `Done! ${totalRuns} runs completed.`;
}

function resetAll() {
  finishedRecords = [];
  mazeMemory = new Set();
  resetPairTracker();
  histograms.reset();
  if (!cancelRequested) {
    diffRecords = [[], [], []];
  }

  resetPValueAndSummary();
  statusEl.textContent = "Ready. Choose settings and click Run simulation.";

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
    cancelRequested = false;
    setControlsEnabled(true);
  });
});

resetBtn.addEventListener("click", () => {
  if (isRunning) {
    cancelRequested = true;
    if (chartMode === "multi") {
      multiRunCancelRequested = true;
    }
    statusEl.textContent = "Cancelling…";
    return;
  }
  resetAll();
});

fastForwardBtn.addEventListener("click", () => {
  if (!isRunning) return;
  fastForwardRequested = true;
  fastForwardBtn.disabled = true;
  statusEl.textContent = "Fast-forwarding…";
});

document.querySelectorAll('input[name="assignment"]').forEach((el) => {
  el.addEventListener("change", () => {
    if (!isRunning) setupCharts(getAssignmentType(), randomMazeEachRun());
    resetPValueAndSummary();
    if (chartMode === "multi") {
      histograms.syncFromRecords(diffRecords, getAssignmentType());
    }
  });
});

chartButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (isRunning) return;
    chartMode = button.dataset.mode;
    setupCharts(getAssignmentType(), randomMazeEachRun());
    refreshSummary(getAssignmentType(), randomMazeEachRun());
  });
});

randomMazeToggle.addEventListener("change", () => {
  updateFastForwardButton();
  resetAll();
  if (!isRunning) setupCharts(getAssignmentType(), randomMazeEachRun());
});

function buildClutchLegend() {
  const list = document.getElementById("clutch-legend");
  list.innerHTML = CLUTCH_FUR.map(
    (fur, i) =>
      `<li><span class="swatch fur" style="background:${fur.fur}"></span> Clutch ${i + 1} — ${fur.name}</li>`
  ).join("");
}

function resetPValueAndSummary() {
  pvalueEl.textContent = "";
  if (chartMode !== "multi") {
    summaryEl.textContent = "";
  } else {
    renderRunCountBox();
  }
}

buildClutchLegend();
updateFastForwardButton();
resetAll();