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

// Recording a run of sweeps, and playing it back over the charts.
//
// The controls are a topbar menu; the scrubber appears along the bottom
// only once there is something to scrub, so it costs nothing while
// nobody is using it.

import { button, downloadText, el, pickFile, readFileAsText, select } from './dom.js';
import { menuButton, menuHeading, menuRow } from './menu.js';
import { Recorder, decodeRecording, encodeRecording } from '../app/recorder.js';

const SPEEDS = [
  ['1', 'Real time'],
  ['2', '2x'],
  ['5', '5x'],
  ['10', '10x'],
  ['0', 'As fast as possible'],
];

/** Seconds and tenths, which is the resolution a sweep run deserves. */
function formatTime(ms) {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${(seconds - minutes * 60).toFixed(0)}s`;
}

export function recordingControls(state) {
  const recorder = new Recorder();
  state.recorder = recorder;

  let playing = false;
  let speed = 1;
  let timer = null;
  /** true while a replayed frame is being pushed into the application */
  let replaying = false;

  // ---------------------------------------------------------- the bar

  const positionInput = el('input.replay-scrub', {
    type: 'range', min: 0, max: 0, step: 1, value: 0,
    on: {
      input: (event) => {
        pause();
        show(Number(event.target.value));
      },
    },
  });
  const playButton = el('button.btn', { type: 'button', textContent: '▶', title: 'Play' });
  const stepBack = el('button.btn', { type: 'button', textContent: '◀◀', title: 'Previous sweep' });
  const stepOn = el('button.btn', { type: 'button', textContent: '▶▶', title: 'Next sweep' });
  const readout = el('span.replay-readout');
  const speedSelect = select(SPEEDS, '1', (event) => {
    speed = Number(event.target.value);
    if (playing) {
      pause();
      play();
    }
  }, { title: 'Playback speed' });

  const bar = el(
    'div.replay-bar',
    { hidden: true },
    el('span.replay-label', {}, 'Replay'),
    stepBack,
    playButton,
    stepOn,
    positionInput,
    readout,
    speedSelect,
    button('Close', () => {
      recorder.clear();
      pause();
      renderBar();
    }, { title: 'Discard this recording' }),
  );

  // ------------------------------------------------------- transport

  /** Push one recorded frame into the application. */
  function show(index) {
    const frame = recorder.frame(index);
    if (!frame) return;
    recorder.position = index;
    replaying = true;
    try {
      state.setData(frame.s11, frame.s21);
    } finally {
      replaying = false;
    }
    renderBar();
  }

  function play() {
    if (playing || recorder.length < 2) return;
    if (recorder.position >= recorder.length - 1) recorder.position = 0;
    playing = true;
    playButton.textContent = '❚❚';
    playButton.title = 'Pause';
    step();
  }

  function step() {
    if (!playing) return;
    const next = recorder.position + 1;
    if (next >= recorder.length) {
      pause();
      return;
    }
    const gap = speed === 0
      ? 0
      : Math.max(0, recorder.frame(next).t - recorder.frame(recorder.position).t) / speed;
    timer = setTimeout(() => {
      show(next);
      step();
    }, Math.min(gap, 10000));
  }

  function pause() {
    playing = false;
    clearTimeout(timer);
    timer = null;
    playButton.textContent = '▶';
    playButton.title = 'Play';
  }

  playButton.addEventListener('click', () => (playing ? pause() : play()));
  stepBack.addEventListener('click', () => {
    pause();
    show(Math.max(0, recorder.position - 1));
  });
  stepOn.addEventListener('click', () => {
    pause();
    show(Math.min(recorder.length - 1, recorder.position + 1));
  });

  function renderBar() {
    const has = recorder.length > 0 && !recorder.recording;
    bar.hidden = !has;
    if (!has) return;
    positionInput.max = String(Math.max(0, recorder.length - 1));
    positionInput.value = String(Math.max(0, recorder.position));
    const at = recorder.frame(recorder.position);
    readout.textContent =
      `${recorder.position + 1} / ${recorder.length}` +
      `  ·  ${formatTime(at ? at.t : 0)} of ${formatTime(recorder.duration)}`;
  }

  // ------------------------------------------------------------ menu

  function menuBody() {
    const rows = [menuHeading('Recording')];

    if (recorder.recording) {
      rows.push(
        el('p.muted', {}, `Recording: ${recorder.length} sweep(s) so far.`),
        menuRow(
          button('Stop recording', () => {
            recorder.stop();
            recorder.position = 0;
            if (recorder.length) show(0);
            renderBar();
            control.menu.refresh();
            state.setStatus(`Recorded ${recorder.length} sweeps`);
          }, { variant: 'danger' }),
        ),
      );
    } else {
      rows.push(
        el(
          'p.muted',
          {},
          'Every completed sweep is kept with the time it was taken, so a ' +
            'run can be played back afterwards.',
        ),
        menuRow(
          button('Start recording', () => {
            recorder.start({ device: state.device?.name ?? '', sweep: state.sweep });
            renderBar();
            control.menu.refresh();
            state.setStatus('Recording sweeps');
          }, { variant: 'primary' }),
        ),
      );
    }

    if (recorder.length && !recorder.recording) {
      rows.push(
        el('p.muted', {}, `${recorder.length} sweeps over ${formatTime(recorder.duration)}.`),
      );
    }

    rows.push(menuHeading('File'));
    rows.push(
      menuRow(
        button('Export…', () => {
          if (!recorder.length) {
            state.setStatus('There is nothing recorded to export');
            return;
          }
          downloadText('recording.json', encodeRecording(recorder), 'application/json');
          control.menu.close();
        }, { disabled: !recorder.length }),
        button('Import…', async () => {
          try {
            const file = await pickFile('.json,application/json');
            if (!file) return;
            recorder.load(decodeRecording(await readFileAsText(file)));
            pause();
            show(0);
            renderBar();
            control.menu.close();
            state.setStatus(`Loaded ${recorder.length} recorded sweeps`);
          } catch (error) {
            state.setStatus(error.message);
            state.emit('error', error.message);
          }
        }),
      ),
    );
    return rows;
  }

  const control = menuButton({
    label: 'Recording',
    title: 'Record and replay a run of sweeps',
    render: menuBody,
  });

  // a frame is one complete pass over every segment, which is why this
  // listens for sweepPass rather than for data
  state.on('sweepPass', (data) => {
    if (replaying || !recorder.recording) return;
    recorder.capture(data);
    control.menu.refresh();
  });

  renderBar();
  return { node: control.node, bar };
}
