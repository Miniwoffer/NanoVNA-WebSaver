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

// The Smith and polar charts, which plot the reflection coefficient on
// the unit circle rather than against frequency.

import { Chart, colorForTrace } from './base.js';

/** The constant resistance and reactance circles a Smith chart shows. */
const RESISTANCE_CIRCLES = [0.2, 0.5, 1, 2, 5];
const REACTANCE_ARCS = [0.2, 0.5, 1, 2, 5];

/** Height reserved above the plot for the combined-panel legend. */
const LEGEND_HEIGHT = 16;

export class PolarChart extends Chart {
  constructor(definition) {
    super(definition);
    this.series = definition.series;
    /** rings drawn at these radii, as a fraction of the unit circle */
    this.rings = definition.rings ?? [0.25, 0.5, 0.75, 1];
    this._legendHeight = 0;
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

  /** Centre and radius of the unit circle within the plot area. */
  geometry() {
    const { left, top, width, height } = this.plot;
    const radius = Math.max(1, Math.min(width, height) / 2 - 4);
    return {
      cx: left + width / 2,
      cy: top + height / 2,
      radius,
    };
  }

  position(re, im) {
    const { cx, cy, radius } = this.geometry();
    return { x: cx + re * radius, y: cy - im * radius };
  }

  traces() {
    const out = [];
    for (const series of this.series) {
      const data = this.data[series.source] ?? [];
      if (data.length) out.push({ ...series, data, isReference: false });
      const reference = this.reference[series.source] ?? [];
      if (reference.length) out.push({ ...series, data: reference, isReference: true });
    }
    return out;
  }

  drawChart(ctx) {
    const traces = this.traces();
    const legendItems = this.#legendItems(traces);
    this._legendHeight = legendItems.length ? LEGEND_HEIGHT : 0;

    this.drawGrid(ctx);
    for (const trace of traces) this.#drawTrace(ctx, trace);
    this.#drawMarkers(ctx);

    if (legendItems.length) {
      const basePlot = super.plot;
      this.drawLegend(ctx, legendItems, basePlot.left, basePlot.top, basePlot.width);
    }
  }

  /**
   * Labels for the legend, one per distinct live trace.
   *
   * As in `FrequencyChart`, only shown once a panel actually combines
   * more than one layer -- signalled by a trace carrying `paletteIndex`
   * -- so a single-chart-type Smith or Polar panel keeps rendering
   * exactly as it always has, with no legend.
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

  drawGrid(ctx) {
    const { cx, cy, radius } = this.geometry();
    ctx.save();
    ctx.strokeStyle = this.theme.foreground;
    ctx.lineWidth = 1;
    for (const ring of this.rings) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * ring, 0, Math.PI * 2);
      ctx.stroke();
    }
    // the axes
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();
    ctx.strokeStyle = this.theme.axis;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  #drawTrace(ctx, trace) {
    const { data } = trace;
    ctx.save();
    ctx.strokeStyle = colorForTrace(this.theme, trace);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = this.lineWidth;
    if (trace.isReference && trace.paletteIndex !== undefined) ctx.globalAlpha = 0.55;
    ctx.beginPath();
    let started = false;
    for (const dp of data) {
      const point = this.position(dp.re, dp.im);
      if (this.drawLines) {
        if (started) ctx.lineTo(point.x, point.y);
        else {
          ctx.moveTo(point.x, point.y);
          started = true;
        }
      } else {
        ctx.moveTo(point.x + this.pointSize, point.y);
        ctx.arc(point.x, point.y, this.pointSize, 0, Math.PI * 2);
      }
    }
    if (this.drawLines) ctx.stroke();
    else ctx.fill();
    ctx.restore();
  }

  markerPosition(marker) {
    const source = this.series[0].source;
    const data = this.data[source] ?? [];
    if (!data.length || marker.location < 0 || marker.location >= data.length) return null;
    const dp = data[marker.location];
    return this.position(dp.re, dp.im);
  }

  #drawMarkers(ctx) {
    this.markers.forEach((marker, index) => {
      if (!marker.enabled || marker.location < 0) return;
      const point = this.markerPosition(marker);
      if (!point) return;
      this.drawMarkerGlyph(
        ctx,
        point.x,
        point.y,
        marker.color ?? this.theme.markerColors[index % 4],
        `${index + 1}`,
      );
    });
  }

  /**
   * The frequency of the sweep point nearest the cursor.
   *
   * There is no frequency axis here, so the nearest plotted point wins.
   */
  frequencyAt(x, y) {
    const source = this.series[0].source;
    const data = this.data[source] ?? [];
    if (!data.length || y === undefined) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const dp of data) {
      const point = this.position(dp.re, dp.im);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = dp;
      }
    }
    return best ? best.freq : null;
  }

  resetZoom() {
    // there is no frequency axis to zoom
  }
}

export class SmithChart extends PolarChart {
  drawGrid(ctx) {
    const { cx, cy, radius } = this.geometry();
    ctx.save();
    ctx.strokeStyle = this.theme.foreground;
    ctx.lineWidth = 1;

    // Constant resistance circles: for a normalised resistance r the
    // circle has centre r/(1+r) and radius 1/(1+r).
    for (const r of RESISTANCE_CIRCLES) {
      const centre = r / (1 + r);
      const rad = 1 / (1 + r);
      ctx.beginPath();
      ctx.arc(cx + centre * radius, cy, rad * radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Constant reactance arcs: centred at 1 + j/x with radius 1/|x|,
    // clipped to the unit circle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    for (const x of REACTANCE_ARCS) {
      for (const sign of [1, -1]) {
        const arcRadius = radius / x;
        ctx.beginPath();
        ctx.arc(cx + radius, cy - (sign * radius) / x, arcRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // the real axis and the outer boundary
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.stroke();
    ctx.strokeStyle = this.theme.axis;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
