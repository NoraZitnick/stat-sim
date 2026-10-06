/**
 * config.js — All the "dials" that control the simulation, plus a few small
 * math helpers (mean, standard deviation, a normal-distribution random
 * number generator).
 *
 * If you're a student reading this: every number below is a choice we made
 * about how the *imaginary* individuals behave. Nothing here is measured from real
 * individuals — it's a model we designed so the statistics lessons (confounding,
 * blocking, matched pairs, p-values) show up clearly in the results.
 */
const animTimeScale = 0.1; 
export const CONFIG = {
  // ---------------------------------------------------------------------
  // The maze itself
  // ---------------------------------------------------------------------
  mazeCols: 10,
  mazeRows: 10,
  numBlocks: 2,

  // ---------------------------------------------------------------------
  // The outcome variable: how long (in seconds) a individual takes to finish.
  // This is drawn from a normal distribution — a classic bell curve —
  // centered at timeMean with spread timeStdDev, the same way a real
  // measurement (like reaction time) clusters around a typical value with
  // random variation on either side.
  // ---------------------------------------------------------------------
  timeMean: 36,
  timeStdDev: 4,

  /** No individual is ever shown finishing faster than this or slower than this. */
  timeFloor: 8,
  timeCeiling: 90,

  // ---------------------------------------------------------------------
  // The drug effect — the thing the "experiment" is trying to detect.
  // ---------------------------------------------------------------------

  /**
   * How many seconds faster the drug truly makes a individual, on average.
   * This is deliberately a SMALL effect relative to the noise below: with
   * random assignment and a sample of 20 individuals, ordinary sampling
   * variability (plus the block confound) makes the drug group look
   * slower than control in the observed sample about 30% of the time —
   * even though the drug really does help on average. That's the whole
   * point of the lesson: a small random sample can mislead you. Block and
   * matched-pairs designs strip out much of that noise, so they reveal the
   * same true effect far more reliably at the same sample size.
   */
  drugTimeReduction: 2.5,
  /** Individual-to-individual variation in how well the drug works for them. */
  drugTimeNoise: 1,

  // ---------------------------------------------------------------------
  // Sources of variability and confounding — these are what make the three
  // study designs (random / block / matched pairs) behave differently.
  // ---------------------------------------------------------------------

  /**
   * Block is a CONFOUNDING VARIABLE: it affects completion time but has
   * nothing to do with the drug. Block 0 (Brown) runs slightly slower,
   * block 1 (Gray) runs slightly faster, regardless of drug or control.
   *   - Random assignment can end up with more of one block in one group
   *     by chance, letting this confound masquerade as a "drug effect."
   *   - Block assignment splits each block evenly between drug and
   *     control, so the confound can't accumulate in either group.
   *   - Matched pairs runs the SAME individual both ways, so its block effect
   *     is identical in both runs and cancels out exactly when we compute
   *     that individual's (control − drug) difference.
   */
  blockTimeShift: [3, -3],

  /**
   * Extra noise added on top of the base spread, one value per assignment
   * method. This is what makes "random assignment" noisy/unreliable and
   * "matched pairs" clean and reliable, at the same sample size — nothing
   * else in the model depends on which design is chosen.
   */
  designTimeSpread: {
    random: 6,
    block: 0.4,
    matched: 0.3,
  },

  /**
   * Extra noise from maze-to-maze difficulty differences. This ONLY
   * applies when "New random maze each run" is checked, because that's the
   * only time it's real: every individual then solves a different maze, and
   * some mazes are just harder than others. When every individual solves the
   * SAME maze, that source of variation genuinely doesn't exist — not just
   * "unmodeled," but literally absent, since maze difficulty is identical
   * for everyone.
   */
  newMazeSpread: 2.5,

  /**
   * A individual that already solved this maze once runs it faster the second
   * time — ordinary practice/learning, unrelated to the drug. This only
   * applies to a matched-pairs individual's SECOND run, and only when the maze
   * is shared (reused) rather than regenerated. It's a second, separate
   * confound the class can discover: even matched pairs isn't automatically
   * perfect if the same maze is reused without accounting for practice.
   */
  learningTimeReduction: 3,
  learningTimeNoise: 0.7,

  // ---------------------------------------------------------------------
  // Animation pacing (purely visual — does not affect any statistics)
  // ---------------------------------------------------------------------
  animTimeScale: animTimeScale,
  pauseBetweenRuns: 200,

  // ---------------------------------------------------------------------
  // Histogram bin settings
  // ---------------------------------------------------------------------
  binWidth: 2*animTimeScale,
  binMin: 0,
  binMax: 48*animTimeScale, 

  /** Matched pairs: histogram of (control time − drug time) per individual */
  diffBinWidth: 2*animTimeScale,
  diffBinWidthMultiGraph: 1*animTimeScale,
  diffBinMin: -12*animTimeScale,
  diffBinMax: 12*animTimeScale,

  // ---------------------------------------------------------------------
  // Performance safety caps (not statistics — just guardrails so the app
  // never freezes the browser tab, even on slow hardware)
  // ---------------------------------------------------------------------

  /**
   * Hard ceiling on how many steps the "smart wandering" maze explorer will
   * try before giving up and falling back to the guaranteed-fast shortest
   * path. A 15x15 maze (225 cells) is normally solved in well under a
   * thousand steps, so this cap exists purely to guarantee the browser can
   * never hang — it should essentially never be hit in practice.
   */
  maxExploreSteps: 4000,

  /** Fast-forward: process this many runs before updating the screen */
  fastForwardBatchSize: 100,
};

export const BLOCK_FUR = [
  { fur: "#8B5E3C", belly: "#E8C4A0", ear: "#5C3D28", tail: "#4A3020", nose: "#2D1810", name: "Brown" },
  { fur: "#7A8B99", belly: "#D8E0E8", ear: "#556270", tail: "#445058", nose: "#2A3238", name: "Gray" },
];

export const TURTLE_SHELLS = [
  { color: "#4F9D69", limbColor: "#2A7E46", name: "Green" },
  { color: "#8B5E3C", limbColor: "#603C21", name: "Brown" },
];

export const ANT_COLONIES = [
  { color: "#202020", name: "Black" },
  { color: "#8B5E3C", name: "Brown" },
];

export function getCreatureBlocks(creature = "mouse") {
  if (creature === "turtle") return TURTLE_SHELLS;
  if (creature === "ant") return ANT_COLONIES;
  return BLOCK_FUR.map(({ fur, name }) => ({ color: fur, name }));
}

export const GROUP_COLORS = {
  mouse: { control: "#000000", drug: "#16a34a" },
  turtle: { control: "#9CA3AF", drug: "#F97316" },
  ant: { control: "#9CA3AF", drug: "#F97316" },
};

/** One random draw from a normal (bell-curve) distribution — the Box-Muller method. */
export function randomNormal(mean = 0, stdDev = 1) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

/** Fisher–Yates shuffle — every ordering of the array is equally likely. */
export function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function round1(n) {
  return Math.round(n * 10) / 10;
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n-1 denominator) — the version taught in AP Stats. */
export function stdDev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
