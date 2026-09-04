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

// Everything the desktop application plots against frequency, drawn by
// one chart that is told which value or values to take from each point.
//
// A panel combining more than one chart type merges all of their series
// into `this.series` (see registry.js `mergeSeriesForLayers`), each
// tagged with which of the two Y axes it belongs on. A chart built the
// old way -- one registry entry, via `createChart()` -- has every series
// implicitly on the left axis and never populates `right`, so it renders
// exactly as it always has.

import { Chart, colorForTrace, niceStep } from './base.js';
import { formatFrequencyChart } from '../util/format.js';

const Y_DIVISIONS = 8;
/** Height reserved above the plot for the combined-panel legend. */
const LEGEND_HEIGHT = 16;

/** Resolve one axis's range: the stored fixed bounds, or the auto-scanned ones. */
export function resolveAxisRange(axisLimits, autoRange) {
  if (axisLimits.mode === 'fixed') return [Number(axisLimits.min), Number(axisLimits.max)];
  return autoRange;
}

export class FrequencyChart extends Chart {
  /**
   * @param {{key, name, series, unit, formatY, unitRight, formatYRight,
   *          logarithmicYAllowed, referenceLines}} definition
   *   `referenceLines` may be a flat array (drawn on the left axis, the
   *   original single-axis shape) or `{left, right}`.
   */
  constructor(definition) {
    super(definition);
    this.series = definition.series;
    this.unit = definition.unit ?? '';
    this.formatY = definition.formatY ?? ((v) => shortNumber(v));
    this.unitRight = definition.unitRight ?? '';
    this.formatYRight = definition.formatYRight ?? null;
    this.logarithmicY = false;
    this.logarithmicX = false;
    this.axisLimits = {
      left: { mode: 'auto', min: 0, max: 1 },
      right: { mode: 'auto', min: 0, max: 1 },
    };
    const refLines = definition.referenceLines;
    this.referenceLines = Array.isArray(refLines)
      ? { left: refLines, right: [] }
      : { left: refLines?.left ?? [], right: refLines?.right ?? [] };
    this.hover = null;
    this._scale = null;
    this._legendHeight = 0;
  }

  get supportsZoom() {
    return true;
  }

  get logarithmicYAllowed() {
    return !!this.definition.logarithmicYAllowed;
  }

  /** Shrinks the plot area by the legend strip while one is showing. */
  get plot() {
    const base = super.plot;
    if (!this._legendHeight) return base;
    return {
      ...base,
      top: base.top + this._legendHeight,
      height: base.height - this._legendHeight,
    };
  }

  /** Merge new limits into whichever axes are given, leaving the other alone. */
  setAxisLimits(axisLimits) {
    this.axisLimits = {
      left: { ...this.axisLimits.left, ...(axisLimits.left ?? {}) },
      right: { ...this.axisLimits.right, ...(axisLimits.right ?? {}) },
    };
    this.requestDraw();
  }

  setLogarithmicY(enabled) {
    this.logarithmicY = enabled && this.logarithmicYAllowed;
    this.requestDraw();
  }

  setLogarithmicX(enabled) {
    this.logarithmicX = enabled;
    this.requestDraw();
  }

  formatYFor(axis) {
    return axis === 'right' && this.formatYRight ? this.formatYRight : this.formatY;
  }

  /** The traces this chart draws, resolved against the current data. */
  traces() {
    const out = [];
    for (const series of this.series) {
      const data = this.data[series.source] ?? [];
      if (data.length) {
        out.push({ ...series, data, isReference: false });
      }
      const reference = this.reference[series.source] ?? [];
      if (reference.length) {
        out.push({
          ...series,
          data: reference,
          isReference: true,
          colorKey: series.referenceColorKey ?? 'reference',
        });
      }
    }
    return out;
  }

  /** Frequency range covered by the live sweep, falling back to the reference. */
  frequencyRange() {
    let min = Infinity;
    let max = -Infinity;
    for (const source of ['s11', 's21']) {
      const data = this.data[source] ?? [];
      if (data.length) {
        min = Math.min(min, data[0].freq);
        max = Math.max(max, data[data.length - 1].freq);
      }
    }
    if (!Number.isFinite(min)) {
      for (const source of ['s11', 's21']) {
        const data = this.reference[source] ?? [];
        if (data.length) {
          min = Math.min(min, data[0].freq);
          max = Math.max(max, data[data.length - 1].freq);
        }
      }
    }
    if (!Number.isFinite(min)) return null;
    if (min === max) return [min - 1, max + 1];
    return [min, max];
  }

