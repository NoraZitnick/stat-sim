/**
 * app.js — Main controller
 */

import { CONFIG, getCreatureBlocks, GROUP_COLORS, round1 } from "./config.js";
import {
  exploreMazePath,
  fitCanvas,
  drawMaze,
  animateMazeRuns,
  createMazeBundle,
} from "./maze.js";
import {
  createIndividuals,
  buildExperiment,
  computeRunMetrics,
  getMazeKey,
  groupRunBatches,
  summarizeResults,
  getBlockDifferences,
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
const statusEl = document.getElementById("status");
const mazeCanvas = document.getElementById("maze-canvas");
const mazeTitle = document.getElementById("maze-title");
const chartCaption = document.getElementById("chart-caption");
const summaryEl = document.getElementById("summary");
const pvalueEl = document.getElementById("pvalue");
const chartsGrid = document.getElementById("charts-grid");
const chartButtons = document.querySelectorAll(".chart-button");

const CREATURE_OPTIONS = {
  mice: {
    label: "Mice",
    singular: "mouse",
    plural: "mice",
    matchedLabel: "Matched pairs (each mouse runs twice)",
    grouping: "litter",
    groupingLabel: "Litter",
    groupingLabelPlural: "Litters",
    title: "Maze Mouse Drug Study",
    sampleLabel: "Sample size (number of mice)",
    caption: "Histograms update as each mouse finishes.",
    blockAssignmentLabel: "Block assignment (by litter)",
  },
  turtles: {
    label: "Turtles",
    singular: "turtle",
    plural: "turtles",
    matchedLabel: "Matched pairs (each turtle runs twice)",
    grouping: "clutch",
    groupingLabel: "Clutch",
    groupingLabelPlural: "Clutches",
    title: "Maze Turtle Drug Study",
    sampleLabel: "Sample size (number of turtles)",
    caption: "Histograms update as each turtle finishes.",
    blockAssignmentLabel: "Block assignment (by clutch)",
  },
  ants: {
    label: "Ants",
    singular: "ant",
    plural: "ants",
    matchedLabel: "Matched pairs (each ant runs twice)",
    grouping: "colony",
    groupingLabel: "Colony",
    groupingLabelPlural: "Colonies",
    title: "Maze Ant Drug Study",
    sampleLabel: "Sample size (number of ants)",
    caption: "Histograms update as each ant finishes.",
    blockAssignmentLabel: "Block assignment (by colony)",
  },
};

const appState = {
  creature: "mice",
};

window.MAZE_APP = window.MAZE_APP || {};
window.MAZE_APP.creature = appState.creature;

function getCreatureOption(choice = appState.creature) {
  return CREATURE_OPTIONS[choice] ?? CREATURE_OPTIONS.mice;
}

function updateCreatureUi(choice) {
  const option = getCreatureOption(choice);
  const heading = document.querySelector("header h1");
  const sampleLabel = document.getElementById("sample-size-label");
  const chartCaptionText = document.getElementById("chart-caption");
  const blockAssignmentLabel = document.getElementById("block-assignment-label");
  const matchedAssignmentLabel = document.querySelector('input[name="assignment"][value="matched"] + span strong');
  const controlMarkingSwatch = document.getElementById("control-marking-swatch");
  const drugMarkingSwatch = document.getElementById("drug-marking-swatch");
  const controlMarkingLabel = document.getElementById("control-marking-label");
  const drugMarkingLabel = document.getElementById("drug-marking-label");
  const markingColors = GROUP_COLORS[option.singular];

  appState.creature = choice;
  window.MAZE_APP.creature = choice;

  if (heading) {
    heading.textContent = option.title;
  }

  if (sampleLabel) {
    sampleLabel.textContent = option.sampleLabel;
  }

  if (chartCaptionText) {
    chartCaptionText.textContent = option.caption;
  }

  if (blockAssignmentLabel) {
    blockAssignmentLabel.textContent = option.blockAssignmentLabel;
  }

  if (matchedAssignmentLabel) {
    matchedAssignmentLabel.textContent = option.matchedLabel;
  }

  const markingName = choice === "mice" ? "collar" : "marking";
  if (controlMarkingSwatch && drugMarkingSwatch) {
    controlMarkingSwatch.style.backgroundColor = markingColors.control;
    drugMarkingSwatch.style.backgroundColor = markingColors.drug;
  }
  if (controlMarkingLabel && drugMarkingLabel) {
    const controlColor = "Gray";
    const drugColor = choice === "mice" ? "Green" : "Orange";
    controlMarkingLabel.textContent = `${controlColor} ${markingName} = control`;
    drugMarkingLabel.textContent = `${drugColor} ${markingName} = drug`;
  }

  if (document.getElementById("block-legend")) {
    buildBlockLegend();
  }

  document.title = option.title + " — AP Stats Simulation";

  resetAll();
}

function initializeCreatureChooser() {
  const modal = document.getElementById("creature-modal");
  const chooserButtons = document.querySelectorAll(".creature-option");

  const revealSelection = (choice) => {
    chooserButtons.forEach((button) => {
      const isSelected = button.dataset.creature === choice;
      button.classList.toggle("is-selected", isSelected);
    });

    updateCreatureUi(choice);
    if (modal) {
      modal.classList.add("is-hidden");
    }
  };

  chooserButtons.forEach((button) => {
    button.addEventListener("click", () => revealSelection(button.dataset.creature));
  });

  updateCreatureUi(appState.creature);
  if (modal) {
    modal.classList.remove("is-hidden");
  }
}

let isRunning = false;
let fastForwardRequested = false;
let cancelRequested = false;
let multiRunCancelRequested = false;
let finishedRecords = [];
const latestRunRecords = new Map();
let diffRecords = [[], [], []];
let chartMode = "run";
let histograms = createChartManager("random", chartsGrid, chartMode, diffRecords);
let mazeMemory = new Set();
let displayedMazeBundle = null;
/** Tracks control & drug times per individual for matched pairs */
const pairTracker = new Map();

function resetPairTracker() {
  pairTracker.clear();
}

function tryCompletePair(individualId, group, time, block) {
  if (!pairTracker.has(individualId)) {
    pairTracker.set(individualId, { control: null, drug: null, block, charted: false });
  }
  const p = pairTracker.get(individualId);
  p[group] = time;
  p.block = block;

  if (p.control != null && p.drug != null && !p.charted) {
    p.charted = true;
    return {
      type: "difference",
      time: round1(p.control - p.drug),
      individualId,
      block,
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
      const diffRec = tryCompletePair(rec.individualId, rec.group, rec.time, rec.block);
      if (diffRec) {
        finishedRecords.push(diffRec);
        newDiffs.push(diffRec.time);
      }
    }
    if (newDiffs.length === 1) {
      histograms.addDifference(newDiffs[0] * CONFIG.animTimeScale);
    } else if (newDiffs.length > 1) {
      histograms.addDifferencesBatch(newDiffs.map((difference) => difference * CONFIG.animTimeScale));
    }
    return;
  }

  finishedRecords.push(...records);
  const plottedRecords = records.map((record) => ({
    ...record,
    time: record.time * CONFIG.animTimeScale,
  }));

  if (plottedRecords.length > 10) {
    histograms.addResultsBatch(plottedRecords);
  } else if (usesBlockCharts(assignmentType)) {
    plottedRecords.forEach((rec) => histograms.addResult(rec.group, rec.time, rec.block));
  } else {
    plottedRecords.forEach((rec) => histograms.addResult(rec.group, rec.time));
  }
}

function getAssignmentType() {
  return document.querySelector('input[name="assignment"]:checked').value;
}

function getRunRecordsKey(assignmentType) {
  return `${appState.creature}:${assignmentType}`;
}

function restoreLatestRun(assignmentType) {
  if (chartMode === "multi") return;
  const records = latestRunRecords.get(getRunRecordsKey(assignmentType));
  finishedRecords = records ? records.map((record) => ({ ...record })) : [];
  if (!records) return;

  if (usesMatchedDifference(assignmentType)) {
    histograms.addDifferencesBatch(
      finishedRecords.map((record) => record.time * CONFIG.animTimeScale)
    );
  } else {
    histograms.addResultsBatch(finishedRecords.map((record) => ({
      ...record,
      time: record.time * CONFIG.animTimeScale,
    })));
  }
  refreshSummary(assignmentType, randomMazeEachRun());
}

function randomMazeEachRun() {
  return randomMazeToggle.checked;
}

function updateFastForwardButton() {
  runBtn.textContent = !isRunning
    ? "Run simulation"
    : fastForwardRequested
      ? "Fast-forwarding…"
      : "Fast forward";
  runBtn.classList.toggle("primary", !isRunning);
  runBtn.classList.toggle("fast-forward", isRunning);
  runBtn.disabled = isRunning && fastForwardRequested;
}

function setControlsEnabled(enabled) {
  updateFastForwardButton();
  sampleSizeInput.disabled = !enabled;
  randomMazeToggle.disabled = !enabled;
  document.querySelectorAll('input[name="assignment"]').forEach((el) => {
    el.disabled = !enabled;
  });
  chartButtons.forEach((button) => {
    button.disabled = !enabled || isRunning;
  });
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
    histograms.setAssignment(assignmentType, getCreatureOption().singular);
    chartCaption.textContent = "";
    chartCaption.style.display = "block";
    renderRunCountBox();
  } else {
    histograms.destroy();
    histograms = createChartManager(assignmentType, chartsGrid, chartMode, diffRecords, getCreatureOption().singular);
    chartCaption.textContent = getChartLabels(assignmentType, newMazeEachRun).caption;
    chartCaption.style.display = "block";
  }
  updateChartButtons();
}

