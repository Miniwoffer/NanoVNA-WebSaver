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

// The grid of chart panels, and the wiring that keeps them fed with data.
//
// The grid is a dashboard of Panels (see registry.js): each is a
// `.chart-card` that can span multiple grid columns/rows, dragged to
// reorder and resized via a corner handle, holding one or more
// `.mini-chart`s side by side (one per rendering bucket a panel's layers
// fall into -- see `buildMiniCharts`). `this.charts` stays a flat list of
// every mini-chart instance across every panel, so the existing
// apply*/updateData broadcasts don't need to know panels exist at all;
// `this.panels` tracks panel-level bookkeeping (DOM nodes, the panel's
// data, its editor) for the drag/resize/edit code.

import { button, checkbox, clear, downloadCanvas, el, numberInput, select } from './dom.js';
import { DARK_THEME, DEFAULT_THEME } from '../charts/base.js';
import {
  CHART_TYPES,
  CHART_TYPES_BY_KEY,
  buildMiniCharts,
  defaultAxisFor,
  defaultAxisLimits,
  makePanelId,
} from '../charts/registry.js';
import { computeTDR } from '../rf/tdr.js';
import { attachPanelDrag } from './dragreorder.js';
import { attachPanelResize } from './dragresize.js';

export class ChartGrid {
  constructor(state, container) {
    this.state = state;
    this.container = container;
    this.charts = [];
    this.panels = [];
    this.tdrResult = null;
    /** the id of the panel whose inline editor is open, if any, kept
     * across rebuilds so editing several layers in a row doesn't require
     * reopening the editor after every change */
    this.openEditorPanelId = null;

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

  /** Recreate every panel and mini-chart from the saved layout. */
  rebuild() {
    clear(this.container);
    this.charts = [];
    this.panels = [];

    this.container.style.gridTemplateColumns =
      `repeat(${this.state.settings.columns}, minmax(0, 1fr))`;

    for (const panelData of this.state.settings.layout) {
      this.panels.push(this.#buildPanelCard(panelData));
    }
    for (const entry of this.panels) this.container.append(entry.cardEl);
    this.container.append(this.#addPanelTile());

    this.applyTheme();
    this.applyStyle();
    this.applyBands();
    this.applyMarkers();
    this.updateData();
  }

  #buildPanelCard(panelData) {
    const minis = buildMiniCharts(panelData);
    const miniRow = el('div.mini-chart-row');

    for (const { chart } of minis) {
      const canvas = el('canvas.chart-canvas');
      miniRow.append(
        el(
          'div.mini-chart',
          {},
          canvas,
          el(
            'div.chart-actions',
            {},
            el('button.chart-action', {
              type: 'button',
              textContent: 'PNG',
              title: 'Save this chart as an image',
              on: { click: () => downloadCanvas(`${chart.key}.png`, canvas) },
            }),
          ),
        ),
      );
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

    const dragHandle = el('span.chart-drag', { title: 'Drag to reorder' }, '⠷');
    const editButton = el('button.chart-action', {
      type: 'button',
      textContent: '⚙',
      title: 'Edit this panel',
    });
    const removeButton = el('button.chart-action', {
      type: 'button',
      textContent: '×',
      title: 'Remove this panel',
      on: { click: () => this.removePanel(panelData.id) },
    });

    const editor = this.#panelEditor(panelData);
    editButton.addEventListener('click', () => {
      const opening = editor.node.hidden;
      editor.node.hidden = !opening;
      this.openEditorPanelId = opening ? panelData.id : null;
    });
    editor.node.hidden = this.openEditorPanelId !== panelData.id;

    const header = el(
      'div.chart-card-header',
      {},
      dragHandle,
      el('span.chart-card-title', { title: this.#panelTitle(panelData) }, this.#panelTitle(panelData)),
      el(
        'div.chart-card-header-actions',
        {},
        el('button.chart-action', {
          type: 'button',
          textContent: 'Reset zoom',
          title: 'Show the whole sweep again',
          on: { click: () => this.state.emit('resetZoom') },
        }),
        editButton,
        removeButton,
      ),
    );

    const resizeHandle = el('div.chart-resize', { title: 'Drag to resize' });
    const cardEl = el(
      'figure.chart-card',
      {
        dataset: { panelId: panelData.id, colSpan: String(panelData.colSpan), rowSpan: String(panelData.rowSpan) },
        style: { gridColumn: `span ${panelData.colSpan}`, gridRow: `span ${panelData.rowSpan}` },
      },
      header,
      miniRow,
      editor.node,
      resizeHandle,
    );

    attachPanelDrag(dragHandle, cardEl, {
      container: this.container,
      onDrop: () => this.#commitOrder(),
    });
    attachPanelResize(resizeHandle, cardEl, {
      columns: this.state.settings.columns,
      onCommit: (colSpan, rowSpan) => this.resizePanel(panelData.id, colSpan, rowSpan),
    });

    return { panel: panelData, minis, cardEl, editor };
  }

  #panelTitle(panelData) {
    return panelData.layers
      .map((l) => CHART_TYPES_BY_KEY.get(l.chartKey)?.name ?? l.chartKey)
      .join(' + ');
  }

  #addPanelTile() {
    return el(
      'button.chart-card-add',
      { type: 'button', title: 'Add a panel', on: { click: () => this.addPanel() } },
      '+ Add panel',
    );
  }

  /** The inline layer/axis editor appended to the end of a panel's card. */
  #panelEditor(initialPanel) {
    const container = el('div.panel-editor', { hidden: true });
    let panelData = initialPanel;

    const render = () => {
      clear(container);

      panelData.layers.forEach((layer, index) => {
        const definition = CHART_TYPES_BY_KEY.get(layer.chartKey);
        const isFrequency = definition?.kind === 'frequency';
        container.append(
          el(
            'div.panel-editor-row',
            {},
            el('span.panel-editor-name', {}, definition?.name ?? layer.chartKey),
            isFrequency
              ? select(
                  [['left', 'Left axis'], ['right', 'Right axis']],
                  layer.axis,
                  (event) => {
                    const layers = panelData.layers.map((l, i) =>
                      i === index ? { ...l, axis: event.target.value } : l);
                    this.updatePanelLayers(panelData.id, layers);
                  },
                )
              : null,
            button('Remove', () => {
              const layers = panelData.layers.filter((_, i) => i !== index);
              if (layers.length) this.updatePanelLayers(panelData.id, layers);
              else this.removePanel(panelData.id);
            }, { variant: 'danger' }),
          ),
        );
      });

      const addSelect = select(
        CHART_TYPES.map((t) => [t.key, `${t.group}: ${t.name}`]),
        CHART_TYPES[0].key,
      );
      container.append(
        el(
          'div.panel-editor-row',
          {},
          addSelect,
          button('Add layer', () => {
            const chartKey = addSelect.value;
            const definition = CHART_TYPES_BY_KEY.get(chartKey);
            const alreadyHasTdr = panelData.layers.some(
              (l) => CHART_TYPES_BY_KEY.get(l.chartKey)?.kind === 'tdr',
            );
            if (definition?.kind === 'tdr' && alreadyHasTdr) {
              this.state.setStatus('A panel can only show one TDR chart.');
              return;
            }
            const axis = defaultAxisFor(panelData, chartKey);
            this.updatePanelLayers(panelData.id, [...panelData.layers, { chartKey, axis }]);
          }),
        ),
      );

      const frequencyAxes = new Set(
        panelData.layers
          .filter((l) => CHART_TYPES_BY_KEY.get(l.chartKey)?.kind === 'frequency')
          .map((l) => l.axis),
      );
      for (const side of ['left', 'right']) {
        if (!frequencyAxes.has(side)) continue;
        const limits = panelData.axisLimits[side];
        container.append(
          el(
            'div.panel-editor-row',
            {},
            checkbox(`Fixed range (${side})`, limits.mode === 'fixed', (event) => {
              this.updatePanelAxisLimits(panelData.id, {
                [side]: { ...limits, mode: event.target.checked ? 'fixed' : 'auto' },
              });
            }),
            numberInput(limits.min, (event) => {
              this.updatePanelAxisLimits(panelData.id, {
                [side]: { ...panelData.axisLimits[side], min: Number(event.target.value) || 0 },
              });
            }, { step: 'any', disabled: limits.mode !== 'fixed' }),
            numberInput(limits.max, (event) => {
              this.updatePanelAxisLimits(panelData.id, {
                [side]: { ...panelData.axisLimits[side], max: Number(event.target.value) || 0 },
              });
            }, { step: 'any', disabled: limits.mode !== 'fixed' }),
          ),
        );
      }

      container.append(
        el(
          'div.panel-editor-row',
          {},
          button('Remove panel', () => this.removePanel(panelData.id), { variant: 'danger' }),
        ),
      );
    };

    render();
    return {
      node: container,
      setPanel: (newPanelData) => {
        panelData = newPanelData;
        render();
      },
    };
  }

  /** Read the panel order back out of the DOM after a drag-reorder. */
  #commitOrder() {
    const order = [...this.container.children]
      .filter((node) => node.classList.contains('chart-card'))
      .map((node) => node.dataset.panelId);
    const byId = new Map(this.state.settings.layout.map((p) => [p.id, p]));
    const layout = order.map((id) => byId.get(id)).filter(Boolean);
    this.state.updateSettings({ layout });
    // no chart instances change shape and the DOM is already in the new
    // order, so a full rebuild would only be wasted work
  }

  addPanel() {
    const layout = [
      ...this.state.settings.layout,
      {
        id: makePanelId(),
        colSpan: 1,
        rowSpan: 1,
        layers: [{ chartKey: CHART_TYPES[0].key, axis: 'left' }],
        axisLimits: defaultAxisLimits(),
      },
    ];
    this.state.updateSettings({ layout });
    this.rebuild();
  }

  removePanel(panelId) {
    const layout = this.state.settings.layout.filter((p) => p.id !== panelId);
    if (this.openEditorPanelId === panelId) this.openEditorPanelId = null;
    this.state.updateSettings({ layout });
    this.rebuild();
  }

  resizePanel(panelId, colSpan, rowSpan) {
    const layout = this.state.settings.layout.map((p) =>
      p.id === panelId ? { ...p, colSpan, rowSpan } : p);
    this.state.updateSettings({ layout });
    const entry = this.panels.find((e) => e.panel.id === panelId);
    if (entry) {
      entry.panel = layout.find((p) => p.id === panelId);
      entry.cardEl.dataset.colSpan = String(colSpan);
      entry.cardEl.dataset.rowSpan = String(rowSpan);
      entry.cardEl.style.gridColumn = `span ${colSpan}`;
      entry.cardEl.style.gridRow = `span ${rowSpan}`;
    }
  }

  updatePanelLayers(panelId, layers) {
    const layout = this.state.settings.layout.map((p) =>
      p.id === panelId ? { ...p, layers } : p);
    this.openEditorPanelId = panelId;
    this.state.updateSettings({ layout });
    this.rebuild();
  }

  updatePanelAxisLimits(panelId, axisLimits) {
    const layout = this.state.settings.layout.map((p) =>
      p.id === panelId ? { ...p, axisLimits: { ...p.axisLimits, ...axisLimits } } : p);
    this.state.updateSettings({ layout });
    const entry = this.panels.find((e) => e.panel.id === panelId);
    if (!entry) return;
    entry.panel = layout.find((p) => p.id === panelId);
    entry.editor.setPanel(entry.panel);
    for (const { kind, chart } of entry.minis) {
      if (kind === 'frequency') chart.setAxisLimits(entry.panel.axisLimits);
    }
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
