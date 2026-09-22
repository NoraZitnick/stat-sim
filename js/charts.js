/**
 * charts.js — The three histogram layouts, one per assignment method:
 *   - HistogramStacked: random assignment — a Drug histogram and a Control
 *     histogram, side by side.
 *   - HistogramBlockStacked: block assignment — the same, but split again
 *     into a 2x2 grid by litter, so each litter's drug/control comparison
 *     can be read on its own.
 *   - HistogramDifference: matched pairs — one histogram of each mouse's
 *     (control time − drug time), since that's the number that actually
 *     matters for this design.
 *
 * Every chart also gets a small hoverable "i" icon showing that chart's own
 * sample size, mean, and standard deviation — the numbers a student would
 * otherwise have to compute by hand from the bars.
 */

import { CONFIG, LITTER_FUR, mean, round1, stdDev } from "./config.js";

const DRUG_COLOR = "#16a34a";
const CONTROL_COLOR = "#000000";
let max_count = 0;

function formatStats(values) {
  if (values.length === 0) return "No data yet";
  return `n = ${values.length}\nMean = ${round1(mean(values))}s\nSD = ${round1(stdDev(values))}s`;
}

function infoIconMarkup() {
  return (
    '<button type="button" class="chart-info" aria-label="Chart statistics">' +
    '<span aria-hidden="true">ⓘ</span>' +
    '<span class="chart-info-tooltip"></span>' +
    "</button>"
  );
}

function setInfoTooltip(container, text) {
  if (!container) return;
  const tooltip = container.querySelector(".chart-info-tooltip");
  if (tooltip) tooltip.textContent = text;
}

/**
 * Chart.js schedules its very first paint via requestAnimationFrame right when a
 * chart is constructed. If real data arrives (via update("none")) before that first
 * paint has run — exactly what happens during Fast forward, where dozens of results
 * can be ingested synchronously within milliseconds of chart creation — the bar
 * elements' geometry (y/height) is left permanently null, so nothing is drawn even
 * though the underlying data is correct. Calling update("none") again does not
 * recover it; only an animated update (plus a resize, in case layout settled late)
 * on a later task does. The setTimeout(…, 0) — not requestAnimationFrame — is
 * deliberate: it must land after Chart.js's own stuck initial animation frame.
 */
function updateChart(chart) {
  chart.update("none");
  setTimeout(() => {
    // The chart may have been destroy()ed (reset, or a new run/assignment type
    // switched charts) before this fires — Chart.js nulls out .canvas on destroy.
    if (!chart.canvas) return;
    chart.resize();
    chart.update();
  }, 0);
}

function stackedOptions(xTitle = "Time (s)", yTitle = "Count") {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    plugins: {
      legend: {
        display: true,
        position: "bottom",
        labels: { boxWidth: 12, font: { size: 10 } },
      },
      tooltip: {
        callbacks: {
          title: (items) => `Time: ${items[0]?.label ?? ""}s`,
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} mouse${ctx.parsed.y === 1 ? "" : "es"}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        title: { display: true, text: xTitle },
        ticks: { maxRotation: 0, minRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 9 } },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: { stepSize: 1, font: { size: 9 } },
        title: { display: true, text: yTitle },
        max: max_count,
      },
    },
  };
}

function formatBinLabel(start, end) {
  return `${start}–${end}s`;
}

function makeTimeBins(binMin = CONFIG.binMin, binMax = CONFIG.binMax) {
  const { binWidth } = CONFIG;
  const labels = [];
  const edges = [];
  for (let start = binMin; start < binMax; start += binWidth) {
    const end = start + binWidth;
    labels.push(formatBinLabel(start, end));
    edges.push({ start, end, drug: 0, control: 0 });
  }
  return { labels, edges };
}

function makeDiffBins(binMin = CONFIG.diffBinMin, binMax = CONFIG.diffBinMax) {
  const { diffBinWidth } = CONFIG;
  const labels = [];
  const edges = [];
  for (let start = binMin; start < binMax; start += diffBinWidth) {
    const end = start + diffBinWidth;
    labels.push(formatBinLabel(start, end));
    edges.push({ start, end, count: 0 });
  }
  return { labels, edges };
}

