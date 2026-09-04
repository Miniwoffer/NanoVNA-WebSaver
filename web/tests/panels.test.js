/*
 *  NanoVNA-WebSaver -- tests for the panel/layer data model: layout
 *  migration, span clamping, layer bucketing and series merging.
 *
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *  Licensed under the GNU General Public License v3 or later.
 *
 *  Not covered here (needs a real DOM/canvas, verified manually instead):
 *  actual mini-chart rendering, dual-axis gridline drawing, legend
 *  layout, and pointer-driven drag-reorder/drag-resize sequences.
 */

import { assert, describe, it } from './harness.js';
import {
  MAX_ROW_SPAN,
  buildMiniCharts,
  clampLayoutToColumns,
  clampSpan,
  createCombinedFrequencyChart,
  createCombinedSmithLike,
  defaultAxisFor,
  defaultAxisLimits,
  defaultLayout,
  groupLayersByBucket,
  makePanelId,
  mergeSeriesForLayers,
  normalizeLayout,
} from '../js/charts/registry.js';
import { FrequencyChart } from '../js/charts/frequency.js';
import { PolarChart, SmithChart } from '../js/charts/smith.js';
import { TDRChart } from '../js/charts/tdrchart.js';

describe('clampSpan', () => {
  it('clamps below 1 up to 1', () => {
    assert.equal(clampSpan(0, 4), 1);
    assert.equal(clampSpan(-3, 4), 1);
  });

  it('clamps above max down to max', () => {
    assert.equal(clampSpan(9, 4), 4);
  });

  it('rounds fractional input', () => {
    assert.equal(clampSpan(2.6, 4), 3);
  });

  it('treats non-numeric input as 1', () => {
    assert.equal(clampSpan('abc', 4), 1);
    assert.equal(clampSpan(NaN, 4), 1);
    assert.equal(clampSpan(undefined, 4), 1);
  });

  it('caps row spans at MAX_ROW_SPAN when asked to', () => {
    assert.equal(clampSpan(10, MAX_ROW_SPAN), MAX_ROW_SPAN);
  });
});

describe('normalizeLayout', () => {
  it('converts the old flat chart-key format to panels', () => {
    const layout = normalizeLayout(['s11_log_mag', 's11_smith']);
    assert.equal(layout.length, 2);
    for (const panel of layout) {
      assert.equal(panel.colSpan, 1);
      assert.equal(panel.rowSpan, 1);
      assert.equal(panel.layers.length, 1);
      assert.equal(panel.layers[0].axis, 'left');
      assert.deepEqual(panel.axisLimits, defaultAxisLimits());
    }
    assert.equal(layout[0].layers[0].chartKey, 's11_log_mag');
    assert.equal(layout[1].layers[0].chartKey, 's11_smith');
    assert.ok(layout[0].id !== layout[1].id, 'each panel gets a unique id');
  });

  it('passes an already-new-format layout through, preserving values', () => {
    const input = [
      {
        id: 'panel-42',
        colSpan: 2,
        rowSpan: 2,
        layers: [
          { chartKey: 's11_log_mag', axis: 'left' },
          { chartKey: 's11_vswr', axis: 'right' },
        ],
        axisLimits: {
          left: { mode: 'fixed', min: -60, max: 0 },
          right: { mode: 'auto', min: 0, max: 1 },
        },
      },
    ];
    const [panel] = normalizeLayout(input);
    assert.equal(panel.id, 'panel-42');
    assert.equal(panel.colSpan, 2);
    assert.equal(panel.rowSpan, 2);
    assert.deepEqual(panel.layers, input[0].layers);
    assert.deepEqual(panel.axisLimits, input[0].axisLimits);
  });

  it('drops unknown chart keys without throwing', () => {
    const layout = normalizeLayout(['s11_log_mag', 'nonsense_key']);
    assert.equal(layout.length, 1);
    assert.equal(layout[0].layers[0].chartKey, 's11_log_mag');
  });

  it('drops panels whose layers are entirely unknown', () => {
    const layout = normalizeLayout([
      { layers: [{ chartKey: 'nonsense' }] },
      { layers: [{ chartKey: 's11_smith' }] },
    ]);
    assert.equal(layout.length, 1);
    assert.equal(layout[0].layers[0].chartKey, 's11_smith');
  });

  it('falls back to the default layout for garbage input', () => {
    for (const garbage of [null, undefined, [], [{}], 'nonsense', 42]) {
      const layout = normalizeLayout(garbage);
      assert.equal(layout.length, defaultLayout().length, `garbage: ${JSON.stringify(garbage)}`);
    }
  });

  it('never throws on thoroughly malformed input', () => {
    const layout = normalizeLayout([1, true, {}, { layers: 'nope' }, { layers: [null, 5] }]);
    assert.ok(layout.length > 0, 'falls back rather than producing nothing');
  });
});

