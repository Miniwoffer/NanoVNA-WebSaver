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

// The time domain chart: impulse response against distance, with the
// step response impedance on a second axis.

import { Chart, niceStep } from './base.js';
import { shortNumber } from './frequency.js';

export class TDRChart extends Chart {
  constructor(definition) {
    super(definition);
    /** the result of rf/tdr.js computeTDR */
    this.result = null;
    /** how much of the distance axis to show, in metres; null fits the peak */
    this.maxDisplayLength = null;
    this.minDisplayLength = 0;
    this.hover = null;
  }

  setResult(result) {
    this.result = result;
    this.requestDraw();
  }

  setLengthRange(min, max) {
    this.minDisplayLength = min;
    this.maxDisplayLength = max;
    this.requestDraw();
  }

  /** The span of the distance axis that is actually drawn. */
  lengthRange() {
    const { result } = this;
    if (!result) return [0, 1];
    // half the transform is the useful part; the rest is its mirror
    const usable = result.distanceAxis[Math.ceil(result.distanceAxis.length / 2)];
    if (this.maxDisplayLength !== null) {
      return [this.minDisplayLength, Math.max(this.minDisplayLength + 0.01, this.maxDisplayLength)];
    }
    // show a bit past the peak by default
    const peak = result.distanceAxis[result.indexPeak];
    const fitted = Math.min(usable, Math.max(peak * 3, peak + 1));
    return [0, fitted > 0 ? fitted : usable];
  }

  drawChart(ctx) {
    const { left, right, top, bottom, width, height } = this.plot;
    if (!this.result) {
      ctx.strokeStyle = this.theme.axis;
      ctx.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
      ctx.fillStyle = this.theme.text;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No data', (left + right) / 2, (top + bottom) / 2);
      return;
    }

    const { distanceAxis, impulse, stepResponseZ } = this.result;
    const [minLength, maxLength] = this.lengthRange();

    // the impulse response and the step response share the x axis but
    // get their own vertical scales
    let impulseMax = 0;
    let stepMin = Infinity;
    let stepMax = -Infinity;
    const count = Math.min(distanceAxis.length, impulse.length);
    for (let i = 0; i < count; i += 1) {
      const distance = distanceAxis[i];
      if (distance < minLength || distance > maxLength) continue;
      impulseMax = Math.max(impulseMax, Math.abs(impulse[i]));
      const z = stepResponseZ[i];
      if (Number.isFinite(z)) {
        stepMin = Math.min(stepMin, z);
        stepMax = Math.max(stepMax, z);
      }
    }
    if (!Number.isFinite(stepMin)) {
      stepMin = 0;
      stepMax = 1;
    }
    if (stepMin === stepMax) {
      stepMin -= 1;
      stepMax += 1;
    }
    if (impulseMax === 0) impulseMax = 1;

    this._scale = { minLength, maxLength, impulseMax, stepMin, stepMax };

    this.#drawGrid(ctx, minLength, maxLength, stepMin, stepMax);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    this.#drawSeries(ctx, distanceAxis, impulse, this.theme.sweep, (v) =>
      top + height / 2 - (v / impulseMax) * (height / 2) * 0.9,
    );
    this.#drawSeries(ctx, distanceAxis, stepResponseZ, this.theme.sweepSecondary, (v) =>
      top + height - (height * (v - stepMin)) / (stepMax - stepMin),
    );
    ctx.restore();

    this.#drawPeak(ctx);
    this.#drawHover(ctx);

    ctx.strokeStyle = this.theme.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
  }

  xPosition(distance) {
    const { left, width } = this.plot;
    const { minLength, maxLength } = this._scale;
    const span = maxLength - minLength;
    if (span <= 0) return left;
    return left + (width * (distance - minLength)) / span;
  }

  #drawGrid(ctx, minLength, maxLength, stepMin, stepMax) {
    const { left, right, top, bottom, width } = this.plot;
    ctx.save();
    ctx.strokeStyle = this.theme.foreground;
    ctx.fillStyle = this.theme.text;
    ctx.font = '10px system-ui, sans-serif';

    // distance along the bottom
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = niceStep(maxLength - minLength, Math.max(2, Math.round(width / 80)));
    const first = Math.ceil(minLength / step) * step;
    for (let d = first; d <= maxLength + step * 1e-9; d += step) {
      const x = this.xPosition(d);
      if (x < left - 1 || x > right + 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.fillText(`${shortNumber(d)} m`, x, bottom + 5);
    }

    // the step response impedance up the left edge
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const zStep = niceStep(stepMax - stepMin, 6);
    const zFirst = Math.ceil(stepMin / zStep) * zStep;
    for (let z = zFirst; z <= stepMax + zStep * 1e-9; z += zStep) {
      const y = bottom - ((bottom - top) * (z - stepMin)) / (stepMax - stepMin);
      if (y < top - 1 || y > bottom + 1) continue;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillText(shortNumber(z), left - 5, y);
    }
    ctx.restore();
  }

  #drawSeries(ctx, distance, values, color, toY) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = this.lineWidth;
    ctx.beginPath();
    let started = false;
    const { minLength, maxLength } = this._scale;
    const count = Math.min(distance.length, values.length);
    for (let i = 0; i < count; i += 1) {
      const d = distance[i];
      if (d < minLength) continue;
      if (d > maxLength) break;
      const value = values[i];
      if (!Number.isFinite(value)) {
        started = false;
        continue;
      }
      const x = this.xPosition(d);
      const y = toY(value);
      if (started) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        started = true;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  #drawPeak(ctx) {
    const { result } = this;
    const { top, bottom } = this.plot;
    const distance = result.distanceAxis[result.indexPeak];
    const { minLength, maxLength } = this._scale;
    if (distance < minLength || distance > maxLength) return;
    const x = this.xPosition(distance);
    ctx.save();
    ctx.strokeStyle = this.theme.swr;
    ctx.fillStyle = this.theme.swr;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = x > this.plot.right - 80 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${result.cableLength} m`, x + (x > this.plot.right - 80 ? -4 : 4), top + 2);
    ctx.restore();
  }

  updateHover(pos) {
    const previous = this.hover;
    this.hover = pos && this._scale ? pos : null;
    if (previous !== this.hover) this.requestDraw();
  }

  #drawHover(ctx) {
    if (!this.hover || !this._scale) return;
    const { left, right, top, bottom } = this.plot;
    const { x } = this.hover;
    if (x < left || x > right) return;
    const { minLength, maxLength } = this._scale;
    const distance = minLength + ((x - left) / (right - left)) * (maxLength - minLength);
    ctx.save();
    ctx.strokeStyle = this.theme.axis;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.theme.text;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = x > right - 80 ? 'right' : 'left';
    ctx.textBaseline = 'bottom';
    // the distance to a fault is half the round trip
    ctx.fillText(
      `${(distance / 2).toFixed(3)} m`,
      x + (x > right - 80 ? -4 : 4),
      bottom - 2,
    );
    ctx.restore();
  }

  markerPosition() {
    return null;
  }

  frequencyAt() {
    return null;
  }

  resetZoom() {
    this.maxDisplayLength = null;
    this.minDisplayLength = 0;
    this.requestDraw();
  }
}