function expandBinsToCoverValue(edges, currentSpec, value, width, makeBins, copyExisting) {
  const minStart = Math.min(...edges.map((e) => e.start));
  const maxEnd = Math.max(...edges.map((e) => e.end));
  const needsLowerExpansion = value < minStart;
  const needsUpperExpansion = value >= maxEnd;

  if (!needsLowerExpansion && !needsUpperExpansion) {
    return { labels: currentSpec.labels, edges };
  }

  const newBinMin = needsLowerExpansion
    ? Math.floor((value - width) / width) * width
    : Math.floor((minStart - width) / width) * width;
  const newBinMax = needsUpperExpansion
    ? Math.ceil((value + width) / width) * width
    : Math.ceil((maxEnd + width) / width) * width;
  const nextSpec = makeBins(newBinMin, newBinMax);

  const nextEdges = nextSpec.edges.map((slot) => {
    const existing = edges.find((e) => e.start === slot.start && e.end === slot.end);
    return copyExisting(slot, existing);
  });

  return { labels: nextSpec.labels, edges: nextEdges };
}

/**
 * Grow the shared bin range (used across all litter charts) just enough to cover a
 * new value — never shrinks and never drops bins that already hold data. Recomputing
 * the range from only the currently non-empty bins (the old approach) could silently
 * discard counts sitting outside the new narrower window, which is what produced the
 * "cut off" tail on charts whose values already reached lower than other litters'.
 */
function growBlockBinsToCoverValue(charts, currentSpec, value, width) {
  const minStart = Math.min(...charts.flatMap((entry) => entry.edges.map((e) => e.start)));
  const maxEnd = Math.max(...charts.flatMap((entry) => entry.edges.map((e) => e.end)));

  if (value >= minStart && value < maxEnd) return currentSpec;

  const newBinMin = Math.min(minStart, Math.floor((value - width) / width) * width);
  const newBinMax = Math.max(maxEnd, Math.ceil((value + width) / width) * width);
  const nextSpec = makeTimeBins(newBinMin, newBinMax);

  for (const entry of charts) {
    const nextEdges = nextSpec.edges.map((slot) => {
      const existing = entry.edges.find((e) => e.start === slot.start && e.end === slot.end);
      return {
        ...slot,
        drug: existing ? existing.drug : 0,
        control: existing ? existing.control : 0,
      };
    });
    entry.edges = nextEdges;
    entry.charts.drug.data.labels = nextSpec.labels;
    entry.charts.control.data.labels = nextSpec.labels;
  }

  return nextSpec;
}

function valueToBinIndex(edges, value) {
  for (let i = 0; i < edges.length; i++) {
    if (value >= edges[i].start && value < edges[i].end) return i;
  }
  if (value < edges[0].start) return 0;
  return edges.length - 1;
}

function freshTimeEdges(binSpec) {
  return binSpec.edges.map((e) => ({ ...e, drug: 0, control: 0 }));
}

function buildSeparateHistogramChart(canvas, binSpec, values, label, color) {
  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: binSpec.labels,
      datasets: [
        {
          label,
          data: values.map(() => 0),
          backgroundColor: color + "cc",
          borderColor: color,
          borderWidth: 1,
        },
      ],
    },
    options: stackedOptions(),
  });
  return chart;
}

function syncSeparateCharts(charts, edges) {
  charts.drug.data.datasets[0].data = edges.map((e) => e.drug);
  charts.control.data.datasets[0].data = edges.map((e) => e.control);
  max_count = Math.max(...edges.map((e) => e.control), ...edges.map((e) => e.drug));
  charts.drug.options.scales.y.max = max_count;
  charts.control.options.scales.y.max = max_count;
  updateChart(charts.drug);
  updateChart(charts.control);
}

