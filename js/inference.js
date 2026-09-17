/**
 * inference.js — Welch's two-sample t-test and paired t-test, with a real
 * t-distribution p-value (not a rough normal approximation), so the sidebar
 * can report how likely the observed difference is under pure chance.
 */

import { mean, stdDev } from "./config.js";

/** log(Gamma(x)) via the Lanczos approximation */
function logGamma(x) {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Continued-fraction expansion for the regularized incomplete beta function */
function betaContinuedFraction(x, a, b) {
  const MAX_ITER = 200;
  const EPS = 3e-9;
  const FPMIN = 1e-30;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < EPS) break;
  }

  return h;
}

/** Regularized incomplete beta function I_x(a, b) */
function regularizedIncompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );

  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Two-tailed p-value for Student's t-distribution */
export function tDistributionPValue(t, df) {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return 1;
  const x = df / (df + t * t);
  return Math.max(0, Math.min(1, regularizedIncompleteBeta(df / 2, 0.5, x)));
}

/**
 * Welch's two-sample t-test (unequal variances assumed — the standard choice
 * when there's no reason to assume the two groups have equal spread).
 */
export function welchTTest(sampleA, sampleB) {
  const nA = sampleA.length;
  const nB = sampleB.length;
  if (nA < 2 || nB < 2) return null;

  const meanA = mean(sampleA);
  const meanB = mean(sampleB);
  const varA = stdDev(sampleA) ** 2;
  const varB = stdDev(sampleB) ** 2;
  const seSquared = varA / nA + varB / nB;

  if (seSquared === 0) {
    return { t: 0, df: nA + nB - 2, p: 1 };
  }

  const t = (meanA - meanB) / Math.sqrt(seSquared);
  const df =
    seSquared ** 2 /
    ((varA / nA) ** 2 / (nA - 1) + (varB / nB) ** 2 / (nB - 1));
  const p = tDistributionPValue(t, df);

  return { t, df, p };
}

/** Paired (one-sample) t-test of the differences against 0 */
export function pairedTTest(differences) {
  const n = differences.length;
  if (n < 2) return null;

  const m = mean(differences);
  const sd = stdDev(differences);

  if (sd === 0) {
    return { t: 0, df: n - 1, p: m === 0 ? 1 : 0 };
  }

  const t = m / (sd / Math.sqrt(n));
  const df = n - 1;
  const p = tDistributionPValue(t, df);

  return { t, df, p };
}