  /** The [min,max] a given axis should be drawn over. */
  valueRange(traces, fstart, fstop, axis = 'left') {
    const relevant = traces.filter((t) => (t.axis ?? 'left') === axis);
    let min = Infinity;
    let max = -Infinity;
    for (const trace of relevant) {
      const { data } = trace;
      for (let i = 0; i < data.length; i += 1) {
        if (data[i].freq < fstart || data[i].freq > fstop) continue;
        const value = trace.value(data[i], i, data);
        if (!Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    let autoRange;
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      autoRange = [0, 1];
    } else if (min === max) {
      const pad = Math.abs(min) * 0.1 || 1;
      autoRange = [min - pad, max + pad];
    } else {
      // round out to a whole number of divisions, as the desktop does
      const step = niceStep(max - min, Y_DIVISIONS);
      let low = Math.floor(min / step) * step;
      let high = Math.ceil(max / step) * step;
      if (this.logarithmicY) {
        low = Math.max(1e-12, min);
        high = max;
      }
      autoRange = [low, high];
    }
    return resolveAxisRange(this.axisLimits[axis], autoRange);
  }

  drawChart(ctx) {
    const range = this.frequencyRange();
    const traces = this.traces();
    const legendItems = this.#legendItems(traces);
    this._legendHeight = legendItems.length ? LEGEND_HEIGHT : 0;

    const { left, right, top, bottom, width, height } = this.plot;

    if (!range) {
      this.#drawEmptyFrame(ctx);
      return;
    }
    const [fstart, fstop] = range;
    const hasRight = traces.some((t) => t.axis === 'right');
    const [leftMin, leftMax] = this.valueRange(traces, fstart, fstop, 'left');
    const rightRange = hasRight ? this.valueRange(traces, fstart, fstop, 'right') : null;

    this._scale = {
      fstart,
      fstop,
      left: { minValue: leftMin, maxValue: leftMax },
      right: rightRange ? { minValue: rightRange[0], maxValue: rightRange[1] } : null,
    };

    this.#drawBands(ctx, fstart, fstop);
    this.#drawGrid(ctx, fstart, fstop);
    this.#drawReferenceLines(ctx);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    for (const trace of traces) this.#drawTrace(ctx, trace, fstart, fstop);
    ctx.restore();

    this.#drawAnnotations(ctx);
    this.#drawMarkers(ctx);
    this.#drawHover(ctx);

    if (legendItems.length) {
      const basePlot = super.plot;
      this.drawLegend(ctx, legendItems, basePlot.left, basePlot.top, basePlot.width);
    }

    ctx.strokeStyle = this.theme.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
  }

  /**
   * Labels for the legend, one per distinct live trace.
   *
   * Only shown once a panel actually combines more than one layer --
   * signalled by a trace carrying `paletteIndex` -- so an unmodified
   * single-chart-type panel (even a two-series one, like R+jX) keeps
   * showing exactly as it always has, with no legend.
   */
  #legendItems(traces) {
    if (!traces.some((t) => t.paletteIndex !== undefined)) return [];
    const seen = new Set();
    const items = [];
    for (const trace of traces) {
      if (trace.isReference || seen.has(trace.label)) continue;
      seen.add(trace.label);
      items.push({ label: trace.label, color: colorForTrace(this.theme, trace) });
    }
    return items;
  }

  #drawEmptyFrame(ctx) {
    const { left, top, right, bottom } = this.plot;
    ctx.strokeStyle = this.theme.axis;
    ctx.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
    ctx.fillStyle = this.theme.text;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data', (left + right) / 2, (top + bottom) / 2);
  }

  xPosition(freq) {
    const { left, width } = this.plot;
    const { fstart, fstop } = this._scale;
    if (this.logarithmicX && fstart > 0) {
      const span = Math.log10(fstop) - Math.log10(fstart);
      if (span <= 0) return left;
      return left + (width * (Math.log10(freq) - Math.log10(fstart))) / span;
    }
    const span = fstop - fstart;
    if (span <= 0) return left;
    return left + (width * (freq - fstart)) / span;
  }

  yPosition(value, axis = 'left') {
    const { top, height } = this.plot;
    const scale = this._scale?.[axis];
    if (!scale || !Number.isFinite(value)) return null;
    const { minValue, maxValue } = scale;
    if (this.logarithmicY) {
      const lo = Math.log10(Math.max(1e-12, minValue));
      const hi = Math.log10(Math.max(lo + 1e-9, maxValue));
      const v = Math.log10(Math.max(1e-12, value));
      return top + height - (height * (v - lo)) / (hi - lo);
    }
    const span = maxValue - minValue;
    if (span === 0) return top + height / 2;
    return top + height - (height * (value - minValue)) / span;
  }