function syncBlockCharts(charts) {
  const sharedMax = Math.max(
    1,
    ...charts.flatMap((entry) => [
      ...entry.edges.map((e) => e.drug),
      ...entry.edges.map((e) => e.control),
    ])
  );

  max_count = sharedMax;

  for (const entry of charts) {
    entry.charts.drug.data.datasets[0].data = entry.edges.map((e) => e.drug);
    entry.charts.control.data.datasets[0].data = entry.edges.map((e) => e.control);
    entry.charts.drug.options.scales.y.max = sharedMax;
    entry.charts.control.options.scales.y.max = sharedMax;
    updateChart(entry.charts.drug);
    updateChart(entry.charts.control);
  }
}

/** Two separate histograms: drug above, control below */
export class HistogramStacked {
  constructor(container) {
    this.mode = "separate";
    this.binSpec = makeTimeBins();
    this.edges = freshTimeEdges(this.binSpec);
    this.rawDrug = [];
    this.rawControl = [];
    container.className = "charts-grid charts-grid--1";
    container.innerHTML = `
      <div class="chart-box chart-box--wide">
        ${infoIconMarkup()}
        <h3>Drug</h3>
        <canvas id="chart-drug"></canvas>
      </div>
      <div class="chart-box chart-box--wide">
        ${infoIconMarkup()}
        <h3>Control</h3>
        <canvas id="chart-control"></canvas>
      </div>
    `;
    max_count = Math.max(...this.edges.map((e) => e.control), ...this.edges.map((e) => e.drug));
    this.charts = {
      drug: buildSeparateHistogramChart(
        container.querySelector("#chart-drug"),
        this.binSpec,
        this.edges.map((e) => e.drug),
        "Drug",
        DRUG_COLOR
      ),
      control: buildSeparateHistogramChart(
        container.querySelector("#chart-control"),
        this.binSpec,
        this.edges.map((e) => e.control),
        "Control",
        CONTROL_COLOR
      ),
    };
    this.updateStats();
  }

  setTitles() {}

  updateStats() {
    setInfoTooltip(this.charts.drug.canvas.closest(".chart-box"), formatStats(this.rawDrug));
    setInfoTooltip(this.charts.control.canvas.closest(".chart-box"), formatStats(this.rawControl));
  }

  addResult(group, time) {
    const expanded = expandBinsToCoverValue(
      this.edges,
      this.binSpec,
      time,
      CONFIG.binWidth,
      makeTimeBins,
      (slot, existing) => ({
        ...slot,
        drug: existing ? existing.drug : 0,
        control: existing ? existing.control : 0,
      })
    );

    if (expanded.edges.length !== this.edges.length) {
      this.binSpec = { labels: expanded.labels, edges: expanded.edges };
      this.edges = expanded.edges;
      this.charts.drug.data.labels = this.binSpec.labels;
      this.charts.control.data.labels = this.binSpec.labels;
    }

    const idx = valueToBinIndex(this.edges, time);
    if (group === "drug") {
      this.edges[idx].drug += 1;
      this.rawDrug.push(time);
    } else {
      this.edges[idx].control += 1;
      this.rawControl.push(time);
    }

    syncSeparateCharts(this.charts, this.edges);
    this.updateStats();
  }

  addResultsBatch(records) {
    let workingEdges = this.edges;
    let workingSpec = this.binSpec;

    for (const { group, time } of records) {
      const expanded = expandBinsToCoverValue(
        workingEdges,
        workingSpec,
        time,
        CONFIG.binWidth,
        makeTimeBins,
        (slot, existing) => ({
          ...slot,
          drug: existing ? existing.drug : 0,
          control: existing ? existing.control : 0,
        })
      );
      workingEdges = expanded.edges;
      workingSpec = { labels: expanded.labels, edges: expanded.edges };

      const idx = valueToBinIndex(workingEdges, time);
      if (group === "drug") {
        workingEdges[idx].drug += 1;
        this.rawDrug.push(time);
      } else {
        workingEdges[idx].control += 1;
        this.rawControl.push(time);
      }
    }

    if (workingEdges.length !== this.edges.length) {
      this.binSpec = workingSpec;
      this.edges = workingEdges;
      this.charts.drug.data.labels = this.binSpec.labels;
      this.charts.control.data.labels = this.binSpec.labels;
    }

    this.edges = workingEdges;
    this.binSpec = workingSpec;
    syncSeparateCharts(this.charts, this.edges);
    this.updateStats();
  }

