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

import { Chart, niceStep } from './base.js';
import { formatFrequencyChart } from '../util/format.js';

const Y_DIVISIONS = 8;

export class FrequencyChart extends Chart {
  /**
   * @param {{key, name, series, unit, formatY, logarithmicYAllowed,
   *          fixedSpan, minimum, maximum, referenceLines}} definition
   */
  constructor(definition) {
    super(definition);
    this.series = definition.series;
    this.unit = definition.unit ?? '';
    this.formatY = definition.formatY ?? ((v) => shortNumber(v));
    this.logarithmicY = false;
    this.logarithmicX = false;
    this.fixedValues = false;
    this.minDisplayValue = definition.minimum ?? 0;
    this.maxDisplayValue = definition.maximum ?? 1;
    this.referenceLines = definition.referenceLines ?? [];
    this.hover = null;
    this._scale = null;
  }

  get supportsZoom() {
    return true;
  }

  get logarithmicYAllowed() {
    return !!this.definition.logarithmicYAllowed;
  }

  setFixedSpan(enabled, minimum, maximum) {
    this.fixedValues = enabled;
    if (minimum !== undefined) this.minDisplayValue = minimum;
    if (maximum !== undefined) this.maxDisplayValue = maximum;
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

  valueRange(traces, fstart, fstop) {
    if (this.fixedValues) {
      return [Number(this.minDisplayValue), Number(this.maxDisplayValue)];
    }
    let min = Infinity;
    let max = -Infinity;
    for (const trace of traces) {
      const { data } = trace;
      for (let i = 0; i < data.length; i += 1) {
        if (data[i].freq < fstart || data[i].freq > fstop) continue;
        const value = trace.value(data[i], i, data);
        if (!Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
    if (min === max) {
      const pad = Math.abs(min) * 0.1 || 1;
      return [min - pad, max + pad];
    }
    // round out to a whole number of divisions, as the desktop does
    const step = niceStep(max - min, Y_DIVISIONS);
    let low = Math.floor(min / step) * step;
    let high = Math.ceil(max / step) * step;
    if (this.logarithmicY) {
      low = Math.max(1e-12, min);
      high = max;
    }
    return [low, high];
  }

  drawChart(ctx) {
    const range = this.frequencyRange();
    const traces = this.traces();
    const { left, right, top, bottom, width, height } = this.plot;

    if (!range) {
      this.#drawEmptyFrame(ctx);
      return;
    }
    const [fstart, fstop] = range;
    const [minValue, maxValue] = this.valueRange(traces, fstart, fstop);

    this._scale = { fstart, fstop, minValue, maxValue };

    this.#drawBands(ctx, fstart, fstop);
    this.#drawGrid(ctx, fstart, fstop, minValue, maxValue);
    this.#drawReferenceLines(ctx, minValue, maxValue);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    for (const trace of traces) this.#drawTrace(ctx, trace, fstart, fstop);
    ctx.restore();

    this.#drawAnnotations(ctx);
    this.#drawMarkers(ctx);
    this.#drawHover(ctx);

    ctx.strokeStyle = this.theme.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
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

  yPosition(value) {
    const { top, height } = this.plot;
    const { minValue, maxValue } = this._scale;
    if (!Number.isFinite(value)) return null;
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

  #drawGrid(ctx, fstart, fstop, minValue, maxValue) {
    const { left, right, top, bottom, width } = this.plot;
    ctx.save();
    ctx.strokeStyle = this.theme.foreground;
    ctx.fillStyle = this.theme.text;
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';

    // horizontal lines and the y labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    if (this.logarithmicY) {
      const lo = Math.floor(Math.log10(Math.max(1e-12, minValue)));
      const hi = Math.ceil(Math.log10(Math.max(1e-12, maxValue)));
      for (let e = lo; e <= hi; e += 1) {
        const value = 10 ** e;
        const y = this.yPosition(value);
        if (y === null || y < top - 1 || y > bottom + 1) continue;
        line(ctx, left, y, right, y);
        ctx.fillText(this.formatY(value), left - 5, y);
      }
    } else {
      const step = niceStep(maxValue - minValue, Y_DIVISIONS);
      const first = Math.ceil(minValue / step) * step;
      for (let value = first; value <= maxValue + step * 1e-9; value += step) {
        const y = this.yPosition(value);
        if (y === null || y < top - 1 || y > bottom + 1) continue;
        line(ctx, left, y, right, y);
        // the step can be fractional, so round away accumulated error
        ctx.fillText(this.formatY(roundTo(value, step)), left - 5, y);
      }
    }

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
    for (let value = first; value <= fstop + step * 1e-9; value += step) {
      ticks.push(Math.round(value));
    }
    return ticks;
  }

  #drawReferenceLines(ctx, minValue, maxValue) {
    if (!this.referenceLines.length) return;
    const { left, right } = this.plot;
    ctx.save();
    ctx.strokeStyle = this.theme.swr;
    ctx.fillStyle = this.theme.swr;
    ctx.setLineDash([4, 3]);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (const value of this.referenceLines) {
      if (value < minValue || value > maxValue) continue;
      const y = this.yPosition(value);
      if (y === null) continue;
      line(ctx, left, y, right, y);
      ctx.fillText(this.formatY(value), left + 4, y - 1);
    }
    ctx.restore();
  }

  #colorFor(trace) {
    const { theme } = this;
    if (trace.isReference) {
      return trace.colorKey === 'referenceSecondary'
        ? theme.referenceSecondary
        : theme.reference;
    }
    return trace.colorKey === 'sweepSecondary' ? theme.sweepSecondary : theme.sweep;
  }

  #drawTrace(ctx, trace, fstart, fstop) {
    const { data } = trace;
    ctx.save();
    ctx.strokeStyle = this.#colorFor(trace);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = this.lineWidth;
    if (trace.dashed) ctx.setLineDash([5, 3]);

    let started = false;
    ctx.beginPath();
    for (let i = 0; i < data.length; i += 1) {
      const dp = data[i];
      if (dp.freq < fstart || dp.freq > fstop) {
        started = false;
        continue;
      }
      const value = trace.value(dp, i, data);
      const y = this.yPosition(value);
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
    const primary = this.series[0];
    const data = this.data[primary.source] ?? [];
    if (!data.length || marker.location < 0 || marker.location >= data.length) return null;
    const dp = data[marker.location];
    const value = primary.value(dp, marker.location, data);
    const y = this.yPosition(value);
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
