/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  Licensed under the GNU General Public License v3 or later; see
 *  <https://www.gnu.org/licenses/>.
 */

// The single highest or lowest point of a trace.

import { PEAK_TYPE_OPTION, Result, SOURCE_OPTION, dataAndFormat } from './context.js';
import { formatFrequency } from '../../util/format.js';

export function simplePeakSearch(ctx, options = {}) {
  const source = options.source ?? (ctx.s21.length ? 'gain' : 'vswr');
  const peakType = options.peakType ?? 'highest';
  const s11 = ctx.requireS11();
  const { data, fmt, name } = dataAndFormat(ctx, source);

  let idxPeak = 0;
  for (let i = 1; i < data.length; i += 1) {
    if (peakType === 'lowest' ? data[i] < data[idxPeak] : data[i] > data[idxPeak]) {
      idxPeak = i;
    }
  }

  const result = new Result('Simple peak search', `${name}, ${peakType} value`);
  result.options = { source, peakType };
  result
    .section()
    .add('Peak frequency', formatFrequency(s11[idxPeak].freq))
    .add('Peak value', fmt(data[idxPeak]));
  result.markers = [s11[idxPeak].freq];
  result.annotate(idxPeak, s11[idxPeak].freq, 'Peak', 'peak');
  return result;
}

export const simplePeakSearchAnalysis = {
  key: 'simple_peak_search',
  name: 'Simple peak search',
  description: 'The single highest or lowest point of a trace.',
  run: simplePeakSearch,
  options: [SOURCE_OPTION, PEAK_TYPE_OPTION],
};