  reset() {
    this.edges.forEach((e) => {
      e.drug = 0;
      e.control = 0;
    });
    this.rawDrug = [];
    this.rawControl = [];
    syncSeparateCharts(this.charts, this.edges);
    this.updateStats();
  }

  destroy() {
    this.charts.drug.destroy();
    this.charts.control.destroy();
  }
}

/** Four litter-specific histograms, each with separate drug/control panels */
export class HistogramBlockStacked {
  constructor(container) {
    this.mode = "block";
    this.binSpec = makeTimeBins();
    container.className = "charts-grid charts-grid--4";

    this.litters = LITTER_FUR.map((fur, i) => {
      return { litter: i, name: fur.name };
    });

    // Laid out as a 2x2 grid in DOM order (grid auto-placement fills left-to-right,
    // top-to-bottom): top row = drug for each litter, bottom row = control for each
    // litter — so top-left/top-right are litter 0/1 drugged, bottom-left/bottom-right
    // are litter 0/1 control.
    const groups = [
      { key: "drug", label: "Drug" },
      { key: "control", label: "Control" },
    ];

    container.innerHTML = groups
      .map((g) =>
        this.litters
          .map(
            (l) => `
      <div class="chart-box chart-box--quad">
        ${infoIconMarkup()}
        <h3>${l.name} — ${g.label}</h3>
        <canvas id="chart-${l.litter}-${g.key}"></canvas>
      </div>`
          )
          .join("")
      )
      .join("");

    this.charts = this.litters.map((l) => {
      const edges = freshTimeEdges(this.binSpec);
      return {
        litter: l.litter,
        edges,
        rawDrug: [],
        rawControl: [],
        charts: {
          drug: buildSeparateHistogramChart(
            container.querySelector(`#chart-${l.litter}-drug`),
            this.binSpec,
            edges.map((e) => e.drug),
            "Drug",
            DRUG_COLOR
          ),
          control: buildSeparateHistogramChart(
            container.querySelector(`#chart-${l.litter}-control`),
            this.binSpec,
            edges.map((e) => e.control),
            "Control",
            CONTROL_COLOR
          ),
        },
      };
    });
    syncBlockCharts(this.charts);
    this.updateStats();
  }

  setTitles() {}

  updateStats() {
    for (const entry of this.charts) {
      setInfoTooltip(entry.charts.drug.canvas.closest(".chart-box"), formatStats(entry.rawDrug));
      setInfoTooltip(entry.charts.control.canvas.closest(".chart-box"), formatStats(entry.rawControl));
    }
  }

  addResult(group, time, litter) {
    const entry = this.charts.find((c) => c.litter === litter);
    if (!entry) return;

    const nextSpec = growBlockBinsToCoverValue(this.charts, this.binSpec, time, CONFIG.binWidth);
    if (nextSpec !== this.binSpec) {
      this.binSpec = nextSpec;
    }

    const idx = valueToBinIndex(entry.edges, time);
    if (group === "drug") {
      entry.edges[idx].drug += 1;
      entry.rawDrug.push(time);
    } else {
      entry.edges[idx].control += 1;
      entry.rawControl.push(time);
    }

    syncBlockCharts(this.charts);
    this.updateStats();
  }

  addResultsBatch(records) {
    for (const { group, time, litter } of records) {
      const entry = this.charts.find((c) => c.litter === litter);
      if (!entry) continue;

      const nextSpec = growBlockBinsToCoverValue(this.charts, this.binSpec, time, CONFIG.binWidth);
      if (nextSpec !== this.binSpec) {
        this.binSpec = nextSpec;
      }

      const idx = valueToBinIndex(entry.edges, time);
      if (group === "drug") {
        entry.edges[idx].drug += 1;
        entry.rawDrug.push(time);
      } else {
        entry.edges[idx].control += 1;
        entry.rawControl.push(time);
      }
    }

    syncBlockCharts(this.charts);
    this.updateStats();
  }

