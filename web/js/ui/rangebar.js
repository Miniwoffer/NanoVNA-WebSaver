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

// The frequency range bar along the bottom of the window: the device's
// whole tuning range as a track, with the current sweep as a segment on
// it. Drag the segment to move the sweep, drag either end to change the
// start or the stop, or use the wheel to widen and narrow the span.
//
// The track is logarithmic. A NanoVNA-H4 tunes from 10 kHz to 1.5 GHz --
// five decades -- and on a linear track everything below about 100 MHz
// would be crammed into the leftmost few percent, which is precisely
// where most amateur work happens.

import { el } from './dom.js';
import { formatFrequency, formatFrequencyShort } from '../util/format.js';

/** What to span when no device has said what it can do. */
const FALLBACK_MIN_HZ = 10e3;
const FALLBACK_MAX_HZ = 1.5e9;

/** Narrowest sweep the bar will let you drag to. */
const MIN_SPAN_HZ = 100;

/** How much one wheel notch changes the span, as a ratio. */
const WHEEL_STEP = 1.2;

/** Frequency limits of the attached device, or a sensible stand-in. */
export function deviceLimits(device) {
  const min = Number(device?.sweepMinFreqHz) || FALLBACK_MIN_HZ;
  const max = Number(device?.sweepMaxFreqHz) || FALLBACK_MAX_HZ;
  return max > min ? { min, max } : { min: FALLBACK_MIN_HZ, max: FALLBACK_MAX_HZ };
}

