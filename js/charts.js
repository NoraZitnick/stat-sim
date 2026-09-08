/**
 * charts.js — Stacked histograms and matched-pair difference chart
 *
 * Stack order (bottom → top): Drug (green), Control (gray)
 */

import { CONFIG, LITTER_FUR } from "./config.js";

const DRUG_COLOR = "#16a34a";
const CONTROL_COLOR = "#64748b";

function stackedOptions(xTitle = "Seconds", yTitle = "Count") {
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
        ticks: { maxRotation: 45, minRotation: 45, font: { size: 9 } },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: { stepSize: 1, font: { size: 9 } },
        title: { display: true, text: yTitle },
      },
    },
  };
}

function makeTimeBins() {
  const { binWidth, binMin, binMax } = CONFIG;
  const labels = [];
  const edges = [];
  for (let start = binMin; start < binMax; start += binWidth) {
    labels.push(`${start}–${start + binWidth}`);
    edges.push({ start, end: start + binWidth, drug: 0, control: 0 });
  }
  return { labels, edges };
}

function makeDiffBins() {
  const { diffBinWidth, diffBinMin, diffBinMax } = CONFIG;
  const labels = [];
  const edges = [];
  for (let start = diffBinMin; start < diffBinMax; start += diffBinWidth) {
    const end = start + diffBinWidth;
    labels.push(`${start}–${end}`);
    edges.push({ start, end, count: 0 });
  }
  return { labels, edges };
}

function valueToBinIndex(edges, value) {
  for (let i = 0; i < edges.length; i++) {
    if (value >= edges[i].start && value < edges[i].end) return i;
  }
  return edges.length - 1;
}

function freshTimeEdges(binSpec) {
  return binSpec.edges.map((e) => ({ ...e, drug: 0, control: 0 }));
}

function buildStackedChart(canvas, binSpec, edges) {
  return new Chart(canvas, {
    type: "bar",
    data: {
      labels: binSpec.labels,
      datasets: [
        {
          label: "Drug",
          data: edges.map(() => 0),
          backgroundColor: DRUG_COLOR + "cc",
          borderColor: DRUG_COLOR,
          borderWidth: 1,
        },
        {
          label: "Control",
          data: edges.map(() => 0),
          backgroundColor: CONTROL_COLOR + "cc",
          borderColor: CONTROL_COLOR,
          borderWidth: 1,
        },
      ],
    },
    options: stackedOptions(),
  });
}

function syncStackedChart(chart, edges) {
  chart.data.datasets[0].data = edges.map((e) => e.drug);
  chart.data.datasets[1].data = edges.map((e) => e.control);
  chart.update("none");
}

/** One stacked histogram: drug (bottom) + control (top) */
export class HistogramStacked {
  constructor(container, title = "Completion times") {
    this.mode = "stacked";
    this.binSpec = makeTimeBins();
    this.edges = freshTimeEdges(this.binSpec);
    container.className = "charts-grid charts-grid--1";
    container.innerHTML = `
      <div class="chart-box chart-box--wide">
        <h3>${title}</h3>
        <canvas id="chart-stacked"></canvas>
      </div>
    `;
    this.chart = buildStackedChart(
      container.querySelector("#chart-stacked"),
      this.binSpec,
      this.edges
    );
  }

  setTitles() {}

  addResult(group, time) {
    const idx = valueToBinIndex(this.edges, time);
    if (group === "drug") this.edges[idx].drug += 1;
    else this.edges[idx].control += 1;
    syncStackedChart(this.chart, this.edges);
  }

  addResultsBatch(records) {
    for (const { group, time } of records) {
      const idx = valueToBinIndex(this.edges, time);
      if (group === "drug") this.edges[idx].drug += 1;
      else this.edges[idx].control += 1;
    }
    syncStackedChart(this.chart, this.edges);
  }

  reset() {
    this.edges.forEach((e) => {
      e.drug = 0;
      e.control = 0;
    });
    syncStackedChart(this.chart, this.edges);
  }

  destroy() {
    this.chart.destroy();
  }
}

/** Two stacked histograms — one per litter (block assignment) */
export class HistogramBlockStacked {
  constructor(container) {
    this.mode = "block";
    this.binSpec = makeTimeBins();
    container.className = "charts-grid charts-grid--2";

    this.litters = LITTER_FUR.map((fur, i) => {
      const id = `l${i}`;
      return { litter: i, name: fur.name };
    });

    container.innerHTML = this.litters
      .map(
        (l) => `
      <div class="chart-box">
        <h3>${l.name} litter</h3>
        <canvas id="chart-${l.litter}"></canvas>
      </div>`
      )
      .join("");

    this.charts = this.litters.map((l) => {
      const edges = freshTimeEdges(this.binSpec);
      const chart = buildStackedChart(
        container.querySelector(`#chart-${l.litter}`),
        this.binSpec,
        edges
      );
      return { litter: l.litter, chart, edges };
    });
  }

  setTitles() {}

  addResult(group, time, litter) {
    const entry = this.charts.find((c) => c.litter === litter);
    if (!entry) return;
    const idx = valueToBinIndex(entry.edges, time);
    if (group === "drug") entry.edges[idx].drug += 1;
    else entry.edges[idx].control += 1;
    syncStackedChart(entry.chart, entry.edges);
  }

  addResultsBatch(records) {
    for (const { group, time, litter } of records) {
      const entry = this.charts.find((c) => c.litter === litter);
      if (!entry) continue;
      const idx = valueToBinIndex(entry.edges, time);
      if (group === "drug") entry.edges[idx].drug += 1;
      else entry.edges[idx].control += 1;
    }
    for (const entry of this.charts) {
      syncStackedChart(entry.chart, entry.edges);
    }
  }

  reset() {
    for (const entry of this.charts) {
      entry.edges.forEach((e) => {
        e.drug = 0;
        e.control = 0;
      });
      syncStackedChart(entry.chart, entry.edges);
    }
  }

  destroy() {
    this.charts.forEach((c) => c.chart.destroy());
  }
}

/** Matched pairs: one histogram of (control − drug) per mouse */
export class HistogramDifference {
  constructor(container) {
    this.mode = "difference";
    this.binSpec = makeDiffBins();
    this.edges = this.binSpec.edges.map((e) => ({ ...e, count: 0 }));
    container.className = "charts-grid charts-grid--1";
    container.innerHTML = `
      <div class="chart-box chart-box--wide">
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
            title: { display: true, text: "Seconds (control − drug)" },
            ticks: { maxRotation: 45, minRotation: 45, font: { size: 9 } },
          },
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 9 } },
            title: { display: true, text: "Count" },
          },
        },
      },
    });
  }

  setTitles() {}

  addDifference(diff) {
    const idx = valueToBinIndex(this.edges, diff);
    this.edges[idx].count += 1;
    this.chart.data.datasets[0].data[idx] = this.edges[idx].count;
    this.chart.update("none");
  }

  addDifferencesBatch(diffs) {
    for (const diff of diffs) {
      const idx = valueToBinIndex(this.edges, diff);
      this.edges[idx].count += 1;
    }
    this.chart.data.datasets[0].data = this.edges.map((e) => e.count);
    this.chart.update("none");
  }

  reset() {
    this.edges.forEach((e) => (e.count = 0));
    this.chart.data.datasets[0].data = this.edges.map(() => 0);
    this.chart.update("none");
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
