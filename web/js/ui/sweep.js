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

// The sweep controls at the top left. The parameters live in a menu; the
// run buttons and the progress bar stay in the bar itself, because Stop
// is the one control that must never be a click away behind a dropdown
// while the instrument is running.

import { button, checkbox, el, field, numberInput, textInput } from './dom.js';
import { menuButton, menuHeading } from './menu.js';
import { formatFrequencySweep, parseFrequency } from '../util/format.js';
import { SweepMode } from '../rf/sweep.js';

/** Report a failure to the user without stopping the application. */
function guard(state, action) {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      state.setStatus(error.message);
      state.emit('error', error.message);
    }
  };
}

export function sweepControls(state) {
  /** Apply a sweep change, putting the fields back if it is rejected. */
  const apply = (changes) => {
    try {
      state.updateSweep(changes);
    } catch (error) {
      state.setStatus(error.message);
      render();
    }
  };

  const startInput = textInput('', () => {});
  const endInput = textInput('', () => {});
  const centerInput = textInput('', () => {});
  const spanInput = textInput('', () => {});
  const segmentsInput = numberInput(1, () => {}, { min: 1, max: 1000, step: 1 });
  const averagesInput = numberInput(3, () => {}, { min: 1, max: 100, step: 1 });
  const truncatesInput = numberInput(0, () => {}, { min: 0, max: 99, step: 1 });
  const nameInput = textInput('', (event) => apply({ name: event.target.value }));
  const logarithmic = checkbox('Logarithmic sweep', false, (event) =>
    apply({ logarithmic: event.target.checked }));
  const pointsLabel = el('span.muted');
  const progress = el('progress.progress', { max: 100, value: 0 });

  const applyRange = () => {
    const start = parseFrequency(startInput.value);
    const end = parseFrequency(endInput.value);
    if (start < 0 || end < 0) {
      state.setStatus('Could not read that frequency');
      render();
      return;
    }
    apply({ start, end });
  };

  const applyCenterSpan = () => {
    const center = parseFrequency(centerInput.value);
    const span = parseFrequency(spanInput.value);
    if (center < 0 || span < 0) {
      state.setStatus('Could not read that frequency');
      render();
      return;
    }
    apply({
      start: Math.max(1, Math.round(center - span / 2)),
      end: Math.round(center + span / 2),
    });
  };

  startInput.addEventListener('change', applyRange);
  endInput.addEventListener('change', applyRange);
  centerInput.addEventListener('change', applyCenterSpan);
  spanInput.addEventListener('change', applyCenterSpan);
  segmentsInput.addEventListener('change', () =>
    apply({ segments: Number(segmentsInput.value) }));
  averagesInput.addEventListener('change', () =>
    apply({ averages: Number(averagesInput.value) }));
  truncatesInput.addEventListener('change', () =>
    apply({ truncates: Number(truncatesInput.value) }));

  // the settings are built once and handed to the menu on every open, so
  // a half typed frequency is not thrown away by closing it
  const settings = [
    menuHeading('Range'),
    el('div.grid2', {},
      field('Start', startInput),
      field('Stop', endInput),
      field('Center', centerInput),
      field('Span', spanInput)),
    menuHeading('Points'),
    el('div.grid2', {},
      field('Segments', segmentsInput),
      field('Points', pointsLabel)),
    logarithmic,
    menuHeading('Averaging'),
    el('div.grid2', {},
      field('Averages', averagesInput),
      field('Drop extrema', truncatesInput)),
    field('Sweep name', nameInput),
  ];

  const menu = menuButton({
    label: 'Sweep',
    title: 'Sweep settings',
    render: () => settings,
  });

  const startButton = button(
    'Sweep',
    guard(state, () => state.startSweep(SweepMode.SINGLE)),
    { variant: 'primary' },
  );
  const continuousButton = button(
    'Continuous',
    guard(state, () => state.startSweep(SweepMode.CONTINOUS)),
  );
  const averageButton = button(
    'Averaged',
    guard(state, () => state.startSweep(SweepMode.AVERAGE)),
  );
  const stopButton = button('Stop', () => state.stopSweep());

  const node = el(
    'div.sweep-controls',
    {},
    menu.node,
    startButton,
    continuousButton,
    averageButton,
    stopButton,
    progress,
  );

  function render() {
    const { sweep } = state;
    startInput.value = formatFrequencySweep(sweep.start);
    endInput.value = formatFrequencySweep(sweep.end);
    centerInput.value = formatFrequencySweep(Math.round((sweep.start + sweep.end) / 2));
    spanInput.value = formatFrequencySweep(sweep.span);
    segmentsInput.value = sweep.segments;
    averagesInput.value = sweep.properties.averages[0];
    truncatesInput.value = sweep.properties.averages[1];
    nameInput.value = sweep.properties.name;
    logarithmic.querySelector('input').checked = sweep.properties.logarithmic;
    pointsLabel.textContent = `${sweep.points} x ${sweep.segments} = ${sweep.totalPoints}`;
  }

  state.on('sweep', render);
  state.on('sweepState', ({ running, percentage }) => {
    progress.value = percentage;
    progress.classList.toggle('running', running);
    startButton.disabled = running || !state.connected;
    continuousButton.disabled = running || !state.connected;
    averageButton.disabled = running || !state.connected;
    stopButton.disabled = !running;
  });
  state.on('device', () => {
    const connected = state.connected;
    startButton.disabled = !connected;
    continuousButton.disabled = !connected;
    averageButton.disabled = !connected;
  });

  render();
  stopButton.disabled = true;
  startButton.disabled = true;
  continuousButton.disabled = true;
  averageButton.disabled = true;
  return node;
}
