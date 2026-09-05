/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  Licensed under the GNU General Public License v3 or later; see
 *  <https://www.gnu.org/licenses/>.
 */

// Magnetic loop antennas are tuned by repeatedly zooming in on the dip,
// so this analysis proposes the next, narrower sweep as it goes.

import { Result } from './context.js';
import { minima, takeFromIdx } from '../analytic.js';
import { formatFrequency, formatVSWR } from '../../util/format.js';

export const MAGLOOP_VSWR_BANDWIDTH = 2.56; // -3 dB ?!?
const MAGLOOP_BANDWIDTH = 25000; // 25 kHz

export function maglooopAnalysis(ctx, options = {}) {
  const threshold = Number(options.vswrLimit ?? MAGLOOP_VSWR_BANDWIDTH);
  const s11 = ctx.requireS11();
  const data = s11.map((d) => d.vswr);
  const sweepStart = ctx.sweep ? ctx.sweep.start : s11[0].freq;
  const sweepEnd = ctx.sweep ? ctx.sweep.end : s11[s11.length - 1].freq;

  const dips = minima(data, threshold).sort((a, b) => data[a] - data[b]);
  const result = new Result('Magnetic loop tuning');
  result.options = { vswrLimit: threshold };

  if (dips.length > 1) {
    result.summary =
      'Multiple minima found: this is not a magnetic loop, or the VSWR limit is too high.';
    result.markers = dips.slice(0, 3).map((idx) => s11[idx].freq);
    return result;
  }

  if (!dips.length) {
    // widen the search and relax the limit, as the desktop version does
    if (threshold < 10) result.options.vswrLimit = threshold + 2;
    result.summary =
      `No minimum below ${formatVSWR(threshold)}.` +
      ' Widen the sweep or raise the VSWR limit.';
    result.suggestedSweep = {
      start: Math.max(1, sweepStart - 5 * MAGLOOP_BANDWIDTH),
      end: sweepEnd + 5 * MAGLOOP_BANDWIDTH,
    };
    return result;
  }

  const idx = dips[0];
  const rng = takeFromIdx(data, idx, (_, value) => value < threshold);
  const begin = rng[0];
  const end = rng[rng.length - 1];
  const section = result
    .section()
    .add('Minimum', formatFrequency(s11[idx].freq))
    .add('VSWR', formatVSWR(s11[idx].vswr));

  const span = s11[end].freq - s11[begin].freq;
  let newStart;
  let newEnd;
  if (span > 0) {
    section.add('Bandwidth', formatFrequency(span));
    section.add('Q', `${Math.trunc(s11[idx].freq / span)}`);
    newStart = s11[begin].freq - MAGLOOP_BANDWIDTH;
    newEnd = s11[end].freq + MAGLOOP_BANDWIDTH;
  } else {
    // a single point dip: zoom in further to resolve it
    newStart = s11[idx].freq - 2 * MAGLOOP_BANDWIDTH;
    newEnd = s11[idx].freq + 2 * MAGLOOP_BANDWIDTH;
  }

  if (threshold > MAGLOOP_VSWR_BANDWIDTH) {
    result.options.vswrLimit = Math.max(MAGLOOP_VSWR_BANDWIDTH, threshold - 1);
  }

  result.summary = `Tuned to ${formatFrequency(s11[idx].freq)}.`;
  result.markers = [s11[idx].freq];
  result.annotate(idx, s11[idx].freq, formatVSWR(s11[idx].vswr), 'dip');
  result.suggestedSweep = {
    start: Math.max(1, Math.round(newStart)),
    end: Math.round(newEnd),
  };
  return result;
}

export const maglooopAnalysisEntry = {
  key: 'magloop',
  name: 'Magnetic loop tuning',
  description: 'Finds the VSWR dip and proposes a narrower sweep around it.',
  run: maglooopAnalysis,
  options: [
    { key: 'vswrLimit', label: 'VSWR limit', kind: 'number',
      default: MAGLOOP_VSWR_BANDWIDTH, min: 1, max: 25, step: 0.1 },
  ],
};
