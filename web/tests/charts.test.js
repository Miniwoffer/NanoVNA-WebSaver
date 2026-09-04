/*
 *  NanoVNA-WebSaver -- tests for the chart classes' dual-axis, palette
 *  and legend behaviour, run against a fake canvas so the real drawing
 *  code executes deterministically under plain Node.
 *
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *  Licensed under the GNU General Public License v3 or later.
 *
 *  Not covered here (needs a real browser, verified manually instead):
 *  actual pixel output, font metrics, and pointer-driven interaction.
 */

import { assert, describe, it } from './harness.js';
import { createFakeCanvas, installWindowShim } from './fakecanvas.js';
import {
  DARK_LAYER_PALETTE,
  DARK_THEME,
  DEFAULT_THEME,
  LAYER_PALETTE,
  colorForTrace,
} from '../js/charts/base.js';
import { FrequencyChart, resolveAxisRange } from '../js/charts/frequency.js';
import { PolarChart, SmithChart } from '../js/charts/smith.js';
import { mergeSeriesForLayers } from '../js/charts/registry.js';
import { Datapoint } from '../js/rf/rftools.js';

installWindowShim();

function sampleS11(count = 51) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const f = 1e6 + i * 1e6;
    out.push(new Datapoint(f, 0.3 * Math.cos(i / 10), 0.3 * Math.sin(i / 10)));
  }
  return out;
}

function attached(chart, width = 500, height = 350) {
  chart.attach(createFakeCanvas(width, height));
  return chart;
}

describe('resolveAxisRange', () => {
  it('passes the computed range through in auto mode', () => {
    assert.deepEqual(resolveAxisRange({ mode: 'auto', min: 0, max: 1 }, [3, 9]), [3, 9]);
  });

  it('returns the stored bounds in fixed mode, ignoring the computed range', () => {
    assert.deepEqual(resolveAxisRange({ mode: 'fixed', min: -60, max: 0 }, [3, 9]), [-60, 0]);
  });

  it('coerces fixed bounds to numbers', () => {
    assert.deepEqual(resolveAxisRange({ mode: 'fixed', min: '1.5', max: '3' }, [0, 1]), [1.5, 3]);
  });
});

describe('colorForTrace', () => {
  it('keeps the legacy sweep/reference colours for a single-layer trace', () => {
    assert.equal(colorForTrace(DEFAULT_THEME, { colorKey: undefined, isReference: false }), DEFAULT_THEME.sweep);
    assert.equal(
      colorForTrace(DEFAULT_THEME, { colorKey: 'sweepSecondary', isReference: false }),
      DEFAULT_THEME.sweepSecondary,
    );
    assert.equal(
      colorForTrace(DEFAULT_THEME, { colorKey: undefined, isReference: true }),
      DEFAULT_THEME.reference,
    );
    assert.equal(
      colorForTrace(DEFAULT_THEME, { colorKey: 'referenceSecondary', isReference: true }),
      DEFAULT_THEME.referenceSecondary,
    );
  });

  it('uses the layer palette once a trace carries a paletteIndex', () => {
    assert.equal(colorForTrace(DEFAULT_THEME, { paletteIndex: 0 }), LAYER_PALETTE[0]);
    assert.equal(colorForTrace(DEFAULT_THEME, { paletteIndex: 2 }), LAYER_PALETTE[2]);
    assert.equal(colorForTrace(DARK_THEME, { paletteIndex: 0 }), DARK_LAYER_PALETTE[0]);
  });

  it('wraps the palette for more traces than it has colours', () => {
    const n = LAYER_PALETTE.length;
    assert.equal(colorForTrace(DEFAULT_THEME, { paletteIndex: n }), LAYER_PALETTE[0]);
    assert.equal(colorForTrace(DEFAULT_THEME, { paletteIndex: n + 1 }), LAYER_PALETTE[1]);
  });

  it('paletteIndex takes priority over isReference/colorKey', () => {
    assert.equal(
      colorForTrace(DEFAULT_THEME, { paletteIndex: 1, isReference: true, colorKey: 'sweepSecondary' }),
      LAYER_PALETTE[1],
    );
  });
});

describe('FrequencyChart, single layer (backward compatibility)', () => {
  it('never populates a right axis and shows no legend', () => {
    const chart = attached(
      new FrequencyChart({
        key: 's11_vswr',
        name: 'S11 VSWR',
        series: [{ source: 's11', label: 'VSWR', value: (dp) => dp.vswr }],
        referenceLines: [1.5, 2.0, 3.0],
      }),
    );
    chart.setData({ s11: sampleS11(), s21: [] }, { s11: [], s21: [] });
    chart.draw();

    assert.equal(chart._legendHeight, 0);
    assert.equal(chart._scale.right, null);
    assert.deepEqual(chart.referenceLines, { left: [1.5, 2.0, 3.0], right: [] });
  });

  it('normalises an already-split referenceLines object unchanged', () => {
    const chart = new FrequencyChart({
      key: 'x', name: '', series: [],
      referenceLines: { left: [1], right: [2] },
    });
    assert.deepEqual(chart.referenceLines, { left: [1], right: [2] });
  });

  it('defaults to no reference lines at all when none are given', () => {
    const chart = new FrequencyChart({ key: 'x', name: '', series: [] });
    assert.deepEqual(chart.referenceLines, { left: [], right: [] });
  });
});

