/*
 *  NanoVNA-WebSaver
 *
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

// The grid of charts, and the wiring that keeps them fed with data.

import { clear, downloadCanvas, el } from './dom.js';
import { DARK_THEME, DEFAULT_THEME } from '../charts/base.js';
import { CHART_TYPES_BY_KEY, createChart } from '../charts/registry.js';
import { computeTDR } from '../rf/tdr.js';

export class ChartGrid {
  constructor(state, container) {
    this.state = state;
    this.container = container;
    this.charts = [];
    this.tdrResult = null;

    state.on('data', () => this.updateData());
    state.on('reference', () => this.updateData());
    state.on('markers', () => this.applyMarkers());
    state.on('settings', () => {
      this.applyTheme();
      this.applyStyle();
      this.applyBands();
      this.updateData();
    });
    state.on('analysis', (result) => this.applyAnnotations(result));

    if (window.matchMedia) {
      window
        .matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', () => this.applyTheme());
    }
    window.addEventListener('resize', () => this.redraw());

    this.rebuild();
  }

  get theme() {
    const setting = this.state.settings.theme;
    const dark =
      setting === 'dark' ||
      (setting === 'system' &&
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    return dark ? DARK_THEME : DEFAULT_THEME;
  }

  /** Recreate every chart from the saved layout. */
  rebuild() {
    clear(this.container);
    this.charts = [];

    for (const key of this.state.settings.layout) {
      if (!CHART_TYPES_BY_KEY.has(key)) continue;
      const chart = createChart(key);
      const canvas = el('canvas.chart-canvas');
      const card = el(
        'figure.chart-card',
        {},
        canvas,
        el(
          'figcaption.chart-actions',
          {},
          el('button.chart-action', {
            type: 'button',
            textContent: 'PNG',
            title: 'Save this chart as an image',
            on: {
              click: () => downloadCanvas(`${chart.key}.png`, canvas),
            },
          }),
          el('button.chart-action', {
            type: 'button',
            textContent: 'Reset zoom',
            title: 'Show the whole sweep again',
            on: { click: () => this.state.emit('resetZoom') },
          }),
        ),
      );
      this.container.append(card);
      chart.attach(canvas);

      chart.onMarkerMove = (index, freq) => this.state.setMarkerFrequency(index, freq);
      chart.onZoom = (start, end) => {
        if (start === null) return; // a double click resets the sweep span
        try {
          this.state.updateSweep({ start, end });
        } catch (error) {
          this.state.setStatus(error.message);
        }
      };

      this.charts.push(chart);
    }

    this.applyColumns();
    this.applyTheme();
    this.applyStyle();
    this.applyBands();
    this.applyMarkers();
    this.updateData();
  }

  applyColumns() {
    this.container.style.gridTemplateColumns =
      `repeat(${this.state.settings.columns}, minmax(0, 1fr))`;
    this.redraw();
  }

  applyTheme() {
    const { theme } = this;
    for (const chart of this.charts) chart.setTheme(theme);
    document.documentElement.dataset.theme = theme === DARK_THEME ? 'dark' : 'light';
  }

  applyStyle() {
    const { drawLines, pointSize, lineWidth } = this.state.settings;
    for (const chart of this.charts) {
      chart.drawLines = drawLines;
      chart.pointSize = pointSize;
      chart.lineWidth = lineWidth;
      chart.requestDraw();
    }
  }

  applyBands() {
    const { bandsEnabled } = this.state.settings;
    for (const chart of this.charts) chart.setBands(this.state.bands, bandsEnabled);
  }

  applyMarkers() {
    for (const chart of this.charts) chart.setMarkers(this.state.markers);
  }

  applyAnnotations(result) {
    const annotations = result ? result.annotations : [];
    for (const chart of this.charts) chart.setAnnotations(annotations);
  }

  updateData() {
    const { data, reference } = this.state;
    for (const chart of this.charts) chart.setData(data, reference);
    this.updateTDR();
  }

  /** Recompute the time domain transform when the sweep changes. */
  updateTDR() {
    const tdrCharts = this.charts.filter((chart) => chart.key === 'tdr');
    const { tdr } = this.state.settings;
    let result = null;
    try {
      result = computeTDR(this.state.data.s11, {
        velocityFactor: tdr.velocityFactor,
        format: tdr.format,
        window: tdr.window,
      });
    } catch (error) {
      console.warn('TDR failed', error);
    }
    this.tdrResult = result;
    this.state.tdrResult = result;
    for (const chart of tdrCharts) chart.setResult(result);
    this.state.emit('tdr', result);
  }

  redraw() {
    for (const chart of this.charts) chart.requestDraw();
  }
}
