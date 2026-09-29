/**
 * study.js — Individuals, group assignment, and the completion-time model.
 *
 * This file answers two separate questions:
 *   1. createIndividuals / buildExperiment — WHO runs the maze, and which group
 *      (drug or control) each run belongs to. This is the "experimental
 *      design" part — it's where random / block / matched pairs differ.
 *   2. computeRunMetrics — HOW LONG that run takes. Every run's time is one
 *      random draw from a bell curve, nudged by whichever real effects and
 *      confounds apply (drug, block, practice). The maze itself is just
 *      for show — pathfinding does not feed back into this number, so the
 *      statistics stay easy to reason about.
 */

import { CONFIG, BLOCK_FUR, TURTLE_SHELLS, ANT_COLONIES, GROUP_COLORS, randomNormal, shuffle, round1, mean } from "./config.js";
import { welchTTest, pairedTTest } from "./inference.js";

let currentDiff = 0;

function getCreatureGroupMeta() {
  const creature = window.MAZE_APP?.creature ?? "mice";
  const map = {
    mice: { label: "Litter", plural: "Litters", unit: "mouse", units: "mice" },
    turtles: { label: "Clutch", plural: "Clutches", unit: "turtle", units: "turtles" },
    ants: { label: "Colony", plural: "Colonies", unit: "ant", units: "ants" },
  };
  return map[creature] ?? map.mice;
}

export function createIndividuals(sampleSize, creature = "mouse") {
  const individuals = [];
  for (let i = 0; i < sampleSize; i++) {
    const block = i % CONFIG.numBlocks;
    individuals.push({
      id: i + 1,
      block,
      fur: BLOCK_FUR[block],
      shellColor: creature === "turtle" ? TURTLE_SHELLS[block]?.color : undefined,
      limbColor: creature === "turtle" ? TURTLE_SHELLS[block]?.limbColor : undefined,
      antColor: creature === "ant" ? ANT_COLONIES[block]?.color : undefined,
    });
  }
  return individuals;
}

/**
 * Draws this run's completion time from a normal distribution, then applies
 * whichever real effects and confounds apply to this particular run:
 *   - block shift    → a confound (see CONFIG.blockTimeShift)
 *   - drug effect     → the true effect the study is trying to detect
 *   - practice effect → a confound specific to matched pairs on a reused maze
 * `opts.assignmentType` and `opts.newMazeEachRun` only affect how much NOISE
 * is added (spread), not the mean — that's what makes some designs more
 * reliable than others at revealing the same true drug effect.
 */
export function computeRunMetrics(individual, opts) {
  const { hasDrug, isRepeatMaze, assignmentType, newMazeEachRun } = opts;

  const blockShift = CONFIG.blockTimeShift[individual.block] ?? 0;
  const mazeSpread = newMazeEachRun ? CONFIG.newMazeSpread : 0;
  const spread = CONFIG.timeStdDev + CONFIG.designTimeSpread[assignmentType] + mazeSpread;

  let time = randomNormal(CONFIG.timeMean, spread) + blockShift;

  if (hasDrug) {
    time -= CONFIG.drugTimeReduction + randomNormal(0, CONFIG.drugTimeNoise);
  }

  if (isRepeatMaze) {
    time -= CONFIG.learningTimeReduction + randomNormal(0, CONFIG.learningTimeNoise);
  }

  time = Math.min(CONFIG.timeCeiling, Math.max(CONFIG.timeFloor, time));

  return { completionTime: round1(time) };
}

export function buildExperiment(individuals, assignmentType) {
  switch (assignmentType) {
    case "random": return buildRandomAssignment(individuals);
    case "block": return buildBlockAssignment(individuals);
    case "matched": return buildMatchedPairs(individuals);
    default: throw new Error(`Unknown assignment: ${assignmentType}`);
  }
}

/** Exactly half the individuals get drug (rounded to nearest individual). */
export function drugGroupCount(total) {
  return Math.round(total / 2);
}

/**
 * Random assignment: shuffle everyone, then the first half get the drug.
 * Because block isn't accounted for, a shuffle can (by chance) put more
 * of one block in one group than the other — that's the confounding this
 * design is vulnerable to.
 */
function buildRandomAssignment(individuals) {
  const shuffled = shuffle([...individuals]);
  const nDrug = drugGroupCount(shuffled.length);

  return shuffle(
    shuffled.map((individual, index) => {
      const hasDrug = index < nDrug;
      return makeRun(individual, hasDrug, "random", {
        phase: 1,
        group: hasDrug ? "drug" : "control",
      });
    })
  );
}

/**
 * Block assignment: shuffle and split each block separately, so every
 * block is represented equally in both groups. This is what "blocking"
 * means — the confounding variable (block) can no longer pile up
 * unevenly in one group, whatever else happens.
 */
