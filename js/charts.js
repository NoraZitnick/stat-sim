/**
 * charts.js — The three histogram layouts, one per assignment method:
 *   - HistogramStacked: random assignment — a Drug histogram and a Control
 *     histogram, side by side.
 *   - HistogramBlockStacked: block assignment — the same, but split again
 *     into a 2x2 grid by block, so each block's drug/control comparison
 *     can be read on its own.
 *   - HistogramDifference: matched pairs — one histogram of each individual's
 *     (control time − drug time), since that's the number that actually
 *     matters for this design.
 *
 * Every chart also gets a small hoverable "i" icon showing that chart's own
 * sample size, mean, and standard deviation — the numbers a student would
 * otherwise have to compute by hand from the bars.
 */

import { CONFIG, getCreatureBlocks, GROUP_COLORS, mean, round1, round2, stdDev } from "./config.js";

let max_count = 0;

const meanMarkerPlugin = {
  id: "meanMarker",
  afterDatasetsDraw(chart) {
    const meanValue = chart.$meanValue;
    if (!Number.isFinite(meanValue)) return;

    const xScale = chart.scales.x;
    const { left, right, top, bottom } = chart.chartArea;
    const xPosition = Math.max(left, Math.min(right, xScale.getPixelForValue(meanValue)));
    const { ctx } = chart;

    ctx.save();
    ctx.strokeStyle = "#111827";
    ctx.fillStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(xPosition, top);
    ctx.lineTo(xPosition, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "600 11px sans-serif";
    const label = `Mean: ${round2(meanValue)}s`;
    const labelWidth = ctx.measureText(label).width + 10;
    const labelHeight = 20;
    const labelLeft = Math.max(left, Math.min(right - labelWidth, xPosition + 5 + labelWidth <= right ? xPosition + 5 : xPosition - labelWidth - 5));
    const labelTop = top + 3;

    ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1;
    ctx.fillRect(labelLeft, labelTop, labelWidth, labelHeight);
    ctx.strokeRect(labelLeft, labelTop, labelWidth, labelHeight);
    ctx.fillStyle = "#111827";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, labelLeft + 5, labelTop + labelHeight / 2);
    ctx.restore();
  },
};

Chart.register(meanMarkerPlugin);

function setMeanMarker(chart, values, binSpec, binWidth) {
  chart.$meanValue = values.length > 0 ? mean(values) : null;
}

function runHistoryColors(edges, creature) {
  const colors = GROUP_COLORS[creature] ?? GROUP_COLORS.mouse;
  return {
    background: edges.map((edge) => `${edge.end <= 0 ? colors.control : colors.drug}cc`),
    border: edges.map((edge) => edge.end <= 0 ? colors.control : colors.drug),
  };
}

function formatStats(values) {
  if (values.length === 0) return "No data yet";
  return `n = ${values.length}\nMean = ${round2(mean(values))}s\nSD = ${round2(stdDev(values))}s`;
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
    // A chart may be destroyed or detached by a mode switch before this fires.
    if (!chart.canvas?.isConnected) return;
    chart.resize();
    chart.update();
  }, 0);
}

function getAxisDomain(edges, binWidth, maxTicks) {
  const minValue = edges[0].start;
  const maxValue = edges[edges.length - 1].end;
  let stepSize = binWidth;

  while (true) {
    const min = Math.floor(minValue / stepSize) * stepSize;
    const max = Math.ceil(maxValue / stepSize) * stepSize;
    if ((max - min) / stepSize + 1 <= maxTicks) return { min, max, stepSize };
    stepSize += binWidth;
  }
}

function numericAxisOptions(title, edges, binWidth, maxTicks) {
  const domain = getAxisDomain(edges, binWidth, maxTicks);
  return {
    type: "linear",
    offset: false,
    min: domain.min,
    max: domain.max,
    title: { display: true, text: title },
    grid: { offset: false },
    ticks: {
      stepSize: domain.stepSize,
      maxRotation: 0,
      minRotation: 0,
      autoSkip: false,
      maxTicksLimit: maxTicks,
      font: { size: 9 },
    },
  };
}

function updateNumericAxis(chart, edges, binWidth) {
  const xAxis = chart.options.scales.x;
  const domain = getAxisDomain(edges, binWidth, xAxis.ticks.maxTicksLimit);
  xAxis.min = domain.min;
  xAxis.max = domain.max;
  xAxis.ticks.stepSize = domain.stepSize;
}

function binPoints(edges, getCount) {
  return edges.map((edge) => ({
    x: (edge.start + edge.end) / 2,
    y: getCount(edge),
    start: edge.start,
    end: edge.end,
  }));
}