function refreshSummary(assignmentType, newMazeEachRun) {
  let text = summarizeResults(finishedRecords, assignmentType, newMazeEachRun);
  if (chartMode !== "multi") {
    summaryEl.innerHTML = text;
    pvalueEl.innerHTML = describeSignificance(finishedRecords, assignmentType);
  }
  if (chartMode === "multi") {
    pvalueEl.innerHTML = "";
    histograms.syncFromRecords(diffRecords, assignmentType);
    renderRunCountBox();
  }
}

function renderRunCountBox() {
    summaryEl.innerHTML = "";
    let label = document.createElement("label");
    label.className = "multi-run-count-field";
    let runCountBox = document.createElement("input");
    runCountBox.type = "number";
    runCountBox.min = 1;
    runCountBox.max = 1000;
    runCountBox.id = "multi-run-count";
    runCountBox.step = 2;

    runCountBox.addEventListener("change", () => {
      addRuns(parseInt(runCountBox.value, 0));
    });
      const runCounts = histograms.getFasterRunCounts();
      const runSummaries = runCounts
        .filter(({ total }) => total > 0)
        .map(({ title, total, faster }) => {
          const percent = Math.round((faster / total) * 100);
          const scope = title === "Recorded run differences"
            ? "runs"
            : `${title.replace(" block differences", " block")} runs`;
          return `In <b>${percent}%</b> of ${scope}, drugged ${getCreatureOption().plural} were faster.`;
        });
      if (runSummaries.length > 0) {
        const summary = document.createElement("p");
        summary.className = "multi-run-summary-text";
        summary.innerHTML = runSummaries.join("\n");
        summaryEl.appendChild(summary);
      }
    label.appendChild(runCountBox);
    summaryEl.appendChild(label);
    runCountBox.insertAdjacentHTML('afterend', '<span class="side-text"> experiments to graph</span>');
    runCountBox.insertAdjacentHTML('beforebegin', '<span class="side-text"> Add </span>');
}