/** Where a frequency sits on the logarithmic track, as 0..1. */
export function toFraction(freq, { min, max }) {
  const clamped = Math.min(max, Math.max(min, freq));
  return (Math.log10(clamped) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
}

/** The frequency at a point on the track, rounded to whole hertz. */
export function fromFraction(fraction, { min, max }) {
  const t = Math.min(1, Math.max(0, fraction));
  return Math.round(10 ** (Math.log10(min) + t * (Math.log10(max) - Math.log10(min))));
}

/** The decade marks to label, within the given limits. */
export function decadeTicks({ min, max }) {
  const ticks = [];
  const first = Math.ceil(Math.log10(min));
  const last = Math.floor(Math.log10(max));
  for (let exp = first; exp <= last; exp += 1) ticks.push(10 ** exp);
  return ticks;
}

/**
 * Keep a range inside the device's limits without changing its width.
 *
 * Sliding it back in is what a user dragging past the end expects; the
 * width is only given up when the range is wider than the device is.
 */
export function clampRange(start, end, { min, max }) {
  let width = Math.max(MIN_SPAN_HZ, end - start);
  if (width > max - min) width = max - min;
  let low = Math.round(start);
  if (low < min) low = min;
  if (low + width > max) low = max - width;
  return { start: Math.round(low), end: Math.round(low + width) };
}

export function rangeBar(state) {
  const span = el('div.range-span', { title: 'Drag to move the sweep, or the ends to resize it' });
  const track = el(
    'div.range-track',
    {},
    el('div.range-handle.range-start', { title: 'Drag to set the start frequency' }),
    el('div.range-handle.range-stop', { title: 'Drag to set the stop frequency' }),
  );
  // the handles belong to the span, visually and for hit testing
  span.append(...track.children);
  track.append(span);

  const ticks = el('div.range-ticks');
  const readout = el('span.range-readout');
  const node = el(
    'footer.range-bar',
    {},
    el('div.range-lane', {}, track, ticks),
    readout,
  );

  const limits = () => deviceLimits(state.device);

  /** The range being dragged, or null when settled on what state says. */
  let pending = null;
  const current = () =>
    pending ?? { start: state.sweep.start, end: state.sweep.end };

  function renderTicks() {
    const bounds = limits();
    ticks.replaceChildren(
      ...decadeTicks(bounds).map((freq) => {
        const at = toFraction(freq, bounds);
        // a label centred on the very first or last tick would hang off
        // the end of the bar and be cut in half
        const transform = at < 0.02 ? 'none' : at > 0.98 ? 'translateX(-100%)' : 'translateX(-50%)';
        return el(
          'span.range-tick',
          { style: { left: `${at * 100}%`, transform } },
          formatFrequencyShort(freq),
        );
      }),
    );
  }

  function render() {
    const bounds = limits();
    const { start, end } = current();
    const left = toFraction(start, bounds);
    const right = toFraction(end, bounds);
    span.style.left = `${left * 100}%`;
    span.style.width = `${Math.max(0.6, (right - left) * 100)}%`;
    readout.textContent = `${formatFrequency(start)} – ${formatFrequency(end)}`;
  }

  /** Push a dragged or scrolled range into the sweep. */
  function commit(range) {
    pending = null;
    try {
      state.updateSweep({ start: range.start, end: range.end });
    } catch (error) {
      state.setStatus(error.message);
      render();
    }
  }

  // ------------------------------------------------------------- drags

  let drag = null;

  const positionOf = (event) => {
    const rect = track.getBoundingClientRect();
    return (event.clientX - rect.left) / Math.max(1, rect.width);
  };

  const onMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const bounds = limits();
    const at = positionOf(event);

    if (drag.kind === 'start') {
      const start = Math.min(fromFraction(at, bounds), drag.end - MIN_SPAN_HZ);
      pending = { start: Math.max(bounds.min, start), end: drag.end };
    } else if (drag.kind === 'stop') {
      const end = Math.max(fromFraction(at, bounds), drag.start + MIN_SPAN_HZ);
      pending = { start: drag.start, end: Math.min(bounds.max, end) };
    } else {
      // pan: hold the pixel width, which on a log track means holding the
      // ratio between stop and start
      const offset = at - drag.grabbedAt;
      const startFraction = toFraction(drag.start, bounds) + offset;
      const width = toFraction(drag.end, bounds) - toFraction(drag.start, bounds);
      pending = clampRange(
        fromFraction(startFraction, bounds),
        fromFraction(startFraction + width, bounds),
        bounds,
      );
    }
    render();
  };

  const finish = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const range = pending;
    drag = null;
    node.classList.remove('dragging');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    if (range) commit(range);
  };

  const startDrag = (event, kind) => {
    if (event.button !== 0 || drag) return;
    const bounds = limits();
    let { start, end } = current();

    // a press on bare track jumps the sweep there, then pans from it
    if (kind === 'pan' && !span.contains(event.target)) {
      const width = toFraction(end, bounds) - toFraction(start, bounds);
      const at = positionOf(event);
      const range = clampRange(
        fromFraction(at - width / 2, bounds),
        fromFraction(at + width / 2, bounds),
        bounds,
      );
      ({ start, end } = range);
      pending = range;
      render();
    }

    // the grab point is remembered so a pan tracks the pointer exactly,
    // rather than snapping the range's edge to it
    drag = { kind, pointerId: event.pointerId, start, end, grabbedAt: positionOf(event) };
    node.classList.add('dragging');
    // as with the panel drags, the pointer leaves these small targets at
    // once, so the window owns the rest of the gesture
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    event.preventDefault();
    event.stopPropagation();
  };

  span.addEventListener('pointerdown', (event) => {
    if (event.target.classList.contains('range-handle')) return;
    startDrag(event, 'pan');
  });
  track.addEventListener('pointerdown', (event) => {
    if (span.contains(event.target)) return;
    startDrag(event, 'pan');
  });
  span.querySelector('.range-start').addEventListener('pointerdown', (e) => startDrag(e, 'start'));
  span.querySelector('.range-stop').addEventListener('pointerdown', (e) => startDrag(e, 'stop'));

  // ------------------------------------------------------------- wheel

  let wheelTimer = null;
  track.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const bounds = limits();
      const { start, end } = current();
      // scale the span about its geometric centre, which on a log axis is
      // the point that stays put visually
      const factor = event.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      const centre = Math.sqrt(start * end);
      const half = Math.sqrt(end / start) ** factor;
      pending = clampRange(
        Math.max(bounds.min, Math.round(centre / half)),
        Math.min(bounds.max, Math.round(centre * half)),
        bounds,
      );
      render();
      // one commit for a flurry of notches, rather than one per notch
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => commit(pending), 150);
    },
    { passive: false },
  );

  state.on('sweep', () => {
    if (!drag) render();
  });
  state.on('device', () => {
    renderTicks();
    render();
  });

  renderTicks();
  render();
  return node;
}
