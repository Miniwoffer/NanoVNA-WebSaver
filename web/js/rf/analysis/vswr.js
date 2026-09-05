/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  Licensed under the GNU General Public License v3 or later; see
 *  <https://www.gnu.org/licenses/>.
 */

// Frequency ranges where VSWR stays below a limit.

import { AnalysisError, Result } from './context.js';
import { minima, takeFromIdx } from '../analytic.js';
import { formatFrequency, formatFrequencyShort, formatVSWR } from '../../util/format.js';

const MAX_DIPS_SHOWN = 3;

export function vswrAnalysis(ctx, options = {}) {
  const threshold = Number(options.vswrLimit ?? 1.5);
  if (!(threshold >= 1 && threshold <= 25)) {
    throw new AnalysisError('The VSWR limit must be between 1 and 25.');
  }
  const s11 = ctx.requireS11();
  const data = s11.map((d) => d.vswr);

  const dips = minima(data, threshold)
    .sort((a, b) => data[a] - data[b])
    .slice(0, MAX_DIPS_SHOWN);

  const result = new Result('VSWR analysis');
  result.options = { vswrLimit: threshold };
  if (!dips.length) {
    result.summary = `No areas found with VSWR below ${formatVSWR(threshold)}.`;
    return result;
  }

  result.summary = `${dips.length} area(s) with VSWR below ${formatVSWR(threshold)}.`;
  for (const idx of dips) {
    const rng = takeFromIdx(data, idx, (_, value) => value < threshold);
    const begin = rng[0];
    const end = rng[rng.length - 1];
    result
      .section(`Dip at ${formatFrequencyShort(s11[idx].freq)}`)
      .add('Start', formatFrequency(s11[begin].freq))
      .add(
        'Minimum',
        `${formatFrequency(s11[idx].freq)} (${Math.round(s11[idx].vswr * 100) / 100})`,
      )
      .add('End', formatFrequency(s11[end].freq))
      .add('Span', formatFrequency(s11[end].freq - s11[begin].freq));
    result.annotate(idx, s11[idx].freq, formatVSWR(s11[idx].vswr), 'dip');
  }
  result.markers = dips.map((idx) => s11[idx].freq);
  return result;
}

export const vswrAnalysisEntry = {
  key: 'vswr',
  name: 'VSWR analysis',
  description: 'Frequency ranges where VSWR stays below a limit.',
  run: vswrAnalysis,
  options: [
    { key: 'vswrLimit', label: 'VSWR limit', kind: 'number',
      default: 1.5, min: 1, max: 25, step: 0.1 },
  ],
};
