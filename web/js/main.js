/*
 *  NanoVNA-WebSaver
 *
 *  A web application to view and export Touchstone data from a NanoVNA
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

import { AppState } from './app/state.js';
import { ChartGrid } from './ui/chartgrid.js';
import { clear, el } from './ui/dom.js';
import {
  analysisPanel,
  calibrationPanel,
  devicePanel,
  displayPanel,
  filesPanel,
  markerPanel,
  sweepPanel,
  tdrPanel,
} from './ui/panels.js';

const VERSION = '1.0.0';

function main() {
  const state = new AppState();

  const chartsContainer = el('div.chart-grid');
  const chartGrid = new ChartGrid(state, chartsContainer);

  const statusText = el('span.status-text', {}, state.status);
  const sweepStatus = el('span.status-sweep');

  const sidebar = el(
    'aside.sidebar',
    {},
    devicePanel(state),
    sweepPanel(state),
    markerPanel(state),
    calibrationPanel(state),
    filesPanel(state),
    analysisPanel(state),
    tdrPanel(state),
    displayPanel(state, chartGrid),
    el(
      'p.about',
      {},
      `NanoVNA-WebSaver ${VERSION}. `,
      el('a', {
        href: 'https://github.com/NanoVNA-Saver/nanovna-saver',
        target: '_blank',
        rel: 'noreferrer noopener',
        textContent: 'Project page',
      }),
      '. Licensed under the GNU GPL v3 or later.',
    ),
  );

  const screenshotHolder = el('div.screenshot', { hidden: true });

  document.body.append(
    el(
      'div.layout',
      {},
      el(
        'header.topbar',
        {},
        el('h1.brand', {}, 'NanoVNA-WebSaver'),
        el('div.status', {}, statusText, sweepStatus),
      ),
      sidebar,
      el('main.workspace', {}, screenshotHolder, chartsContainer),
    ),
  );

  state.on('status', (text) => {
    statusText.textContent = text;
  });

  state.on('sweepState', ({ running, percentage }) => {
    sweepStatus.textContent = running ? `sweeping ${percentage.toFixed(0)}%` : '';
  });

  state.on('error', (message) => {
    statusText.textContent = message.split('\n')[0];
    statusText.classList.add('error');
    setTimeout(() => statusText.classList.remove('error'), 4000);
  });

  state.on('resetZoom', () => {
    // put the sweep span back to what the data covers
    const { s11 } = state.data;
    if (s11.length > 1) {
      state.updateSweep({ start: s11[0].freq, end: s11[s11.length - 1].freq });
    }
  });

  // the device's own screen, when it can send one
  state.on('screenshot', (image) => {
    clear(screenshotHolder);
    screenshotHolder.hidden = false;
    const canvas = el('canvas.screenshot-canvas', {
      width: image.width,
      height: image.height,
    });
    canvas.getContext('2d').putImageData(
      new ImageData(image.rgba, image.width, image.height),
      0,
      0,
    );
    screenshotHolder.append(
      el('div.screenshot-head', {},
         el('span', {}, 'Device screen'),
         el('button.chart-action', {
           type: 'button',
           textContent: 'Close',
           on: { click: () => { screenshotHolder.hidden = true; } },
         })),
      canvas,
    );
  });

  // keep the charts sized to the window
  const observer = new ResizeObserver(() => chartGrid.redraw());
  observer.observe(chartsContainer);

  state.setStatus(
    state.connected ? state.status : 'Not connected. Use "Add device" to pick a serial port.',
  );

  // Exposed so the sweep, the data and the charts can be inspected and
  // scripted from the browser console.
  window.nanovna = { state, chartGrid, version: VERSION };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