async function addRuns(runs) {
  const count = Number.parseInt(runs, 0);
  if (!Number.isFinite(count) || count <= 0) return;
  drawMazeWithoutRunners();
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
  drawMazeWithoutRunners();
}

function getMazeFromCache(run, assignmentType, cache) {
  const key = getMazeKey(run, assignmentType, randomMazeEachRun());
  if (!cache.has(key)) {
    const { mazeCols, mazeRows } = CONFIG;
    cache.set(key, createMazeBundle(mazeCols, mazeRows));
  }
  return cache.get(key);
}

function drawMazeWithoutRunners(mazeBundle = displayedMazeBundle) {
  if (!mazeBundle) return;
  const expectedWidth = mazeBundle.padding * 2 + mazeBundle.grid[0].length * mazeBundle.cellSize;
  const expectedHeight = mazeBundle.padding * 2 + mazeBundle.grid.length * mazeBundle.cellSize;
  if (mazeCanvas.width !== expectedWidth || mazeCanvas.height !== expectedHeight) {
    fitCanvas(mazeCanvas, mazeBundle.grid[0].length, mazeBundle.grid.length, mazeBundle.cellSize, mazeBundle.padding);
  }
  drawMaze(mazeCanvas.getContext("2d"), mazeBundle.grid, getCreatureOption().singular, {
    cellSize: mazeBundle.cellSize,
    padding: mazeBundle.padding,
  });
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

function prepareRunner(run, mazeBundle, assignmentType, newMazeEachRun) {
  const { grid, start, end } = mazeBundle;

  const isRepeatMaze = false;

  const knownCells = isRepeatMaze ? mazeMemory : null;

  const path = exploreMazePath(grid, start, end, knownCells);

  const metrics = computeRunMetrics(run.individual, {
    hasDrug: run.hasDrug,
    isRepeatMaze,
    assignmentType,
    newMazeEachRun,
  });

  // Displayed speed is derived FROM the path and the time, after the fact —
  // it's just cells-per-second, not a separate random number. That keeps it
  // honest: a individual that finishes faster will always show a higher speed,
  // because that's literally how it's computed.
  const speed = round1(path.length / metrics.completionTime);

  return {
    run,
    path,
    completionTime: metrics.completionTime,
    speed,
    fur: run.fur,
    shellColor: run.individual.shellColor,
    limbColor: run.individual.limbColor,
    antColor: run.individual.antColor,
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
    const runner = prepareRunner(run, mazeBundle, assignmentType, newMazeEachRun);
    pending.push({
      group: runner.run.group,
      time: runner.completionTime,
      block: runner.run.individual.block,
      individualId: runner.run.individual.id,
    });

    if (pending.length >= batchSize || i === runs.length - 1) {
      ingestRunRecords(pending, assignmentType);
      pending = [];

      statusEl.textContent = `Fast-forward: ${i + 1} / ${runs.length} runs simulated…`;
      refreshSummary(assignmentType, newMazeEachRun);
      await new Promise((resolve) => setTimeout(resolve, 0));
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

  const individuals = createIndividuals(sampleSize, getCreatureOption().singular);
  const runs = buildExperiment(individuals, assignmentType);
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
    displayedMazeBundle = mazeBundle;
    const { grid } = mazeBundle;

    const runners = batch.map((run) =>
      prepareRunner(run, mazeBundle, assignmentType, newMazeEachRun)
    );

    const isMulti = batch.length > 1;
    mazeTitle.textContent = isMulti ? `All ${getCreatureOption().plural} — shared maze` : "Maze run";

    if (isMulti) {
      const phaseNote =
        assignmentType === "matched" ? ` · Phase ${batch[0].phase}` : "";
    } else {
      const r = runners[0];
      const run = r.run;
    }

    statusEl.textContent = `Running ${completedRuns + 1}–${completedRuns + batch.length} / ${totalRuns}…`;

    drawMaze(mazeCanvas.getContext("2d"), grid, getCreatureOption().singular, {
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
        shellColor: r.shellColor,
        limbColor: r.limbColor,
        antColor: r.antColor,
        hasDrug: r.hasDrug,
        group: r.run.group,
        block: r.run.individual.block,
        individualId: r.run.individual.id,
      })),
      {
        cellSize: mazeBundle.cellSize,
        padding: mazeBundle.padding,
        animTimeScale: CONFIG.animTimeScale,
        shouldSkip: () => fastForwardRequested,
        isCancelled: () => cancelRequested,
        // finishedStates can hold more than one individual when several cross the
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
              block: s.block,
              individualId: s.individualId,
            })),
            assignmentType
          );
          if (isMulti) {
            statusEl.textContent =
              `Running batch ${completedRuns + finishedInBatch}/${totalRuns} · ` +
                `${finishedInBatch}/${batch.length} ${getCreatureOption().plural} finished this maze…`;
          }
          refreshSummary(assignmentType, newMazeEachRun);
        },
      },
      getCreatureOption().singular
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
  diffRecords[index].push(
    assignmentType === "block" ? getBlockDifferences(finishedRecords) : getCurrentDiff()
  );
  if (chartMode === "multi") {
    histograms.syncFromRecords(diffRecords, assignmentType, getCreatureOption().singular);
    renderRunCountBox();
  }
  console.log("All diffs recorded:", diffRecords);
  setControlsEnabled(true);

  if (cancelRequested) {
    cancelRequested = false;
    resetAll();
    return;
  }

  latestRunRecords.set(
    getRunRecordsKey(assignmentType),
    finishedRecords.map((record) => ({ ...record }))
  );

  statusEl.textContent = `Done! ${totalRuns} runs completed.`;
}