function binRangeLabel(point, title) {
  return `${title}: ${round1(point.start)}–${round1(point.end)}s`;
}

function stackedOptions(binSpec, binWidth, xTitle = "Time (s)", yTitle = "Count") {
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
          title: (items) => binRangeLabel(items[0]?.raw, "Time"),
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} individual${ctx.parsed.y === 1 ? "" : "es"}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        ...numericAxisOptions(xTitle, binSpec.edges, binWidth, 6),
      },
      y: {
        stacked: true,
        beginAtZero: true,
        min: 0,
        ticks: { stepSize: 1, font: { size: 9 } },
        title: { display: true, text: yTitle },
        max: Math.max(1, max_count),
      },
    },
  };
}

function formatBinLabel(start, end) {
  return `${start}`;
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

function makeDiffBins(binMin = CONFIG.diffBinMin, binMax = CONFIG.diffBinMax, binWidth = CONFIG.diffBinWidth) {
  const labels = [];
  const edges = [];
  for (let start = binMin; start < binMax; start += binWidth) {
    const end = start + binWidth;
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
    : minStart;
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
 * Grow the shared bin range (used across all block charts) just enough to cover a
 * new value — never shrinks and never drops bins that already hold data. Recomputing
 * the range from only the currently non-empty bins (the old approach) could silently
 * discard counts sitting outside the new narrower window, which is what produced the
 * "cut off" tail on charts whose values already reached lower than other blocks'.
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
          data: binPoints(binSpec.edges, (_, index) => values[index]),
          backgroundColor: color + "cc",
          borderColor: color,
          borderWidth: 1,
          // barThickness: "flex",
          // categoryPercentage: 0.9,
          // barPercentage: 0.95,
        },
      ],
    },
    options: stackedOptions(binSpec, CONFIG.binWidth),
  });
  return chart;
}

function syncSeparateCharts(charts, edges) {
  charts.drug.data.datasets[0].data = binPoints(edges, (edge) => edge.drug);
  charts.control.data.datasets[0].data = binPoints(edges, (edge) => edge.control);
  updateNumericAxis(charts.drug, edges, CONFIG.binWidth);
  updateNumericAxis(charts.control, edges, CONFIG.binWidth);
  max_count = Math.max(1, ...edges.map((e) => e.control), ...edges.map((e) => e.drug));
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
    entry.charts.drug.data.datasets[0].data = binPoints(entry.edges, (edge) => edge.drug);
    entry.charts.control.data.datasets[0].data = binPoints(entry.edges, (edge) => edge.control);
    updateNumericAxis(entry.charts.drug, entry.edges, CONFIG.binWidth);
    updateNumericAxis(entry.charts.control, entry.edges, CONFIG.binWidth);
    entry.charts.drug.options.scales.y.max = sharedMax;
    entry.charts.control.options.scales.y.max = sharedMax;
    updateChart(entry.charts.drug);
    updateChart(entry.charts.control);
  }
}