describe('clampLayoutToColumns', () => {
  it('re-clamps colSpan when the column count shrinks', () => {
    const layout = [
      { id: 'a', colSpan: 4, rowSpan: 1, layers: [{ chartKey: 's11_smith', axis: 'left' }], axisLimits: defaultAxisLimits() },
      { id: 'b', colSpan: 2, rowSpan: 1, layers: [{ chartKey: 's11_smith', axis: 'left' }], axisLimits: defaultAxisLimits() },
    ];
    const result = clampLayoutToColumns(layout, 2);
    assert.equal(result[0].colSpan, 2);
    assert.equal(result[1].colSpan, 2);
  });

  it('leaves spans alone when they already fit', () => {
    const layout = [
      { id: 'a', colSpan: 1, rowSpan: 1, layers: [{ chartKey: 's11_smith', axis: 'left' }], axisLimits: defaultAxisLimits() },
    ];
    assert.equal(clampLayoutToColumns(layout, 3)[0].colSpan, 1);
  });
});

describe('groupLayersByBucket', () => {
  it('buckets layers by rendering compatibility', () => {
    const layers = [
      { chartKey: 's11_smith', axis: 'left' },
      { chartKey: 's11_phase', axis: 'left' },
      { chartKey: 's11_vswr', axis: 'right' },
      { chartKey: 's21_polar', axis: 'left' },
      { chartKey: 'tdr', axis: 'left' },
    ];
    const buckets = groupLayersByBucket(layers);
    assert.equal(buckets.smith.length, 1);
    assert.equal(buckets.polar.length, 1);
    assert.equal(buckets.frequency.length, 2);
    assert.equal(buckets.tdr.length, 1);
    assert.equal(buckets.smith[0].chartKey, 's11_smith');
    assert.equal(buckets.polar[0].chartKey, 's21_polar');
  });

  it('caps the tdr bucket at one layer, keeping the first', () => {
    const layers = [
      { chartKey: 'tdr', axis: 'left' },
      { chartKey: 'tdr', axis: 'left' },
    ];
    const buckets = groupLayersByBucket(layers);
    assert.equal(buckets.tdr.length, 1);
  });

  it('ignores layers with an unknown chart key', () => {
    const buckets = groupLayersByBucket([{ chartKey: 'nonsense', axis: 'left' }]);
    assert.equal(buckets.frequency.length, 0);
    assert.equal(buckets.smith.length, 0);
    assert.equal(buckets.polar.length, 0);
    assert.equal(buckets.tdr.length, 0);
  });
});

describe('defaultAxisFor', () => {
  it('defaults to the left axis for an empty panel', () => {
    const panel = { layers: [] };
    assert.equal(defaultAxisFor(panel, 's11_vswr'), 'left');
  });

  it('stays on the left axis when units match', () => {
    // s11_magnitude_z and s11_q_factor both carry the Ohm unit... use two
    // chart types that share a unit: s11_magnitude_z (Ohm) and itself
    const panel = { layers: [{ chartKey: 's11_magnitude_z', axis: 'left' }] };
    assert.equal(defaultAxisFor(panel, 's11_magnitude_z'), 'left');
  });

  it('defaults to the right axis when the new layer has a different unit', () => {
    // s11_magnitude_z has unit Ohm; s11_vswr has no unit
    const panel = { layers: [{ chartKey: 's11_magnitude_z', axis: 'left' }] };
    assert.equal(defaultAxisFor(panel, 's11_vswr'), 'right');
  });

  it('only looks at left-axis layers when deciding', () => {
    // a right-axis-only panel should still default a same-unit-as-left-would-be layer to left
    const panel = { layers: [{ chartKey: 's11_magnitude_z', axis: 'right' }] };
    assert.equal(defaultAxisFor(panel, 's11_vswr'), 'left');
  });
});

describe('mergeSeriesForLayers', () => {
  it('leaves a single layer unprefixed and without a palette index', () => {
    const merged = mergeSeriesForLayers([{ chartKey: 's11_vswr', axis: 'left' }]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].label, 'VSWR');
    assert.equal(merged[0].axis, 'left');
    assert.equal(merged[0].paletteIndex, undefined);
  });

  it('prefixes labels and assigns an incrementing palette index for 2+ layers', () => {
    const merged = mergeSeriesForLayers([
      { chartKey: 's11_real_imag', axis: 'left' }, // two series: R, X
      { chartKey: 's11_vswr', axis: 'right' },
    ]);
    assert.equal(merged.length, 3);
    assert.equal(merged[0].label, 'S11 R+jX: R');
    assert.equal(merged[1].label, 'S11 R+jX: X');
    assert.equal(merged[2].label, 'S11 VSWR: VSWR');
    assert.deepEqual(merged.map((m) => m.paletteIndex), [0, 1, 2]);
    assert.deepEqual(merged.map((m) => m.axis), ['left', 'left', 'right']);
  });

  it('carries the axis from each layer onto every one of its series', () => {
    const merged = mergeSeriesForLayers([
      { chartKey: 's11_s_parameter', axis: 'right' }, // two series: Real, Imaginary
    ]);
    // still a single layer -> unprefixed, but axis must still propagate
    assert.deepEqual(merged.map((m) => m.axis), ['right', 'right']);
  });

  it('skips a layer whose chart key is unknown', () => {
    const merged = mergeSeriesForLayers([
      { chartKey: 'nonsense', axis: 'left' },
      { chartKey: 's11_vswr', axis: 'left' },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].label, 'S11 VSWR: VSWR');
  });
});

