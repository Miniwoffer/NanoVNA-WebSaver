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

// The chart base: canvas plumbing, the theme, and the pointer handling
// that every chart shares. Ported in spirit from NanoVNASaver/Charts.

/**
 * Colours for a panel combining more than one layer, cycled by index.
 *
 * A single-layer chart never uses this -- it keeps the two-tone
 * sweep/sweepSecondary scheme below, unchanged from before panels could
 * hold more than one layer.
 */
export const LAYER_PALETTE = [
  '#0000ff', '#008000', '#cc6600', '#aa00aa', '#008b8b', '#b8860b',
];
export const DARK_LAYER_PALETTE = [
  '#4f9dff', '#3ddc84', '#e8a33d', '#d072ff', '#37d5d6', '#e0c341',
];

export const DEFAULT_THEME = {
  background: '#ffffff',
  foreground: '#bbbbbb',
  text: '#333333',
  axis: '#808080',
  sweep: '#0000ff',
  sweepSecondary: '#008000',
  reference: '#00ffff',
  referenceSecondary: '#990099',
  bands: 'rgba(128, 128, 128, 0.25)',
  swr: '#ff0000',
  markerColors: ['#ffdf00', '#00d0ff', '#ff6ec7', '#7cff5b'],
  layerPalette: LAYER_PALETTE,
};

export const DARK_THEME = {
  ...DEFAULT_THEME,
  background: '#15181d',
  foreground: '#3a4049',
  text: '#c9d1d9',
  axis: '#6b7683',
  sweep: '#4f9dff',
  sweepSecondary: '#3ddc84',
  reference: '#37d5d6',
  referenceSecondary: '#d072ff',
  bands: 'rgba(160, 170, 190, 0.18)',
  swr: '#ff6b6b',
  layerPalette: DARK_LAYER_PALETTE,
};

/**
 * The colour one trace draws in.
 *
 * A trace carrying a `paletteIndex` (set once a panel combines more than
 * one layer) cycles through the theme's layer palette, so every line in
 * a combined panel is distinguishable regardless of which chart type or
 * axis it came from. Otherwise falls back to the original two-tone
 * sweep/reference scheme a single-layer chart has always used, so an
 * unmodified single-chart-type panel renders exactly as before.
 */
export function colorForTrace(theme, trace) {
  if (trace.paletteIndex !== undefined) {
    const palette = theme.layerPalette ?? LAYER_PALETTE;
    return palette[trace.paletteIndex % palette.length];
  }
  if (trace.isReference) {
    return trace.colorKey === 'referenceSecondary' ? theme.referenceSecondary : theme.reference;
  }
  return trace.colorKey === 'sweepSecondary' ? theme.sweepSecondary : theme.sweep;
}

const MARGIN = { left: 46, right: 18, top: 26, bottom: 30 };
/** how close a click has to be, in pixels, to grab a marker */
const MARKER_GRAB_RADIUS = 20;

let nextChartId = 1;

export class Chart {
  /**
   * @param {{key: string, name: string}} definition
   */
  constructor(definition) {
    this.definition = definition;
    this.key = definition.key;
    this.name = definition.name;
    this.id = `chart-${nextChartId}`;
    nextChartId += 1;

    this.canvas = null;
    this.ctx = null;
    this.width = 0;
    this.height = 0;

    this.theme = DEFAULT_THEME;
    this.data = { s11: [], s21: [] };
    this.reference = { s11: [], s21: [] };
    this.markers = [];
    this.bands = [];
    this.bandsEnabled = false;
    this.annotations = [];
    this.drawLines = true;
    this.pointSize = 2;
    this.lineWidth = 1;

    /** called with (markerIndex, frequency) while a marker is dragged */
    this.onMarkerMove = null;
    /** called with (startFreq, endFreq) when the user drags out a span */
    this.onZoom = null;

    this._draggingMarker = -1;
    this._dragStart = null;
    this._dragCurrent = null;
    this._pending = false;
  }