/** Two separate histograms: drug above, control below */
export class HistogramStacked {
  constructor(container, colors = GROUP_COLORS.mouse) {
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
        colors.drug
      ),
      control: buildSeparateHistogramChart(
        container.querySelector("#chart-control"),
        this.binSpec,
        this.edges.map((e) => e.control),
        "Control",
        colors.control
      ),
    };
    this.updateStats();
  }

  setTitles() {}

  updateStats() {
    setMeanMarker(this.charts.drug, this.rawDrug, this.binSpec, CONFIG.binWidth);
    setMeanMarker(this.charts.control, this.rawControl, this.binSpec, CONFIG.binWidth);
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

/** Four block-specific histograms, each with separate drug/control panels */
export class HistogramBlockStacked {
  constructor(container, colors = GROUP_COLORS.mouse, creature = "mouse") {
    this.mode = "block";
    this.binSpec = makeTimeBins();
    container.className = "charts-grid charts-grid--4";

    this.blocks = getCreatureBlocks(creature).map((entry, i) => {
      return { block: i, name: entry.name };
    });

    // Laid out as a 2x2 grid in DOM order (grid auto-placement fills left-to-right,
    // top-to-bottom): top row = drug for each block, bottom row = control for each
    // block — so top-left/top-right are block 0/1 drugged, bottom-left/bottom-right
    // are block 0/1 control.
    const groups = [
      { key: "drug", label: "Drug" },
      { key: "control", label: "Control" },
    ];

    container.innerHTML = groups
      .map((g) =>
        this.blocks
          .map(
            (l) => `
      <div class="chart-box chart-box--quad">
        ${infoIconMarkup()}
        <h3>${l.name} — ${g.label}</h3>
        <canvas id="chart-${l.block}-${g.key}"></canvas>
      </div>`
          )
          .join("")
      )
      .join("");

    this.charts = this.blocks.map((l) => {
      const edges = freshTimeEdges(this.binSpec);
      return {
        block: l.block,
        edges,
        rawDrug: [],
        rawControl: [],
        charts: {
          drug: buildSeparateHistogramChart(
            container.querySelector(`#chart-${l.block}-drug`),
            this.binSpec,
            edges.map((e) => e.drug),
            "Drug",
            colors.drug
          ),
          control: buildSeparateHistogramChart(
            container.querySelector(`#chart-${l.block}-control`),
            this.binSpec,
            edges.map((e) => e.control),
            "Control",
            colors.control
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
      setMeanMarker(entry.charts.drug, entry.rawDrug, this.binSpec, CONFIG.binWidth);
      setMeanMarker(entry.charts.control, entry.rawControl, this.binSpec, CONFIG.binWidth);
      setInfoTooltip(entry.charts.drug.canvas.closest(".chart-box"), formatStats(entry.rawDrug));
      setInfoTooltip(entry.charts.control.canvas.closest(".chart-box"), formatStats(entry.rawControl));
    }
  }

  addResult(group, time, block) {
    const entry = this.charts.find((c) => c.block === block);
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
    for (const { group, time, block } of records) {
      const entry = this.charts.find((c) => c.block === block);
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

/** Matched pairs: one histogram of (control − drug) per individual */
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
            label: "Individuals",
            data: binPoints(this.edges, (edge) => edge.count),
            backgroundColor: "#2563ebcc",
            borderColor: "#2563eb",
            borderWidth: 1,
            // barThickness: "flex",
            // categoryPercentage: 0.9,
            // barPercentage: 0.95,
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
              title: (items) => binRangeLabel(items[0]?.raw, "Difference"),
              label: (ctx) => `${ctx.parsed.y} individual${ctx.parsed.y === 1 ? "" : "es"}`,
            },
          },
        },
        scales: {
          x: {
            ...numericAxisOptions("Difference (s)", this.binSpec.edges, CONFIG.diffBinWidth, 8),
          },
          y: {
            beginAtZero: true,
            min: 0,
            ticks: { stepSize: 1, font: { size: 9 } },
            title: { display: true, text: "Count" },
          },
        },
      },
    });
    const chart = this.chart;
    requestAnimationFrame(() => {
      if (chart.canvas?.isConnected) chart.resize();
    });
  }

  setTitles() {}

  updateStats() {
    setMeanMarker(this.chart, this.rawDiffs, this.binSpec, CONFIG.diffBinWidth);
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

    this.chart.data.datasets[0].data = binPoints(this.edges, (edge) => edge.count);
    updateNumericAxis(this.chart, this.edges, CONFIG.diffBinWidth);
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
    this.chart.data.datasets[0].data = binPoints(this.edges, (edge) => edge.count);
    updateNumericAxis(this.chart, this.edges, CONFIG.diffBinWidth);
    updateChart(this.chart);
    this.updateStats();
  }

  reset() {
    this.edges.forEach((e) => (e.count = 0));
    this.rawDiffs = [];
    this.chart.data.datasets[0].data = binPoints(this.edges, () => 0);
    updateNumericAxis(this.chart, this.edges, CONFIG.diffBinWidth);
    updateChart(this.chart);
    this.updateStats();
  }

  destroy() {
    this.chart.destroy();
  }
}

export class HistogramRunHistory {
  constructor(container, records = [[], [], []], assignmentType, creature = "mouse") {
    this.mode = "multi-run";
    this.container = container;
    this.charts = [];
    this.setAssignment(assignmentType, creature);
    this.syncFromRecords(records, assignmentType, creature);
  }