  reset() {
    for (const entry of this.charts) {
      entry.edges.forEach((e) => {
        e.drug = 0;
        e.control = 0;
      });
      entry.rawDrug = [];
      entry.rawControl = [];
    }
    syncBlockCharts(this.charts);
    this.updateStats();
  }

  destroy() {
    this.charts.forEach((c) => {
      c.charts.drug.destroy();
      c.charts.control.destroy();
    });
  }
}

/** Matched pairs: one histogram of (control − drug) per mouse */
export class HistogramDifference {
  constructor(container) {
    this.mode = "difference";
    this.binSpec = makeDiffBins();
    this.edges = this.binSpec.edges.map((e) => ({ ...e, count: 0 }));
    this.rawDiffs = [];
    container.className = "charts-grid charts-grid--1";
    container.innerHTML = `
      <div class="chart-box chart-box--wide">
        ${infoIconMarkup()}
        <h3>Paired difference (control − drug)</h3>
        <canvas id="chart-diff"></canvas>
      </div>
    `;
    this.chart = new Chart(container.querySelector("#chart-diff"), {
      type: "bar",
      data: {
        labels: this.binSpec.labels,
        datasets: [
          {
            label: "Mice",
            data: this.edges.map(() => 0),
            backgroundColor: "#2563ebcc",
            borderColor: "#2563eb",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `Difference: ${items[0]?.label ?? ""}s`,
              label: (ctx) => `${ctx.parsed.y} mouse${ctx.parsed.y === 1 ? "" : "es"}`,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Difference (s)" },
            ticks: { maxRotation: 0, minRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 9 } },
          },
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 9 } },
            title: { display: true, text: "Count" },
          },
        },
      },
    });
    requestAnimationFrame(() => this.chart.resize());
  }

  setTitles() {}

  updateStats() {
    setInfoTooltip(this.chart.canvas.closest(".chart-box"), formatStats(this.rawDiffs));
  }

  addDifference(diff) {
    const expanded = expandBinsToCoverValue(
      this.edges,
      this.binSpec,
      diff,
      CONFIG.diffBinWidth,
      makeDiffBins,
      (slot, existing) => ({
        ...slot,
        count: existing ? existing.count : 0,
      })
    );
    if (expanded.edges.length !== this.edges.length) {
      this.binSpec = { labels: expanded.labels, edges: expanded.edges };
      this.edges = expanded.edges;
      this.chart.data.labels = this.binSpec.labels;
    }

    const idx = valueToBinIndex(this.edges, diff);
    this.edges[idx].count += 1;
    this.rawDiffs.push(diff);

    this.chart.data.datasets[0].data = this.edges.map((e) => e.count);
    updateChart(this.chart);
    this.updateStats();
  }

  addDifferencesBatch(diffs) {
    let workingEdges = this.edges;
    let workingSpec = this.binSpec;

    for (const diff of diffs) {
      const expanded = expandBinsToCoverValue(
        workingEdges,
        workingSpec,
        diff,
        CONFIG.diffBinWidth,
        makeDiffBins,
        (slot, existing) => ({
          ...slot,
          count: existing ? existing.count : 0,
        })
      );
      workingEdges = expanded.edges;
      workingSpec = { labels: expanded.labels, edges: expanded.edges };

      const idx = valueToBinIndex(workingEdges, diff);
      workingEdges[idx].count += 1;
      this.rawDiffs.push(diff);
    }

    this.binSpec = workingSpec;
    this.edges = workingEdges;
    this.chart.data.labels = this.binSpec.labels;
    this.chart.data.datasets[0].data = this.edges.map((e) => e.count);
    updateChart(this.chart);
    this.updateStats();
  }

  reset() {
    this.edges.forEach((e) => (e.count = 0));
    this.rawDiffs = [];
    this.chart.data.datasets[0].data = this.edges.map(() => 0);
    updateChart(this.chart);
    this.updateStats();
  }

  destroy() {
    this.chart.destroy();
  }
}

export function createChartManager(assignmentType, container) {
  if (assignmentType === "block") return new HistogramBlockStacked(container);
  if (assignmentType === "matched") return new HistogramDifference(container);
  return new HistogramStacked(container);
}