  /** Whether dragging across the plot picks a new sweep span. */
  get supportsZoom() {
    return false;
  }

  attach(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.#onPointerUp(e));
    canvas.addEventListener('pointercancel', () => this.#endDrag());
    canvas.addEventListener('pointerleave', (e) => this.#onPointerMove(e, true));
    canvas.addEventListener('dblclick', () => this.resetZoom());
    return this;
  }

  setTheme(theme) {
    this.theme = theme;
    this.requestDraw();
  }

  setData(data, reference) {
    this.data = data ?? { s11: [], s21: [] };
    this.reference = reference ?? { s11: [], s21: [] };
    this.requestDraw();
  }

  setMarkers(markers) {
    this.markers = markers;
    this.requestDraw();
  }

  setBands(bands, enabled) {
    this.bands = bands;
    this.bandsEnabled = enabled;
    this.requestDraw();
  }

  setAnnotations(annotations) {
    this.annotations = annotations ?? [];
    this.requestDraw();
  }

  /** Coalesce redraws into one per animation frame. */
  requestDraw() {
    if (this._pending || !this.ctx) return;
    this._pending = true;
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn) => setTimeout(fn, 16);
    schedule(() => {
      this._pending = false;
      this.draw();
    });
  }

  /** Match the backing store to the element's size and pixel ratio. */
  resize() {
    if (!this.canvas) return false;
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.width && height === this.height && this._ratio === ratio) {
      return false;
    }
    this.width = width;
    this.height = height;
    this._ratio = ratio;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    return true;
  }

  get plot() {
    return {
      left: MARGIN.left,
      top: MARGIN.top,
      right: this.width - MARGIN.right,
      bottom: this.height - MARGIN.bottom,
      width: this.width - MARGIN.left - MARGIN.right,
      height: this.height - MARGIN.top - MARGIN.bottom,
    };
  }

  draw() {
    if (!this.ctx) return;
    this.resize();
    const { ctx } = this;
    ctx.setTransform(this._ratio || 1, 0, 0, this._ratio || 1, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.fillStyle = this.theme.text;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.name, MARGIN.left, 6);

    if (this.plot.width <= 0 || this.plot.height <= 0) return;
    this.drawChart(ctx);
    this.drawDragBox(ctx);
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  drawChart(ctx) {
    // implemented by each chart
  }

  drawDragBox(ctx) {
    if (!this.supportsZoom) return;
    if (!this._dragStart || !this._dragCurrent || this._draggingMarker >= 0) return;
    const { top, bottom } = this.plot;
    const x0 = Math.min(this._dragStart.x, this._dragCurrent.x);
    const x1 = Math.max(this._dragStart.x, this._dragCurrent.x);
    if (x1 - x0 < 3) return;
    ctx.save();
    ctx.fillStyle = 'rgba(100, 150, 255, 0.18)';
    ctx.strokeStyle = 'rgba(100, 150, 255, 0.7)';
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
    ctx.strokeRect(x0, top, x1 - x0, bottom - top);
    ctx.restore();
  }

  /** Pointer position in canvas coordinates. */
  #position(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  #onPointerDown(event) {
    const pos = this.#position(event);
    this.canvas.setPointerCapture?.(event.pointerId);
    const marker = this.markerAt(pos);
    if (marker >= 0) {
      this._draggingMarker = marker;
      this.#moveMarker(pos);
      return;
    }
    // a drag across the plot picks a new sweep span
    this._dragStart = pos;
    this._dragCurrent = pos;
  }

  #onPointerMove(event, leaving = false) {
    if (this._draggingMarker < 0 && !this._dragStart) {
      if (!leaving) this.updateHover(this.#position(event));
      else this.updateHover(null);
      return;
    }
    const pos = this.#position(event);
    if (this._draggingMarker >= 0) {
      this.#moveMarker(pos);
      return;
    }
    this._dragCurrent = pos;
    this.requestDraw();
  }