  setAssignment(assignmentType, creature = this.creature) {
    if (this.assignmentType === assignmentType && this.creature === creature) return;
    this.charts.forEach(({ chart }) => chart.destroy());
    this.assignmentType = assignmentType;
    this.creature = creature;
    const blocks = assignmentType === "block" ? getCreatureBlocks(creature) : null;
    const entries = blocks
      ? blocks.map((entry, block) => ({ block, title: `${entry.name} block differences` }))
      : [{ block: null, title: "Recorded run differences" }];

    this.container.className = `charts-grid charts-grid--${entries.length}`;
    this.container.innerHTML = entries.map((entry, index) => `
      <div class="chart-box chart-box--wide">
        ${infoIconMarkup()}
        <h3>${entry.title}</h3>
        <canvas id="chart-run-history-${index}"></canvas>
      </div>
    `).join("");

    this.charts = entries.map((entry, index) => {
      const binSpec = makeDiffBins(
        CONFIG.diffBinMin,
        CONFIG.diffBinMax,
        CONFIG.diffBinWidthMultiGraph
      );
      const edges = binSpec.edges.map((edge) => ({ ...edge, count: 0 }));
      const chart = new Chart(this.container.querySelector(`#chart-run-history-${index}`), {
        type: "bar",
        data: {
          labels: binSpec.labels,
          datasets: [{
            label: "Frequency",
            data: binPoints(edges, (edge) => edge.count),
            backgroundColor: runHistoryColors(edges, creature).background,
            borderColor: runHistoryColors(edges, creature).border,
            borderWidth: 1,
            // barThickness: "flex",
            // categoryPercentage: 0.9,
            // barPercentage: 0.95,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 200 },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => binRangeLabel(items[0]?.raw, "Difference"),
                label: (ctx) => `${ctx.parsed.y} run${ctx.parsed.y === 1 ? "" : "s"}`,
              },
            },
          },
          scales: {
            x: {
              ...numericAxisOptions("Difference (s)", binSpec.edges, CONFIG.diffBinWidthMultiGraph, 8),
            },
            y: {
              beginAtZero: true,
              min: 0,
              ticks: { stepSize: 1, font: { size: 9 } },
              title: { display: true, text: "Frequency" },
            },
          },
        },
      });
      return { ...entry, binSpec, edges, rawDiffs: [], chart };
    });
  }

  syncFromRecords(records, assignmentType = this.assignmentType, creature = this.creature) {
    this.setAssignment(assignmentType, creature);
    const runRecords = records[assignmentType === "random" ? 0 : assignmentType === "block" ? 1 : 2]
      .slice(1)
      .map((run) => Array.isArray(run)
        ? run.map((entry) => ({
          ...entry,
          difference: entry.difference * CONFIG.animTimeScale,
        }))
        : run * CONFIG.animTimeScale);

    for (const state of this.charts) {
      const values = state.block === null
        ? runRecords
        : runRecords.flatMap((run) => run
          .filter((entry) => entry.block === state.block)
          .map((entry) => entry.difference));
      state.rawDiffs = values;

      let workingEdges = state.binSpec.edges.map((edge) => ({ ...edge, count: 0 }));
      let workingSpec = state.binSpec;
      for (const diff of values) {
        const expanded = expandBinsToCoverValue(
          workingEdges,
          workingSpec,
          diff,
          CONFIG.diffBinWidthMultiGraph,
          (binMin, binMax) => makeDiffBins(binMin, binMax, CONFIG.diffBinWidthMultiGraph),
          (slot, existing) => ({ ...slot, count: existing ? existing.count : 0 })
        );
        workingEdges = expanded.edges;
        workingSpec = { labels: expanded.labels, edges: expanded.edges };
        workingEdges[valueToBinIndex(workingEdges, diff)].count += 1;
      }

      state.binSpec = workingSpec;
      state.edges = workingEdges;
      state.chart.data.labels = workingSpec.labels;
      state.chart.data.datasets[0].data = binPoints(workingEdges, (edge) => edge.count);
      updateNumericAxis(state.chart, workingEdges, CONFIG.diffBinWidthMultiGraph);
      const colors = runHistoryColors(workingEdges, creature);
      state.chart.data.datasets[0].backgroundColor = colors.background;
      state.chart.data.datasets[0].borderColor = colors.border;
      updateChart(state.chart);
      this.updateStats(state);
    }
  }

  updateStats(state) {
    setMeanMarker(state.chart, state.rawDiffs, state.binSpec, CONFIG.diffBinWidthMultiGraph);
    setInfoTooltip(state.chart.canvas.closest(".chart-box"), formatStats(state.rawDiffs));
  }

  getFasterRunCounts() {
    return this.charts.map((state) => ({
      title: state.title,
      total: state.rawDiffs.length,
      faster: state.rawDiffs.filter((difference) => difference > 0).length,
    }));
  }

  reset() {
    this.syncFromRecords([[], [], []], this.assignmentType, this.creature);
  }

  destroy() {
    this.charts.forEach(({ chart }) => chart.destroy());
  }

  addResultsBatch(records) {}
  addResult(group, time, block) {}
  addDifference(diff) {}
  addDifferencesBatch(diffs) {}

}

export function createChartManager(assignmentType, container, mode = "run", diffRecords = [[], [], []], creature = "mouse") {
  if (mode === "multi") return new HistogramRunHistory(container, diffRecords, assignmentType, creature);
  const colors = GROUP_COLORS[creature] ?? GROUP_COLORS.mouse;
  if (assignmentType === "block") return new HistogramBlockStacked(container, colors, creature);
  if (assignmentType === "matched") return new HistogramDifference(container);
  return new HistogramStacked(container, colors);
}