function buildBlockAssignment(individuals) {
  const runs = [];
  for (let block = 0; block < CONFIG.numBlocks; block++) {
    const inBlock = individuals.filter((m) => m.block === block);
    const shuffled = shuffle([...inBlock]);
    const nDrug = drugGroupCount(shuffled.length);

    shuffled.forEach((individual, index) => {
      const hasDrug = index < nDrug;
      runs.push(
        makeRun(individual, hasDrug, "block", {
          phase: 1,
          group: hasDrug ? "drug" : "control",
        })
      );
    });
  }
  return shuffle(runs);
}

/**
 * Matched pairs: every individual runs TWICE, once with the drug and once
 * without — so each individual acts as its own control. Whether a given individual
 * gets the drug first or second is randomized, so any practice/order
 * effect (see learningTimeReduction) isn't stacked onto one group.
 */
function buildMatchedPairs(individuals) {
  const shuffled = shuffle([...individuals]);
  const half = Math.floor(shuffled.length / 2);
  const runs = [];

  shuffled.forEach((individual, index) => {
    const drugFirst = index < half;
    if (drugFirst) {
      runs.push(makeRun(individual, true, "matched", { phase: 1, group: "drug", pairOrder: "drug-first" }));
      runs.push(makeRun(individual, false, "matched", { phase: 2, group: "control", pairOrder: "drug-first" }));
    } else {
      runs.push(makeRun(individual, false, "matched", { phase: 1, group: "control", pairOrder: "control-first" }));
      runs.push(makeRun(individual, true, "matched", { phase: 2, group: "drug", pairOrder: "control-first" }));
    }
  });

  return runs;
}

function makeRun(individual, hasDrug, assignmentType, meta) {
  return {
    individual,
    hasDrug,
    assignmentType,
    ringColor: hasDrug ? GROUP_COLORS.mouse.drug : GROUP_COLORS.mouse.control,
    fur: individual.fur,
    ...meta,
  };
}

/**
 * Batch runs for animation.
 * Shared maze (toggle off): all individuals together; matched = phase 1 batch then phase 2 batch.
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
    return `run-${run.individual.id}-${run.phase ?? 1}-${Math.random().toString(36).slice(2, 9)}`;
  }
  return "shared-maze";
}

export function usesBlockCharts(assignmentType) {
  return assignmentType === "block";
}

export function usesMatchedDifference(assignmentType) {
  return assignmentType === "matched";
}

export function getBlockDifferences(records) {
  return groupRecordsByBlock(records)
    .filter(({ controlTimes, drugTimes }) => controlTimes.length > 0 && drugTimes.length > 0)
    .map(({ block, controlTimes, drugTimes }) => ({
      block,
      difference: round1(mean(controlTimes) - mean(drugTimes)),
    }));
}

/** Splits records into one { block, controlTimes, drugTimes } bucket per block. */
function groupRecordsByBlock(records) {
  const groups = [];
  for (let block = 0; block < CONFIG.numBlocks; block++) {
    const blockRecords = records.filter((r) => r.block === block);
    groups.push({
      block,
      controlTimes: blockRecords.filter((r) => r.group === "control").map((r) => r.time),
      drugTimes: blockRecords.filter((r) => r.group === "drug").map((r) => r.time),
    });
  }
  return groups;
}

function blockName(block) {
  const { label } = getCreatureGroupMeta();
  return BLOCK_FUR[block]?.name ?? `${label} ${block + 1}`;
}

export function summarizeResults(records, assignmentType, randomMazeEachRun) {
  if (assignmentType === "matched") {
    const diffs = records.filter((r) => r.type === "difference").map((r) => r.time);
    if (diffs.length === 0) return "Waiting for paired differences…";

    currentDiff = round1(mean(diffs));
    const learningNote =
      !randomMazeEachRun
        ? " Same maze reused — 2nd runs include a learning effect (not from the drug)."
        : "";

    return (
      `Mean paired difference: ${currentDiff}s (control − drug). ` +
      learningNote
    );
  }

  if (assignmentType === "block") {
    // Block is the confound block assignment controls for, so the summary
    // reports drug/control means and the difference separately PER BLOCK —
    // pooling them together would hide exactly the thing blocking fixes.
    const byBlock = groupRecordsByBlock(records);
    const parts = byBlock
      .filter(({ controlTimes, drugTimes }) => controlTimes.length > 0 && drugTimes.length > 0)
      .map(({ block, controlTimes, drugTimes }) => {
        const drugMean = round1(mean(drugTimes));
        const controlMean = round1(mean(controlTimes));
        currentDiff = round1(controlMean - drugMean);
        return `${blockName(block)} Control Mean - Drug Mean: ${currentDiff}s`;
      });

    return parts.length > 0 ? parts.join("\n") : "Waiting for data…";
  }

  const controlTimes = records.filter((r) => r.group === "control").map((r) => r.time);
  const drugTimes = records.filter((r) => r.group === "drug").map((r) => r.time);

  if (controlTimes.length === 0 || drugTimes.length === 0) {
    return "Waiting for data…";
  }

  const controlMean = round1(mean(controlTimes));
  const drugMean = round1(mean(drugTimes));
  currentDiff = round1(controlMean - drugMean);

  return `Control Mean - Drug Mean: ${currentDiff}s.`;
}