  #onPointerUp(event) {
    const pos = this.#position(event);
    if (this._draggingMarker >= 0) {
      this.#moveMarker(pos);
      this.#endDrag();
      return;
    }
    if (this._dragStart && this.onZoom) {
      const dx = Math.abs(pos.x - this._dragStart.x);
      if (dx >= 8 && this.supportsZoom) {
        const a = this.frequencyAt(Math.min(pos.x, this._dragStart.x));
        const b = this.frequencyAt(Math.max(pos.x, this._dragStart.x));
        if (a !== null && b !== null && b > a) this.onZoom(Math.round(a), Math.round(b));
      } else {
        // a plain click drops the nearest marker here
        this.#moveMarker(pos, 0);
      }
    }
    this.#endDrag();
  }

  #endDrag() {
    this._draggingMarker = -1;
    this._dragStart = null;
    this._dragCurrent = null;
    this.requestDraw();
  }

  #moveMarker(pos, index = this._draggingMarker) {
    if (!this.onMarkerMove) return;
    const freq = this.frequencyAt(pos.x, pos.y);
    if (freq === null) return;
    const marker = index >= 0 ? index : 0;
    this.onMarkerMove(marker, Math.round(freq));
  }

  /** Which marker, if any, is under the pointer. */
  markerAt(pos) {
    let best = -1;
    let bestDistance = MARKER_GRAB_RADIUS;
    this.markers.forEach((marker, index) => {
      if (!marker.enabled || marker.location < 0) return;
      const point = this.markerPosition(marker);
      if (!point) return;
      const distance = Math.hypot(pos.x - point.x, pos.y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  markerPosition(marker) {
    return null;
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  frequencyAt(x, y) {
    return null;
  }

  // eslint-disable-next-line no-unused-vars
  updateHover(pos) {
    // charts that show a readout under the cursor override this
  }

  resetZoom() {
    if (this.onZoom) this.onZoom(null, null);
  }

  /** Draw a marker as a downward pointing triangle. */
  drawMarkerGlyph(ctx, x, y, color, label) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = this.theme.background;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 6, y - 10);
    ctx.lineTo(x + 6, y - 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (label) {
      ctx.fillStyle = this.theme.text;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, x, y - 11);
    }
    ctx.restore();
  }

  /**
   * A row of "swatch label" pairs, wrapped to fit `maxWidth`.
   *
   * Used when a panel combines more than one layer into a mini-chart, so
   * the reader can tell which trace is which; a single-layer chart never
   * has more than one distinct label and so never calls this.
   *
   * @param {{label:string, color:string}[]} items
   * @returns {number} the height in pixels the legend occupied
   */
  drawLegend(ctx, items, x, y, maxWidth) {
    if (!items.length) return 0;
    ctx.save();
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const swatch = 7;
    const gapAfterSwatch = 4;
    const gapBetweenItems = 12;
    const lineHeight = 14;
    let cx = x;
    let cy = y + lineHeight / 2;
    let rows = 1;
    for (const item of items) {
      const textWidth = ctx.measureText(item.label).width;
      const itemWidth = swatch + gapAfterSwatch + textWidth;
      if (cx > x && cx + itemWidth > x + maxWidth) {
        cx = x;
        cy += lineHeight;
        rows += 1;
      }
      ctx.fillStyle = item.color;
      ctx.fillRect(cx, cy - swatch / 2, swatch, swatch);
      ctx.fillStyle = this.theme.text;
      ctx.textAlign = 'left';
      ctx.fillText(item.label, cx + swatch + gapAfterSwatch, cy);
      cx += itemWidth + gapBetweenItems;
    }
    ctx.restore();
    return rows * lineHeight;
  }
}

/** A nicely rounded step for an axis covering `span` in `count` divisions. */
export function niceStep(span, count) {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const rough = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  let step;
  if (normalised <= 1) step = 1;
  else if (normalised <= 2) step = 2;
  else if (normalised <= 2.5) step = 2.5;
  else if (normalised <= 5) step = 5;
  else step = 10;
  return step * magnitude;
}
