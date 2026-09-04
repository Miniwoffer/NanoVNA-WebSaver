/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Every chart the desktop application offers, described as data. A
// frequency chart is just a name plus the value to take from each point.

import { FrequencyChart, shortNumber } from './frequency.js';
import { PolarChart, SmithChart } from './smith.js';
import { TDRChart } from './tdrchart.js';
import {
  cAbs,
  cDiv,
  cScale,
  cx,
  groupDelay,
  impedanceToCapacitance,
  impedanceToInductance,
} from '../rf/rftools.js';

/** Vacuum permeability, as scipy.constants.mu_0. */
const MU_0 = 1.25663706212e-6;

/**
 * Core geometry for the permeability charts, in the units the desktop
 * dialog uses: millimetres and square millimetres.
 */
export const coreParameters = { length: 1.0, area: 1.0, windings: 1 };

const MU = 'µ';
const OHM = 'Ω';

/** Relative permeability of the core a winding is measured on. */
function muR(dp, refImpedance = 50) {
  const impedance = dp.impedance(refImpedance);
  // inductance = z / (2j * pi * f)
  const inductance = cDiv(impedance, cx(0, 2 * Math.PI * dp.freq));
  const scale =
    coreParameters.length / 1e3 /
    (MU_0 * coreParameters.windings ** 2 * (coreParameters.area / 1e6));
  const scaled = cScale(inductance, scale);
  // mu_r = mu' - j mu''
  return { re: scaled.re, im: -scaled.im };
}

const dB = (v) => `${shortNumber(v)} dB`;
const degrees = (v) => `${shortNumber(v)}°`;
const ohms = (v) => `${shortNumber(v)} ${OHM}`;
const seconds = (v) => `${shortNumber(v)} s`;
const farads = (v) => `${shortNumber(v)} F`;
const henries = (v) => `${shortNumber(v)} H`;

/**
 * The catalogue.
 *
 * `series` entries take a value from a data point; `colorKey` selects
 * the trace colour so a two value chart can tell its lines apart.
 */