function resetAll() {
  latestRunRecords.clear();
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
  displayedMazeBundle = bundle;
  drawMaze(mazeCanvas.getContext("2d"), bundle.grid, getCreatureOption().singular, {
    cellSize: bundle.cellSize,
    padding: bundle.padding,
  });
}

runBtn.addEventListener("click", () => {
  if (isRunning) {
    requestFastForward();
    return;
  }
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

function requestFastForward() {
  if (!isRunning || fastForwardRequested) return;
  fastForwardRequested = true;
  drawMazeWithoutRunners();
  updateFastForwardButton();
  statusEl.textContent = "Fast-forwarding…";
}

document.querySelectorAll('input[name="assignment"]').forEach((el) => {
  el.addEventListener("change", () => {
    resetPValueAndSummary();
    if (!isRunning) {
      setupCharts(getAssignmentType(), randomMazeEachRun());
      restoreLatestRun(getAssignmentType());
    }
    if (chartMode === "multi") {
      histograms.syncFromRecords(diffRecords, getAssignmentType());
      renderRunCountBox();
    }
  });
});

chartButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (isRunning) return;
    chartMode = button.dataset.mode;
    setupCharts(getAssignmentType(), randomMazeEachRun());
    restoreLatestRun(getAssignmentType());
    refreshSummary(getAssignmentType(), randomMazeEachRun());
  });
});

randomMazeToggle.addEventListener("change", () => {
  updateFastForwardButton();
  resetAll();
  if (!isRunning) setupCharts(getAssignmentType(), randomMazeEachRun());
});

function buildBlockLegend() {
  const list = document.getElementById("block-legend");
  const option = getCreatureOption();
  const groupLabel = option.groupingLabel;
  const entries = getCreatureBlocks(option.singular);
  list.innerHTML = entries.map(
    (entry, i) =>
      `<li><span class="swatch fur" style="background:${entry.color}"></span> ${groupLabel} ${i + 1} — ${entry.name}</li>`
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

buildBlockLegend();
initializeCreatureChooser();
updateFastForwardButton();
resetAll();