describe('FrequencyChart, combined layers', () => {
  const layers = [
    { chartKey: 's11_log_mag', axis: 'left' },
    { chartKey: 's11_vswr', axis: 'right' },
  ];

  it('computes two independent axis scales', () => {
    const merged = mergeSeriesForLayers(layers);
    const chart = attached(
      new FrequencyChart({
        key: 'combo', name: '', series: merged,
        referenceLines: { left: [], right: [1.5, 2.0, 3.0] },
      }),
    );
    chart.setData({ s11: sampleS11(), s21: [] }, { s11: [], s21: [] });
    chart.draw();

    assert.ok(chart._legendHeight > 0, 'shows a legend once combined');
    assert.ok(chart._scale.right !== null, 'a right axis is present');
    for (const side of ['left', 'right']) {
      const { minValue, maxValue } = chart._scale[side];
      assert.ok(Number.isFinite(minValue) && Number.isFinite(maxValue), `${side} axis is finite`);
      assert.ok(minValue < maxValue, `${side} axis has a real span`);
    }
    // the two axes measure very different quantities (dB vs. a VSWR
    // ratio starting near 1), so they must not collapse to one scale
    assert.ok(
      chart._scale.left.minValue !== chart._scale.right.minValue ||
        chart._scale.left.maxValue !== chart._scale.right.maxValue,
      'left and right axes are independent',
    );
  });

  it('locks an axis to a fixed range and ignores new data outside it', () => {
    const merged = mergeSeriesForLayers(layers);
    const chart = attached(
      new FrequencyChart({ key: 'combo', name: '', series: merged }),
    );
    chart.setData({ s11: sampleS11(), s21: [] }, { s11: [], s21: [] });
    chart.setAxisLimits({ right: { mode: 'fixed', min: 1, max: 3 } });
    chart.draw();

    assert.deepEqual(chart._scale.right, { minValue: 1, maxValue: 3 });
    // the left axis, still on auto, is untouched by the right axis toggle
    assert.equal(chart.axisLimits.left.mode, 'auto');
  });

  it('keeps left-axis limits when only the right axis is updated', () => {
    const chart = new FrequencyChart({ key: 'x', name: '', series: [] });
    chart.setAxisLimits({ left: { mode: 'fixed', min: -60, max: 0 } });
    chart.setAxisLimits({ right: { mode: 'fixed', min: 1, max: 3 } });
    assert.deepEqual(chart.axisLimits.left, { mode: 'fixed', min: -60, max: 0 });
    assert.deepEqual(chart.axisLimits.right, { mode: 'fixed', min: 1, max: 3 });
  });

  it('switching an axis back to auto resumes autoscaling', () => {
    const merged = mergeSeriesForLayers(layers);
    const chart = attached(new FrequencyChart({ key: 'combo', name: '', series: merged }));
    chart.setData({ s11: sampleS11(), s21: [] }, { s11: [], s21: [] });
    chart.setAxisLimits({ right: { mode: 'fixed', min: 1, max: 3 } });
    chart.draw();
    const fixed = chart._scale.right;
    chart.setAxisLimits({ right: { mode: 'auto' } });
    chart.draw();
    assert.ok(
      chart._scale.right.minValue !== fixed.minValue || chart._scale.right.maxValue !== fixed.maxValue,
      'auto mode recomputes the range rather than keeping the old fixed one',
    );
  });

  it('assigns every merged series its own palette colour', () => {
    const merged = mergeSeriesForLayers(layers); // 1 + 1 = 2 series total
    const chart = new FrequencyChart({ key: 'combo', name: '', series: merged });
    const colors = chart.series.map((s) => colorForTrace(DEFAULT_THEME, s));
    assert.equal(new Set(colors).size, colors.length, 'no two series share a colour');
  });

  it('places a marker using the first left-axis series, not just series[0]', () => {
    // a layer order where the right-axis layer comes first in the array
    const merged = mergeSeriesForLayers([
      { chartKey: 's11_vswr', axis: 'right' },
      { chartKey: 's11_log_mag', axis: 'left' },
    ]);
    const chart = attached(new FrequencyChart({ key: 'combo', name: '', series: merged }));
    const s11 = sampleS11();
    chart.setData({ s11, s21: [] }, { s11: [], s21: [] });
    chart.draw();
    chart.markers = [{ enabled: true, location: 5, color: '#000' }];
    const point = chart.markerPosition(chart.markers[0]);
    assert.ok(point, 'a marker position was found');
    // the left-axis series is s11_log_mag (return loss); verify the y
    // position matches that series' value, not the right-axis VSWR one
    const expectedY = chart.yPosition(s11[5].gain, 'left');
    assert.close(point.y, expectedY, 1e-9);
  });
});

describe('PolarChart / SmithChart legend and colouring', () => {
  it('shows no legend for a single-layer chart', () => {
    const chart = attached(new PolarChart({ key: 's21_polar', name: 'S21 Polar', series: [
      { source: 's21', label: 'S21' },
    ] }));
    chart.setData({ s11: [], s21: sampleS11() }, { s11: [], s21: [] });
    chart.draw();
    assert.equal(chart._legendHeight, 0);
  });

  it('shows a legend and palette colours once combined', () => {
    const chart = attached(
      new SmithChart({
        key: 'combo-smith',
        name: '',
        series: [
          { source: 's11', label: 'S11 Smith Chart: S11', paletteIndex: 0 },
          { source: 's21', label: 'S21 Polar Plot: S21', paletteIndex: 1 },
        ],
      }),
    );
    chart.setData({ s11: sampleS11(), s21: sampleS11() }, { s11: [], s21: [] });
    chart.draw();
    assert.ok(chart._legendHeight > 0);

    const colors = chart.series.map((s) => colorForTrace(chart.theme, s));
    assert.deepEqual(colors, [LAYER_PALETTE[0], LAYER_PALETTE[1]]);
  });

  it('draws without throwing when there is no data yet', () => {
    const chart = attached(new SmithChart({ key: 's11_smith', name: 'S11 Smith Chart', series: [
      { source: 's11', label: 'S11' },
    ] }));
    chart.draw();
    assert.equal(chart._legendHeight, 0);
  });
});
