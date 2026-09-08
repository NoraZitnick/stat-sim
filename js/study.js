/**
 * study.js — Mice, assignments, Gaussian completion times
 */

import {
  CONFIG,
  LITTER_FUR,
  GROUP_RING,
  randomNormal,
  shuffle,
  round1,
  mean,
} from "./config.js";

function createLitterSpeedMeans() {
  const means = [];
  for (let i = 0; i < CONFIG.numLitters; i++) {
    means.push(CONFIG.baseSpeed + randomNormal(0, CONFIG.litterSpeedSpread));
  }
  return means;
}

export function createMice(sampleSize) {
  const litterSpeedMeans = createLitterSpeedMeans();
  const mice = [];

  for (let i = 0; i < sampleSize; i++) {
    const litter = i % CONFIG.numLitters;
    const baseSpeed =
      litterSpeedMeans[litter] + randomNormal(0, CONFIG.individualSpeedSpread);

    mice.push({
      id: i + 1,
      litter,
      baseSpeed: Math.max(1.5, baseSpeed),
      fur: LITTER_FUR[litter],
    });
  }
  return mice;
}

/**
 * Gaussian completion time — bell-curve results.
 * Speed/path only add a tiny adjustment; same model for all assignment types.
 */
export function computeRunMetrics(mouse, opts, pathLengthHint = null) {
  const { hasDrug, isRepeatMaze, assignmentType } = opts;

  let speed = mouse.baseSpeed;
  if (hasDrug) speed *= CONFIG.drugSpeedMultiplier + randomNormal(0, CONFIG.drugSpeedNoise);
  if (isRepeatMaze) speed *= CONFIG.learningMultiplier + randomNormal(0, CONFIG.learningNoise);
  speed *= 1 + randomNormal(0, CONFIG.runSpeedNoise);
  speed = Math.max(0.8, speed);

  const litterShift = CONFIG.litterTimeShift[mouse.litter] ?? 0;
  const spread = CONFIG.timeStdDev + CONFIG.designTimeSpread[assignmentType];

  let time = CONFIG.timeMean + randomNormal(0, spread) + litterShift;

  if (hasDrug) {
    time -= CONFIG.drugTimeReduction + randomNormal(0, CONFIG.drugTimeNoise);
  }

  if (isRepeatMaze) {
    time -= CONFIG.learningTimeReduction + randomNormal(0, CONFIG.learningTimeNoise);
  }

  if (pathLengthHint != null) {
    time += randomNormal(0, 0.35) * Math.max(0, pathLengthHint - 50) * 0.02;
  }

  return {
    speed: round1(speed),
    completionTime: round1(Math.max(10, time)),
  };
}

export function buildExperiment(mice, assignmentType) {
  switch (assignmentType) {
    case "random": return buildRandomAssignment(mice);
    case "block": return buildBlockAssignment(mice);
    case "matched": return buildMatchedPairs(mice);
    default: throw new Error(`Unknown assignment: ${assignmentType}`);
  }
}

/** Exactly half the mice get drug (rounded to nearest mouse). */
export function drugGroupCount(total) {
  return Math.round(total / 2);
}

function buildRandomAssignment(mice) {
  const shuffled = shuffle([...mice]);
  const nDrug = drugGroupCount(shuffled.length);

  return shuffle(
    shuffled.map((mouse, index) => {
      const hasDrug = index < nDrug;
      return makeRun(mouse, hasDrug, "random", {
        phase: 1,
        group: hasDrug ? "drug" : "control",
      });
    })
  );
}

function buildBlockAssignment(mice) {
  const runs = [];
  for (let litter = 0; litter < CONFIG.numLitters; litter++) {
    const inLitter = mice.filter((m) => m.litter === litter);
    const shuffled = shuffle([...inLitter]);
    const nDrug = drugGroupCount(shuffled.length);

    shuffled.forEach((mouse, index) => {
      const hasDrug = index < nDrug;
      runs.push(
        makeRun(mouse, hasDrug, "block", {
          phase: 1,
          group: hasDrug ? "drug" : "control",
        })
      );
    });
  }
  return shuffle(runs);
}