describe('defaultLayout', () => {
  it('produces valid, self-consistent panels', () => {
    const layout = defaultLayout();
    assert.ok(layout.length > 0);
    for (const panel of layout) {
      assert.ok(panel.id);
      assert.ok(panel.layers.length > 0);
      assert.deepEqual(panel.axisLimits, defaultAxisLimits());
    }
  });

  it('showcases a spanning, combined panel first', () => {
    const [first] = defaultLayout();
    assert.equal(first.colSpan, 2);
    assert.equal(first.layers.length, 2);
    assert.equal(first.layers[0].axis, 'left');
    assert.equal(first.layers[1].axis, 'right');
  });

  it('produces fresh ids on every call', () => {
    const a = defaultLayout();
    const b = defaultLayout();
    assert.ok(a[0].id !== b[0].id);
  });
});

describe('makePanelId', () => {
  it('never repeats', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i += 1) ids.add(makePanelId());
    assert.equal(ids.size, 50);
  });
});

describe('createCombinedFrequencyChart', () => {
  it('single layer: matches what createChart(key) would have produced', () => {
    const chart = createCombinedFrequencyChart([{ chartKey: 's11_vswr', axis: 'left' }]);
    assert.ok(chart instanceof FrequencyChart);
    assert.equal(chart.key, 's11_vswr');
    assert.equal(chart.name, 'S11 VSWR');
    assert.deepEqual(chart.referenceLines, { left: [1.5, 2.0, 3.0], right: [] });
    assert.equal(chart.series[0].paletteIndex, undefined);
  });

  it('two layers: merges units/formatters per axis and reference lines per axis', () => {
    const chart = createCombinedFrequencyChart([
      { chartKey: 's11_log_mag', axis: 'left' },
      { chartKey: 's11_vswr', axis: 'right' },
    ]);
    assert.equal(chart.unit, 'dB');
    assert.equal(chart.unitRight, '');
    assert.deepEqual(chart.referenceLines, { left: [], right: [1.5, 2.0, 3.0] });
    assert.equal(chart.series.length, 2);
    assert.equal(chart.series[0].paletteIndex, 0);
    assert.equal(chart.series[1].paletteIndex, 1);
  });

  it('applies the given axisLimits up front', () => {
    const chart = createCombinedFrequencyChart(
      [{ chartKey: 's11_vswr', axis: 'left' }],
      { left: { mode: 'fixed', min: 1, max: 3 } },
    );
    assert.deepEqual(chart.axisLimits.left, { mode: 'fixed', min: 1, max: 3 });
  });
});

describe('createCombinedSmithLike', () => {
  it('single layer takes the chart type key/name unchanged', () => {
    const chart = createCombinedSmithLike([{ chartKey: 's11_smith', axis: 'left' }], SmithChart);
    assert.ok(chart instanceof SmithChart);
    assert.equal(chart.key, 's11_smith');
    assert.equal(chart.name, 'S11 Smith Chart');
    assert.equal(chart.series[0].paletteIndex, undefined);
  });

  it('multiple layers get a combined name and palette indices', () => {
    const chart = createCombinedSmithLike(
      [
        { chartKey: 's11_smith', axis: 'left' },
        { chartKey: 's11_smith', axis: 'left' },
      ],
      SmithChart,
    );
    assert.equal(chart.name, 'S11 Smith Chart + S11 Smith Chart');
    assert.deepEqual(chart.series.map((s) => s.paletteIndex), [0, 1]);
  });
});

describe('buildMiniCharts', () => {
  it('builds one mini-chart per non-empty bucket', () => {
    const panel = {
      layers: [
        { chartKey: 's11_log_mag', axis: 'left' },
        { chartKey: 's11_smith', axis: 'left' },
        { chartKey: 's21_polar', axis: 'left' },
        { chartKey: 'tdr', axis: 'left' },
      ],
      axisLimits: defaultAxisLimits(),
    };
    const minis = buildMiniCharts(panel);
    const kinds = minis.map((m) => m.kind);
    assert.deepEqual(kinds.sort(), ['frequency', 'polar', 'smith', 'tdr']);
    assert.ok(minis.find((m) => m.kind === 'frequency').chart instanceof FrequencyChart);
    assert.ok(minis.find((m) => m.kind === 'smith').chart instanceof SmithChart);
    assert.ok(minis.find((m) => m.kind === 'polar').chart instanceof PolarChart);
    const tdr = minis.find((m) => m.kind === 'tdr').chart;
    assert.ok(tdr instanceof TDRChart);
    assert.equal(tdr.key, 'tdr', 'ChartGrid.updateTDR() keys off this');
  });

  it('produces no mini-chart for an empty bucket', () => {
    const panel = { layers: [{ chartKey: 's11_smith', axis: 'left' }], axisLimits: defaultAxisLimits() };
    const minis = buildMiniCharts(panel);
    assert.equal(minis.length, 1);
    assert.equal(minis[0].kind, 'smith');
  });
});
