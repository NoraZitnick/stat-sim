/**
 * config.js — Simulation constants
 */

export const CONFIG = {
  numLitters: 2,

  /** Base movement speed (cells/sec); littermates cluster around litter mean */
  baseSpeed: 3.6,
  litterSpeedSpread: 0.4,
  individualSpeedSpread: 0.18,

  drugSpeedMultiplier: 1.12,
  drugSpeedNoise: 0.04,

  learningMultiplier: 1.18,
  learningNoise: 0.03,

  runSpeedNoise: 0.05,

  /**
   * Completion times are drawn from a Gaussian (bell curve).
   * Path exploration adds only a small adjustment — not the main spread.
   */
  timeMean: 30,
  timeStdDev: 5.5,

  /** Confounding: litter shifts the bell curve (same speeds, different display groups) */
  litterTimeShift: [4, -4],

  drugTimeReduction: 4.5,
  drugTimeNoise: 1.2,

  learningTimeReduction: 3.5,
  learningTimeNoise: 0.8,

  /** Extra spread by design (random = harder to see effect) */
  designTimeSpread: {
    random: 1.8,
    block: 0.6,
    matched: 0.4,
  },

  mazeCols: 15,
  mazeRows: 15,

  animTimeScale: 0.09,
  pauseBetweenRuns: 200,
  binWidth: 3,
  binMin: 12,
  binMax: 48,

  /** Matched pairs: histogram of (control time − drug time) per mouse */
  diffBinWidth: 2,
  diffBinMin: -12,
  diffBinMax: 12,

  maxExploreSteps: 800,

  /** Fast-forward: process this many runs before updating the UI */
  fastForwardBatchSize: 100,
};

export const LITTER_FUR = [
  { fur: "#8B5E3C", belly: "#E8C4A0", ear: "#5C3D28", tail: "#4A3020", nose: "#2D1810", name: "Brown" },
  { fur: "#7A8B99", belly: "#D8E0E8", ear: "#556270", tail: "#445058", nose: "#2A3238", name: "Gray" },
];

export const GROUP_RING = {
  control: "#64748b",
  drug: "#16a34a",
};

export function randomNormal(mean = 0, stdDev = 1) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

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

export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