export const CHART_TYPES = [
  // ---- S11 -------------------------------------------------------
  {
    key: 's11_log_mag',
    name: 'S11 Return Loss',
    group: 'S11',
    kind: 'frequency',
    unit: 'dB',
    formatY: dB,
    series: [{ source: 's11', label: 'Return loss', value: (dp) => dp.gain }],
  },
  {
    key: 's11_smith',
    name: 'S11 Smith Chart',
    group: 'S11',
    kind: 'smith',
    series: [{ source: 's11', label: 'S11' }],
  },
  {
    key: 's11_vswr',
    name: 'S11 VSWR',
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    logarithmicYAllowed: true,
    referenceLines: [1.5, 2.0, 3.0],
    series: [{ source: 's11', label: 'VSWR', value: (dp) => dp.vswr }],
  },
  {
    key: 's11_phase',
    name: 'S11 Phase',
    group: 'S11',
    kind: 'frequency',
    unit: '°',
    formatY: degrees,
    series: [
      { source: 's11', label: 'Phase', value: (dp) => (dp.phase * 180) / Math.PI },
    ],
  },
  {
    key: 's11_magnitude',
    name: '|S11|',
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    logarithmicYAllowed: true,
    series: [{ source: 's11', label: '|S11|', value: (dp) => cAbs(dp.z) }],
  },
  {
    key: 's11_magnitude_z',
    name: 'S11 |Z|',
    group: 'S11',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    logarithmicYAllowed: true,
    series: [
      { source: 's11', label: '|Z|', value: (dp) => cAbs(dp.impedance()) },
    ],
  },
  {
    key: 's11_real_imag',
    name: 'S11 R+jX',
    group: 'S11',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    series: [
      { source: 's11', label: 'R', value: (dp) => dp.impedance().re, colorKey: 'sweep' },
      {
        source: 's11',
        label: 'X',
        value: (dp) => dp.impedance().im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 's11_q_factor',
    name: 'S11 Quality Factor',
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    series: [{ source: 's11', label: 'Q', value: (dp) => dp.qFactor() }],
  },
  {
    key: 's11_group_delay',
    name: 'S11 Group Delay',
    group: 'S11',
    kind: 'frequency',
    unit: 's',
    formatY: seconds,
    series: [
      { source: 's11', label: 'Group delay', value: (dp, i, data) => groupDelay(data, i) },
    ],
  },
  {
    key: 's11_capacitance',
    name: 'S11 Serial C',
    group: 'S11',
    kind: 'frequency',
    unit: 'F',
    formatY: farads,
    series: [
      {
        source: 's11',
        label: 'Series C',
        value: (dp) => impedanceToCapacitance(dp.impedance(), dp.freq),
      },
    ],
  },
  {
    key: 's11_inductance',
    name: 'S11 Serial L',
    group: 'S11',
    kind: 'frequency',
    unit: 'H',
    formatY: henries,
    series: [
      {
        source: 's11',
        label: 'Series L',
        value: (dp) => impedanceToInductance(dp.impedance(), dp.freq),
      },
    ],
  },
  {
    key: 's11_s_parameter',
    name: 'S11 Real/Imaginary',
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    series: [
      { source: 's11', label: 'Real', value: (dp) => dp.re, colorKey: 'sweep' },
      {
        source: 's11',
        label: 'Imaginary',
        value: (dp) => dp.im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 's11_permeability',
    name: `S11 Permeability (${MU}${OHM} / Hz)`,
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    logarithmicYAllowed: true,
    series: [
      {
        source: 's11',
        label: "R'",
        value: (dp) => (dp.impedance().re * 10e6) / dp.freq,
        colorKey: 'sweep',
      },
      {
        source: 's11',
        label: "X'",
        value: (dp) => (dp.impedance().im * 10e6) / dp.freq,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 's11_real_imag_mu',
    name: `S11 ${MU}'/${MU}''`,
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    series: [
      { source: 's11', label: `${MU}'`, value: (dp) => muR(dp).re, colorKey: 'sweep' },
      {
        source: 's11',
        label: `${MU}''`,
        value: (dp) => muR(dp).im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },

  // ---- S21 -------------------------------------------------------
  {
    key: 's21_log_mag',
    name: 'S21 Gain',
    group: 'S21',
    kind: 'frequency',
    unit: 'dB',
    formatY: dB,
    series: [{ source: 's21', label: 'Gain', value: (dp) => dp.gain }],
  },
  {
    key: 's21_phase',
    name: 'S21 Phase',
    group: 'S21',
    kind: 'frequency',
    unit: '°',
    formatY: degrees,
    series: [
      { source: 's21', label: 'Phase', value: (dp) => (dp.phase * 180) / Math.PI },
    ],
  },
  {
    key: 's21_polar',
    name: 'S21 Polar Plot',
    group: 'S21',
    kind: 'polar',
    series: [{ source: 's21', label: 'S21' }],
  },
  {
    key: 's21_magnitude',
    name: '|S21|',
    group: 'S21',
    kind: 'frequency',
    formatY: shortNumber,
    logarithmicYAllowed: true,
    series: [{ source: 's21', label: '|S21|', value: (dp) => cAbs(dp.z) }],
  },
  {
    key: 's21_group_delay',
    name: 'S21 Group Delay',
    group: 'S21',
    kind: 'frequency',
    unit: 's',
    formatY: seconds,
    series: [
      {
        source: 's21',
        label: 'Group delay',
        // the desktop halves the S21 group delay
        value: (dp, i, data) => groupDelay(data, i) / 2,
      },
    ],
  },
  {
    key: 's21_magnitude_z_shunt',
    name: 'S21 |Z| shunt',
    group: 'S21',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    logarithmicYAllowed: true,
    series: [
      { source: 's21', label: '|Z| shunt', value: (dp) => cAbs(dp.shuntImpedance()) },
    ],
  },
  {
    key: 's21_magnitude_z_series',
    name: 'S21 |Z| series',
    group: 'S21',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    logarithmicYAllowed: true,
    series: [
      { source: 's21', label: '|Z| series', value: (dp) => cAbs(dp.seriesImpedance()) },
    ],
  },
  {
    key: 's21_real_imag_shunt',
    name: 'S21 R+jX shunt',
    group: 'S21',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    series: [
      { source: 's21', label: 'R', value: (dp) => dp.shuntImpedance().re, colorKey: 'sweep' },
      {
        source: 's21',
        label: 'X',
        value: (dp) => dp.shuntImpedance().im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 's21_real_imag_series',
    name: 'S21 R+jX series',
    group: 'S21',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    series: [
      { source: 's21', label: 'R', value: (dp) => dp.seriesImpedance().re, colorKey: 'sweep' },
      {
        source: 's21',
        label: 'X',
        value: (dp) => dp.seriesImpedance().im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 's21_s_parameter',
    name: 'S21 Real/Imaginary',
    group: 'S21',
    kind: 'frequency',
    formatY: shortNumber,
    series: [
      { source: 's21', label: 'Real', value: (dp) => dp.re, colorKey: 'sweep' },
      {
        source: 's21',
        label: 'Imaginary',
        value: (dp) => dp.im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },

  // ---- combined --------------------------------------------------
  {
    key: 'combined_log_mag',
    name: 'S11 & S21 LogMag',
    group: 'Combined',
    kind: 'frequency',
    unit: 'dB',
    formatY: dB,
    series: [
      { source: 's11', label: 'S11', value: (dp) => dp.gain, colorKey: 'sweep' },
      {
        source: 's21',
        label: 'S21',
        value: (dp) => dp.gain,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 'tdr',
    name: 'TDR',
    group: 'Combined',
    kind: 'tdr',
    series: [],
  },
];

export const CHART_TYPES_BY_KEY = new Map(CHART_TYPES.map((t) => [t.key, t]));

export function createChart(key) {
  const definition = CHART_TYPES_BY_KEY.get(key);
  if (!definition) throw new RangeError(`Unknown chart type: ${key}`);
  switch (definition.kind) {
    case 'smith':
      return new SmithChart(definition);
    case 'polar':
      return new PolarChart(definition);
    case 'tdr':
      return new TDRChart(definition);
    default:
      return new FrequencyChart(definition);
  }
}

// ---------------------------------------------------------------- panels
//
// The chart grid is a dashboard of Panels, each a grid tile holding an
// ordered list of Layers. A Layer names one chart-registry key and, for
// chart types that plot against frequency, which of the panel's two Y
// axes it belongs on:
//
//   {
//     id: 'panel-3',
//     colSpan: 2, rowSpan: 1,
//     layers: [
//       { chartKey: 's11_log_mag', axis: 'left' },
//       { chartKey: 's11_vswr', axis: 'right' },
//     ],
//     axisLimits: {
//       left:  { mode: 'auto', min: 0, max: 1 },
//       right: { mode: 'auto', min: 0, max: 1 },
//     },
//   }
//
// axisLimits lives on the panel rather than the layer: an axis is shared
// by every layer drawn on it, so only one {mode,min,max} per side makes
// sense. It is always present, even on a panel with no frequency-kind
// layers, so rendering code never needs to guard against it being absent.

/** How many rows tall a panel may span. */
export const MAX_ROW_SPAN = 3;

let nextPanelId = 1;

/** A fresh, unique-within-this-page-load panel id. */
export function makePanelId() {
  const id = `panel-${nextPanelId}`;
  nextPanelId += 1;
  return id;
}

/** Round and clamp a span value into [1, max]. */
export function clampSpan(value, max) {
  return Math.min(max, Math.max(1, Math.round(Number(value) || 1)));
}

export function defaultAxisLimits() {
  return {
    left: { mode: 'auto', min: 0, max: 1 },
    right: { mode: 'auto', min: 0, max: 1 },
  };
}

function normalizeAxisLimits(input) {
  const limits = defaultAxisLimits();
  if (!input) return limits;
  for (const side of ['left', 'right']) {
    const axis = input[side];
    if (axis && (axis.mode === 'fixed' || axis.mode === 'auto')) {
      limits[side] = {
        mode: axis.mode,
        min: Number.isFinite(axis.min) ? axis.min : 0,
        max: Number.isFinite(axis.max) ? axis.max : 1,
      };
    }
  }
  return limits;
}

function normalizeLayer(layer) {
  if (!layer || !CHART_TYPES_BY_KEY.has(layer.chartKey)) return null;
  return { chartKey: layer.chartKey, axis: layer.axis === 'right' ? 'right' : 'left' };
}

/**
 * Bring one layout entry into the current Panel shape.
 *
 * Accepts either a bare chart-registry key (the format this application
 * shipped with before panels existed) or an already-Panel-shaped object,
 * possibly from an older version of this schema. Returns null when the
 * entry cannot be salvaged (an unknown chart type, or no layers left).
 */
function normalizePanel(entry) {
  if (typeof entry === 'string') {
    if (!CHART_TYPES_BY_KEY.has(entry)) return null;
    return {
      id: makePanelId(),
      colSpan: 1,
      rowSpan: 1,
      layers: [{ chartKey: entry, axis: 'left' }],
      axisLimits: defaultAxisLimits(),
    };
  }
  if (!entry || !Array.isArray(entry.layers)) return null;
  const layers = entry.layers.map(normalizeLayer).filter(Boolean);
  if (!layers.length) return null;
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : makePanelId(),
    colSpan: clampSpan(entry.colSpan, 4),
    rowSpan: clampSpan(entry.rowSpan, MAX_ROW_SPAN),
    layers,
    axisLimits: normalizeAxisLimits(entry.axisLimits),
  };
}

/**
 * Bring a whole `settings.layout` into the current Panel[] shape.
 *
 * Never throws and never returns an empty layout: invalid or unknown
 * entries are dropped, and a layout left with nothing valid at all falls
 * back to {@link defaultLayout}.
 */
export function normalizeLayout(layout) {
  if (!Array.isArray(layout)) return defaultLayout();
  const panels = layout.map(normalizePanel).filter(Boolean);
  return panels.length ? panels : defaultLayout();
}

/** Re-clamp every panel's colSpan after `settings.columns` changes. */
export function clampLayoutToColumns(layout, columns) {
  return layout.map((panel) => ({ ...panel, colSpan: clampSpan(panel.colSpan, columns) }));
}

/**
 * The layout a fresh install (or a settings reset) starts with.
 *
 * Deliberately shows off both new capabilities rather than just porting
 * the previous six single-chart panels forward unchanged: the first
 * panel combines Return Loss and VSWR on a shared/dual axis and spans
 * two columns, so the feature is visible the moment the page loads.
 */
export function defaultLayout() {
  return [
    {
      id: makePanelId(),
      colSpan: 2,
      rowSpan: 1,
      layers: [
        { chartKey: 's11_log_mag', axis: 'left' },
        { chartKey: 's11_vswr', axis: 'right' },
      ],
      axisLimits: defaultAxisLimits(),
    },
    {
      id: makePanelId(),
      colSpan: 1,
      rowSpan: 1,
      layers: [{ chartKey: 's11_smith', axis: 'left' }],
      axisLimits: defaultAxisLimits(),
    },
    {
      id: makePanelId(),
      colSpan: 1,
      rowSpan: 1,
      layers: [{ chartKey: 's21_log_mag', axis: 'left' }],
      axisLimits: defaultAxisLimits(),
    },
    {
      id: makePanelId(),
      colSpan: 1,
      rowSpan: 1,
      layers: [{ chartKey: 's11_phase', axis: 'left' }],
      axisLimits: defaultAxisLimits(),
    },
    {
      id: makePanelId(),
      colSpan: 1,
      rowSpan: 1,
      layers: [{ chartKey: 'tdr', axis: 'left' }],
      axisLimits: defaultAxisLimits(),
    },
  ];
}

/** Which mini-chart a layer's chart type belongs to. */
function bucketFor(kind) {
  return kind === 'smith' || kind === 'polar' || kind === 'tdr' ? kind : 'frequency';
}

/**
 * Group a panel's layers by rendering compatibility.
 *
 * Frequency-axis chart types share one overlaid mini-chart; Smith and
 * Polar each get their own (their geometries differ even though both
 * are unit-circle plots); at most one TDR layer is kept, since a time
 * domain view isn't something more than one of makes sense to overlay.
 */
export function groupLayersByBucket(layers) {
  const buckets = { frequency: [], smith: [], polar: [], tdr: [] };
  for (const layer of layers) {
    const definition = CHART_TYPES_BY_KEY.get(layer.chartKey);
    if (!definition) continue;
    buckets[bucketFor(definition.kind)].push(layer);
  }
  buckets.tdr = buckets.tdr.slice(0, 1);
  return buckets;
}

/**
 * Which axis a newly added layer should default to.
 *
 * Stays on the left axis unless the panel already carries a left-axis
 * layer with a visibly different unit, in which case the new layer
 * defaults to the right axis instead of being autoscaled alongside a
 * quantity it doesn't share a scale with.
 */
export function defaultAxisFor(panel, newChartKey) {
  const definition = CHART_TYPES_BY_KEY.get(newChartKey);
  const leftUnits = panel.layers
    .filter((l) => l.axis === 'left')
    .map((l) => CHART_TYPES_BY_KEY.get(l.chartKey))
    .filter(Boolean)
    .map((d) => d.unit ?? '');
  if (!leftUnits.length) return 'left';
  return leftUnits[0] === (definition?.unit ?? '') ? 'left' : 'right';
}

/**
 * Merge the series of a bucket's layers into one combined trace list for
 * a single mini-chart, tagging each with which axis it belongs on and a
 * palette slot to draw it in.
 *
 * Every trace gets its own `paletteIndex` (rather than one per layer) so
 * that, for instance, an R+jX layer's two lines are still distinguishable
 * from each other once a second layer joins the panel. A single-layer
 * panel gets no `paletteIndex` at all, leaving `FrequencyChart`/
 * `PolarChart` to fall back to their original per-series `colorKey`
 * colouring -- so nothing about an unmodified single-chart-type panel's
 * appearance changes.
 */
export function mergeSeriesForLayers(layers) {
  const combined = layers.length > 1;
  const merged = [];
  for (const layer of layers) {
    const definition = CHART_TYPES_BY_KEY.get(layer.chartKey);
    if (!definition) continue;
    for (const series of definition.series) {
      const entry = {
        ...series,
        axis: layer.axis === 'right' ? 'right' : 'left',
        label: combined ? `${definition.name}: ${series.label}` : series.label,
      };
      if (combined) entry.paletteIndex = merged.length;
      merged.push(entry);
    }
  }
  return merged;
}

/** Sum of each layer's reference lines, bucketed onto the axis it's drawn on. */
function referenceLinesForLayers(layers) {
  const referenceLines = { left: [], right: [] };
  for (const layer of layers) {
    const definition = CHART_TYPES_BY_KEY.get(layer.chartKey);
    if (definition?.referenceLines) referenceLines[layer.axis].push(...definition.referenceLines);
  }
  return referenceLines;
}

function combinedName(layers) {
  return layers.map((l) => CHART_TYPES_BY_KEY.get(l.chartKey)?.name ?? l.chartKey).join(' + ');
}

/**
 * Build the mini-chart for a panel's frequency-kind layers.
 *
 * A single layer produces a `FrequencyChart` that is, in every observable
 * way, what `createChart(layer.chartKey)` would have produced before
 * panels existed (see {@link mergeSeriesForLayers}'s backward-compatibility
 * guarantee). Two or more layers overlay their series on shared/dual axes,
 * taking the left axis's chart type for the left unit/formatter and the
 * (at most one) right-axis chart type for the right one.
 */
export function createCombinedFrequencyChart(layers, axisLimits) {
  const combined = layers.length > 1;
  const leftLayer = layers.find((l) => l.axis === 'left') ?? layers[0];
  const rightLayer = layers.find((l) => l.axis === 'right');
  const leftDef = CHART_TYPES_BY_KEY.get(leftLayer.chartKey);
  const rightDef = rightLayer ? CHART_TYPES_BY_KEY.get(rightLayer.chartKey) : null;

  const chart = new FrequencyChart({
    key: combined ? `combined:${layers.map((l) => l.chartKey).join('+')}` : leftDef.key,
    name: combined ? combinedName(layers) : leftDef.name,
    series: mergeSeriesForLayers(layers),
    unit: leftDef.unit,
    formatY: leftDef.formatY,
    unitRight: rightDef?.unit,
    formatYRight: rightDef?.formatY,
    logarithmicYAllowed: layers.every(
      (l) => CHART_TYPES_BY_KEY.get(l.chartKey)?.logarithmicYAllowed,
    ),
    referenceLines: combined ? referenceLinesForLayers(layers) : leftDef.referenceLines,
  });
  if (axisLimits) chart.setAxisLimits(axisLimits);
  return chart;
}

/**
 * Build the mini-chart for a panel's Smith or Polar layers (both use this
 * -- they're the same shape of chart, just a different `ChartClass`).
 */
export function createCombinedSmithLike(layers, ChartClass) {
  const combined = layers.length > 1;
  return new ChartClass({
    key: combined ? `combined:${layers.map((l) => l.chartKey).join('+')}` : layers[0].chartKey,
    name: combined ? combinedName(layers) : CHART_TYPES_BY_KEY.get(layers[0].chartKey)?.name ?? '',
    series: mergeSeriesForLayers(layers),
  });
}

/**
 * Build every mini-chart a panel needs, one per non-empty rendering
 * bucket (see {@link groupLayersByBucket}). The TDR mini-chart, when
 * present, is built with the unmodified `createChart('tdr')` so its
 * `chart.key === 'tdr'` keeps matching what `ChartGrid.updateTDR()`
 * already looks for.
 */
export function buildMiniCharts(panel) {
  const buckets = groupLayersByBucket(panel.layers);
  const minis = [];
  if (buckets.frequency.length) {
    minis.push({
      kind: 'frequency',
      chart: createCombinedFrequencyChart(buckets.frequency, panel.axisLimits),
    });
  }
  if (buckets.smith.length) {
    minis.push({ kind: 'smith', chart: createCombinedSmithLike(buckets.smith, SmithChart) });
  }
  if (buckets.polar.length) {
    minis.push({ kind: 'polar', chart: createCombinedSmithLike(buckets.polar, PolarChart) });
  }
  if (buckets.tdr.length) {
    minis.push({ kind: 'tdr', chart: createChart(buckets.tdr[0].chartKey) });
  }
  return minis;
}