function buildMatchedPairs(mice) {
  const shuffled = shuffle([...mice]);
  const half = Math.floor(shuffled.length / 2);
  const runs = [];

  shuffled.forEach((mouse, index) => {
    const drugFirst = index < half;
    if (drugFirst) {
      runs.push(makeRun(mouse, true, "matched", { phase: 1, group: "drug", pairOrder: "drug-first" }));
      runs.push(makeRun(mouse, false, "matched", { phase: 2, group: "control", pairOrder: "drug-first" }));
    } else {
      runs.push(makeRun(mouse, false, "matched", { phase: 1, group: "control", pairOrder: "control-first" }));
      runs.push(makeRun(mouse, true, "matched", { phase: 2, group: "drug", pairOrder: "control-first" }));
    }
  });

  return runs;
}

function makeRun(mouse, hasDrug, assignmentType, meta) {
  return {
    mouse,
    hasDrug,
    assignmentType,
    ringColor: hasDrug ? GROUP_RING.drug : GROUP_RING.control,
    fur: mouse.fur,
    ...meta,
  };
}

/**
 * Batch runs for animation.
 * Shared maze (toggle off): all mice together; matched = phase 1 batch then phase 2 batch.
 */
export function groupRunBatches(runs, assignmentType, randomMazeEachRun) {
  if (!randomMazeEachRun) {
    if (assignmentType === "matched") {
      const phase1 = runs.filter((r) => r.phase === 1);
      const phase2 = runs.filter((r) => r.phase === 2);
      return [phase1, phase2].filter((b) => b.length > 0);
    }
    return [runs];
  }
  return runs.map((run) => [run]);
}

export function getMazeKey(run, assignmentType, randomMazeEachRun) {
  if (randomMazeEachRun) {
    return `run-${run.mouse.id}-${run.phase ?? 1}-${Math.random().toString(36).slice(2, 9)}`;
  }
  return "shared-maze";
}

export function usesBlockCharts(assignmentType) {
  return assignmentType === "block";
}

export function usesMatchedDifference(assignmentType) {
  return assignmentType === "matched";
}

export function summarizeResults(records, assignmentType, randomMazeEachRun) {
  if (assignmentType === "matched") {
    const diffs = records.filter((r) => r.type === "difference").map((r) => r.time);
    if (diffs.length === 0) return "Waiting for paired differences…";

    const meanDiff = round1(mean(diffs));
    const learningNote =
      !randomMazeEachRun
        ? " Same maze reused — 2nd runs include a learning effect (not from the drug)."
        : "";

    return (
      `Mean paired difference: ${meanDiff}s (control − drug). ` +
      "Positive values mean the drug group was faster. " +
      "Matched pairs chart each mouse's difference, not separate runs." +
      learningNote
    );
  }

  const controlTimes = records.filter((r) => r.group === "control").map((r) => r.time);
  const drugTimes = records.filter((r) => r.group === "drug").map((r) => r.time);

  if (controlTimes.length === 0 || drugTimes.length === 0) {
    return "Waiting for data…";
  }

  const controlMean = round1(mean(controlTimes));
  const drugMean = round1(mean(drugTimes));
  const diff = round1(controlMean - drugMean);

  const messages = {
    random:
      `Control mean: ${controlMean}s · Drug mean: ${drugMean}s · Difference: ${diff}s. ` +
      "Stacked bars: drug (green, bottom), control (gray, top). " +
      "Random assignment can let litter differences confound the drug effect.",
    block:
      `Control mean: ${controlMean}s · Drug mean: ${drugMean}s · Difference: ${diff}s. ` +
      "Each litter chart stacks drug (bottom) and control (top) for easy comparison.",
  };

  return messages[assignmentType] ?? "";
}

export function getChartLabels(assignmentType, randomMazeEachRun) {
  if (assignmentType === "block") {
    return {
      mode: "block",
      caption:
        "One chart per litter. Green (bottom) = drug, gray (top) = control, stacked in each time bin.",
    };
  }

  if (assignmentType === "matched") {
    const mazeNote = randomMazeEachRun
      ? "Each run uses a new maze."
      : "All mice run together on the same maze — 2nd phase is faster from practice.";
    return {
      mode: "difference",
      caption:
        `Each mouse contributes one bar: (control time − drug time). ${mazeNote} ` +
        "Positive = drug was faster.",
    };
  }

  return {
    mode: "stacked",
    caption:
      "Stacked histogram: green (bottom) = drug, gray (top) = control. " +
      (randomMazeEachRun
        ? "New maze each run — use Fast forward for large samples."
        : "Same maze — all mice run together."),
  };
}