function formatPValue(p) {
  const clamped = Math.max(0, Math.min(1, p));
  const pText = clamped < 0.001 ? "< 0.001" : String(Math.round(clamped * 1000) / 1000);
  const verdict =
    clamped < 0.05
      ? "likely a real effect"
      : "likely explained by chance";

  return `P = ${pText} — ${verdict}.`;
}

/**
 * How likely the observed difference is under pure chance (no real drug effect):
 * a Welch two-sample t-test for random/matched pairs (paired) — and, for block
 * assignment, one Welch t-test PER BLOCK, combined across blocks:
 *   - If every block's difference points the SAME direction (drug faster in
 *     both, or drug slower in both), that's reinforcing evidence, so the
 *     combined probability is the product of the per-block p-values (the
 *     chance BOTH happen together by chance).
 *   - If blocks DISAGREE on direction (drug looked faster in one block and
 *     slower in the other), that's contradictory evidence, not reinforcing
 *     evidence — multiplying would overstate how sure we are. Instead each
 *     block's confidence (1 − p) is signed by its direction and averaged,
 *     so the blocks partially cancel each other out rather than compound.
 */
export function describeSignificance(records, assignmentType) {
  if (assignmentType === "matched") {
    const diffs = records.filter((r) => r.type === "difference").map((r) => r.time);
    if (diffs.length < 2) return "P = — (need at least 2 pairs to compute)";
    const result = pairedTTest(diffs);
    return result ? formatPValue(result.p) : "";
  }

  if (assignmentType === "block") {
    const byBlock = groupRecordsByBlock(records);
    const results = byBlock.map(({ block, controlTimes, drugTimes }) => {
      if (controlTimes.length < 2 || drugTimes.length < 2) return null;
      const result = welchTTest(drugTimes, controlTimes);
      return result ? { block, p: result.p, t: result.t } : null;
    });

    if (results.some((r) => r === null)) {
      const { label } = getCreatureGroupMeta();
      return `P = — (need at least 2 per group in each ${label.toLowerCase()} to compute)`;
    }

    const perBlockText = results
      .map(({ block, p }) => `${blockName(block)}: ${formatPValue(p)}`)
      .join("\n");

    const nonZeroSigns = results.map((r) => Math.sign(r.t)).filter((s) => s !== 0);
    const litersAgree = nonZeroSigns.every((s) => s === nonZeroSigns[0]);

    let combinedP;
    let combinedNote = "";
    if (litersAgree) {
      combinedP = results.reduce((product, r) => product * r.p, 1);
    } else {
      const signedConfidence =
        results.reduce((sum, r) => sum + Math.sign(r.t) * (1 - r.p), 0) / results.length;
      combinedP = 1 - Math.abs(signedConfidence);
      const { plural } = getCreatureGroupMeta();
      combinedNote = ` (${plural} disagree on direction, so their evidence partially cancels instead of compounding)`;
    }
    const combinedClamped = Math.max(0, Math.min(1, combinedP));

    return (
      `${perBlockText} ` +
      `\nCombined probability: ${formatPValue(combinedClamped)}${combinedNote}`
    );
  }

  const controlTimes = records.filter((r) => r.group === "control").map((r) => r.time);
  const drugTimes = records.filter((r) => r.group === "drug").map((r) => r.time);
  if (controlTimes.length < 2 || drugTimes.length < 2) {
    const { units } = getCreatureGroupMeta();
    return `P = — (need at least 2 ${units} per group to compute)`;
  }
  const result = welchTTest(drugTimes, controlTimes);
  return result ? formatPValue(result.p) : "";
}

export function getChartLabels(assignmentType, randomMazeEachRun) {
  if (assignmentType === "block") {
    return {
      mode: "block",
      caption: "",
    };
  }

  if (assignmentType === "matched") {
    const mazeNote = randomMazeEachRun
      ? "Each run uses a new maze."
      : "All individuals run together on the same maze — 2nd phase is faster from practice.";
    return {
      mode: "difference",
      caption: "",
    };
  }

  return {
    mode: "stacked",
    caption: "",
  };
}

export function getCurrentDiff() {
  return currentDiff;
}