  frequencyAt(x) {
    if (!this._scale) return null;
    const { left, width } = this.plot;
    const { fstart, fstop } = this._scale;
    const t = Math.max(0, Math.min(1, (x - left) / width));
    if (this.logarithmicX && fstart > 0) {
      const lo = Math.log10(fstart);
      const hi = Math.log10(fstop);
      return 10 ** (lo + t * (hi - lo));
    }
    return fstart + t * (fstop - fstart);
  }

  #drawBands(ctx, fstart, fstop) {
    if (!this.bandsEnabled) return;
    const { top, height } = this.plot;
    ctx.save();
    ctx.fillStyle = this.theme.bands;
    for (const band of this.bands) {
      if (band.end < fstart || band.start > fstop) continue;
      const x0 = this.xPosition(Math.max(band.start, fstart));
      const x1 = this.xPosition(Math.min(band.end, fstop));
      ctx.fillRect(x0, top, Math.max(1, x1 - x0), height);
    }
    ctx.restore();
  }

  #drawGrid(ctx, fstart, fstop) {
    const { left, right, top, bottom, width } = this.plot;
    ctx.save();
    ctx.strokeStyle = this.theme.foreground;
    ctx.fillStyle = this.theme.text;
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    // the left axis draws both gridlines and labels, as it always has
    this.#drawYTicks(ctx, 'left', true);
    // a right axis, when present, only adds tick labels -- a second set
    // of gridlines at a different spacing would just be visual noise
    if (this._scale.right) this.#drawYTicks(ctx, 'right', false);

    // vertical lines and the frequency labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ticks = this.#frequencyTicks(fstart, fstop, Math.max(2, Math.round(width / 90)));
    for (const freq of ticks) {
      const x = this.xPosition(freq);
      if (x < left - 1 || x > right + 1) continue;
      line(ctx, x, top, x, bottom);
      ctx.fillText(formatFrequencyChart(freq), x, bottom + 5);
    }
    ctx.restore();
  }

  #drawYTicks(ctx, axis, drawGridlines) {
    const { left, right, top, bottom } = this.plot;
    const { minValue, maxValue } = this._scale[axis];
    const format = this.formatYFor(axis);
    const labelX = axis === 'right' ? right + 5 : left - 5;
    ctx.textAlign = axis === 'right' ? 'left' : 'right';

    if (this.logarithmicY) {
      const lo = Math.floor(Math.log10(Math.max(1e-12, minValue)));
      const hi = Math.ceil(Math.log10(Math.max(1e-12, maxValue)));
      for (let e = lo; e <= hi; e += 1) {
        const value = 10 ** e;
        const y = this.yPosition(value, axis);
        if (y === null || y < top - 1 || y > bottom + 1) continue;
        if (drawGridlines) line(ctx, left, y, right, y);
        ctx.fillText(format(value), labelX, y);
      }
      return;
    }
    const step = niceStep(maxValue - minValue, Y_DIVISIONS);
    const first = Math.ceil(minValue / step) * step;
    // a handful more than Y_DIVISIONS is always enough for a healthy
    // axis; the cap only matters when `step` is too small relative to
    // `value`'s magnitude to change it (min and max agreeing to within
    // float noise, or a pathologically narrow fixed range), which would
    // otherwise spin forever since `value += step` never advances
    const maxTicks = Y_DIVISIONS + 4;
    let value = first;
    for (let n = 0; n < maxTicks && value <= maxValue + step * 1e-9; n += 1, value += step) {
      const y = this.yPosition(value, axis);
      if (y === null || y < top - 1 || y > bottom + 1) continue;
      if (drawGridlines) line(ctx, left, y, right, y);
      // the step can be fractional, so round away accumulated error
      ctx.fillText(format(roundTo(value, step)), labelX, y);
    }
  }

  #frequencyTicks(fstart, fstop, count) {
    if (this.logarithmicX && fstart > 0) {
      const ticks = [];
      const lo = Math.floor(Math.log10(fstart));
      const hi = Math.ceil(Math.log10(fstop));
      for (let e = lo; e <= hi; e += 1) {
        for (const m of [1, 2, 5]) {
          const value = m * 10 ** e;
          if (value >= fstart && value <= fstop) ticks.push(value);
        }
      }
      return ticks;
    }
    const step = niceStep(fstop - fstart, count);
    const ticks = [];
    const first = Math.ceil(fstart / step) * step;
    // see the matching guard in #drawYTicks: bounds the loop even if
    // `step` turns out too small, relative to `fstart`'s magnitude, to
    // ever advance `value`
    const maxTicks = count + 4;
    let value = first;
    for (let n = 0; n < maxTicks && value <= fstop + step * 1e-9; n += 1, value += step) {
      ticks.push(Math.round(value));
    }
    return ticks;
  }

  #drawReferenceLines(ctx) {
    this.#drawReferenceLinesForAxis(ctx, this.referenceLines.left, 'left');
    if (this._scale.right) this.#drawReferenceLinesForAxis(ctx, this.referenceLines.right, 'right');
  }

  #drawReferenceLinesForAxis(ctx, values, axis) {
    if (!values.length) return;
    const { left, right } = this.plot;
    const { minValue, maxValue } = this._scale[axis];
    const format = this.formatYFor(axis);
    ctx.save();
    ctx.strokeStyle = this.theme.swr;
    ctx.fillStyle = this.theme.swr;
    ctx.setLineDash([4, 3]);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = axis === 'right' ? 'right' : 'left';
    ctx.textBaseline = 'bottom';
    const labelX = axis === 'right' ? right - 4 : left + 4;
    for (const value of values) {
      if (value < minValue || value > maxValue) continue;
      const y = this.yPosition(value, axis);
      if (y === null) continue;
      line(ctx, left, y, right, y);
      ctx.fillText(format(value), labelX, y - 1);
    }
    ctx.restore();
  }

  #drawTrace(ctx, trace, fstart, fstop) {
    const { data } = trace;
    const axis = trace.axis ?? 'left';
    ctx.save();
    ctx.strokeStyle = colorForTrace(this.theme, trace);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = this.lineWidth;
    if (trace.isReference && trace.paletteIndex !== undefined) ctx.globalAlpha = 0.55;

    let started = false;
    ctx.beginPath();
    for (let i = 0; i < data.length; i += 1) {
      const dp = data[i];
      if (dp.freq < fstart || dp.freq > fstop) {
        started = false;
        continue;
      }
      const value = trace.value(dp, i, data);
      const y = this.yPosition(value, axis);
      if (y === null || !Number.isFinite(y)) {
        started = false;
        continue;
      }
      const x = this.xPosition(dp.freq);
      if (this.drawLines) {
        if (started) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          started = true;
        }
      } else {
        ctx.moveTo(x + this.pointSize, y);
        ctx.arc(x, y, this.pointSize, 0, Math.PI * 2);
      }
    }
    if (this.drawLines) ctx.stroke();
    else ctx.fill();
    ctx.restore();
  }

  markerPosition(marker) {
    if (!this._scale) return null;
    const primary = this.series.find((s) => (s.axis ?? 'left') === 'left') ?? this.series[0];
    if (!primary) return null;
    const data = this.data[primary.source] ?? [];
    if (!data.length || marker.location < 0 || marker.location >= data.length) return null;
    const dp = data[marker.location];
    const value = primary.value(dp, marker.location, data);
    const y = this.yPosition(value, primary.axis ?? 'left');
    if (y === null || !Number.isFinite(y)) return null;
    return { x: this.xPosition(dp.freq), y };
  }

  #drawMarkers(ctx) {
    const { top, bottom } = this.plot;
    this.markers.forEach((marker, index) => {
      if (!marker.enabled || marker.location < 0) return;
      const point = this.markerPosition(marker);
      if (!point) return;
      const color = marker.color ?? this.theme.markerColors[index % 4];
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.45;
      line(ctx, point.x, top, point.x, bottom);
      ctx.restore();
      this.drawMarkerGlyph(ctx, point.x, point.y, color, `${index + 1}`);
    });
  }

  #drawAnnotations(ctx) {
    if (!this.annotations.length) return;
    const { top, bottom } = this.plot;
    ctx.save();
    ctx.strokeStyle = this.theme.swr;
    ctx.fillStyle = this.theme.swr;
    ctx.setLineDash([2, 3]);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const annotation of this.annotations) {
      const x = this.xPosition(annotation.freq);
      if (x < this.plot.left || x > this.plot.right) continue;
      line(ctx, x, top, x, bottom);
      ctx.fillText(annotation.label, x, top + 2);
    }
    ctx.restore();
  }

  updateHover(pos) {
    const previous = this.hover;
    this.hover = pos && this._scale ? pos : null;
    if (previous !== this.hover) this.requestDraw();
  }

  #drawHover(ctx) {
    if (!this.hover) return;
    const { left, right, top, bottom } = this.plot;
    const { x } = this.hover;
    if (x < left || x > right) return;
    const freq = this.frequencyAt(x);
    ctx.save();
    ctx.strokeStyle = this.theme.axis;
    ctx.globalAlpha = 0.4;
    line(ctx, x, top, x, bottom);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.theme.text;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = x > right - 60 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(formatFrequencyChart(freq), x + (x > right - 60 ? -4 : 4), top + 2);
    ctx.restore();
  }
}

function line(ctx, x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Round a grid value to the precision its step implies. */
function roundTo(value, step) {
  const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number(value.toFixed(Math.min(12, digits)));
}

export function shortNumber(value) {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return value.toExponential(1);
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(4)));
}
