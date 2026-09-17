/**
 * study.js — Mice, group assignment, and the completion-time model.
 *
 * This file answers two separate questions:
 *   1. createMice / buildExperiment — WHO runs the maze, and which group
 *      (drug or control) each run belongs to. This is the "experimental
 *      design" part — it's where random / block / matched pairs differ.
 *   2. computeRunMetrics — HOW LONG that run takes. Every run's time is one
 *      random draw from a bell curve, nudged by whichever real effects and
 *      confounds apply (drug, litter, practice). The maze itself is just
 *      for show — pathfinding does not feed back into this number, so the
 *      statistics stay easy to reason about.
 */

import { CONFIG, LITTER_FUR, GROUP_RING, randomNormal, shuffle, round1, mean } from "./config.js";
import { welchTTest, pairedTTest } from "./inference.js";

export function createMice(sampleSize) {
  const mice = [];
  for (let i = 0; i < sampleSize; i++) {
    const litter = i % CONFIG.numLitters;
    mice.push({ id: i + 1, litter, fur: LITTER_FUR[litter] });
  }
  return mice;
}

/**
 * Draws this run's completion time from a normal distribution, then applies
 * whichever real effects and confounds apply to this particular run:
 *   - litter shift    → a confound (see CONFIG.litterTimeShift)
 *   - drug effect     → the true effect the study is trying to detect
 *   - practice effect → a confound specific to matched pairs on a reused maze
 * `opts.assignmentType` and `opts.newMazeEachRun` only affect how much NOISE
 * is added (spread), not the mean — that's what makes some designs more
 * reliable than others at revealing the same true drug effect.
 */
export function computeRunMetrics(mouse, opts) {
  const { hasDrug, isRepeatMaze, assignmentType, newMazeEachRun } = opts;

  const litterShift = CONFIG.litterTimeShift[mouse.litter] ?? 0;
  const mazeSpread = newMazeEachRun ? CONFIG.newMazeSpread : 0;
  const spread = CONFIG.timeStdDev + CONFIG.designTimeSpread[assignmentType] + mazeSpread;

  let time = randomNormal(CONFIG.timeMean, spread) + litterShift;

  if (hasDrug) {
    time -= CONFIG.drugTimeReduction + randomNormal(0, CONFIG.drugTimeNoise);
  }

  if (isRepeatMaze) {
    time -= CONFIG.learningTimeReduction + randomNormal(0, CONFIG.learningTimeNoise);
  }

  time = Math.min(CONFIG.timeCeiling, Math.max(CONFIG.timeFloor, time));

  return { completionTime: round1(time) };
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

/**
 * Random assignment: shuffle everyone, then the first half get the drug.
 * Because litter isn't accounted for, a shuffle can (by chance) put more
 * of one litter in one group than the other — that's the confounding this
 * design is vulnerable to.
 */
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

/**
 * Block assignment: shuffle and split each litter separately, so every
 * litter is represented equally in both groups. This is what "blocking"
 * means — the confounding variable (litter) can no longer pile up
 * unevenly in one group, whatever else happens.
 */
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

/**
 * Matched pairs: every mouse runs TWICE, once with the drug and once
 * without — so each mouse acts as its own control. Whether a given mouse
 * gets the drug first or second is randomized, so any practice/order
 * effect (see learningTimeReduction) isn't stacked onto one group.
 */
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
    random: `Control mean: ${controlMean}s · Drug mean: ${drugMean}s · Difference: ${diff}s.`,
    block:
      `Control mean: ${controlMean}s · Drug mean: ${drugMean}s · Difference: ${diff}s. ` +
      "Top row: drug, one chart per litter. Bottom row: control, same litters.",
  };

  return messages[assignmentType] ?? "";
}

function formatPValue(p) {
  const clamped = Math.max(0, Math.min(1, p));
  const pText = clamped < 0.001 ? "< 0.001" : String(Math.round(clamped * 1000) / 1000);
  const pctText = clamped < 0.001 ? "< 0.1" : `${Math.round(clamped * 1000) / 10}`;
  const verdict =
    clamped < 0.05
      ? "below the usual 0.05 cutoff — likely a real effect"
      : "above the usual 0.05 cutoff — easily explained by chance";

  return (
    `P = ${pText} — if the drug truly had no effect, a difference at least this large ` +
    `would happen by random chance about ${pctText}% of the time (${verdict}).`
  );
}

/**
 * How likely the observed difference is under pure chance (no real drug effect):
 * a Welch two-sample t-test for random/block, a paired t-test for matched pairs.
 */
export function describeSignificance(records, assignmentType) {
  if (assignmentType === "matched") {
    const diffs = records.filter((r) => r.type === "difference").map((r) => r.time);
    if (diffs.length < 2) return "P = — (need at least 2 pairs to compute)";
    const result = pairedTTest(diffs);
    return result ? formatPValue(result.p) : "";
  }

  const controlTimes = records.filter((r) => r.group === "control").map((r) => r.time);
  const drugTimes = records.filter((r) => r.group === "drug").map((r) => r.time);
  if (controlTimes.length < 2 || drugTimes.length < 2) {
    return "P = — (need at least 2 mice per group to compute)";
  }

  const result = welchTTest(drugTimes, controlTimes);
  return result ? formatPValue(result.p) : "";
}

export function getChartLabels(assignmentType, randomMazeEachRun) {
  if (assignmentType === "block") {
    return {
      mode: "block",
      caption:
        "Top row = drug, bottom row = control, one column per litter — " +
        "compare litters left-to-right, or drug vs. control top-to-bottom.",
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
    caption: "",
  };
}
