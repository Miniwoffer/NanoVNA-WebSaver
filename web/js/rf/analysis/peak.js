/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  Licensed under the GNU General Public License v3 or later; see
 *  <https://www.gnu.org/licenses/>.
 */

// The most prominent peaks of a trace.

import { PEAK_TYPE_OPTION, Result, SOURCE_OPTION, dataAndFormat } from './context.js';
import { findPeaks, peakProminences } from '../../util/peaks.js';
import { formatFrequencyShort } from '../../util/format.js';

export function peakSearch(ctx, options = {}) {
  const source = options.source ?? (ctx.s21.length ? 'gain' : 'vswr');
  const peakType = options.peakType ?? 'highest';
  let count = Math.max(1, Math.min(Math.round(options.count ?? 1), 10));
  const s11 = ctx.requireS11();
  const { data, fmt, name } = dataAndFormat(ctx, source);

  const inverted = peakType === 'lowest';
  const searchData = inverted ? data.map((v) => -v) : data;
  const { peaks } = findPeaks(searchData, { width: 3, distance: 3, prominence: 1 });

  const result = new Result('Peak search', `${name}, ${peakType} values`);
  result.options = { source, peakType, count };
  if (!peaks.length) {
    result.summary = `No peaks found in ${name}.`;
    return result;
  }

  const { prominences } = peakProminences(searchData, peaks);
  count = Math.min(count, prominences.length);
  result.options.count = count;

  // the most prominent peaks first
  const order = peaks
    .map((_, i) => i)
    .sort((a, b) => prominences[b] - prominences[a])
    .slice(0, count);

  const section = result.section();
  for (const i of order) {
    const pos = peaks[i];
    const value = inverted ? -searchData[pos] : searchData[pos];
    section.add(`Freq: ${formatFrequencyShort(s11[pos].freq)}`, `Value: ${fmt(value)}`);
    result.annotate(pos, s11[pos].freq, fmt(value), 'peak');
  }
  result.markers = order.map((i) => s11[peaks[i]].freq);
  return result;
}

export const peakSearchAnalysis = {
  key: 'peak_search',
  name: 'Peak search',
  description: 'The most prominent peaks of a trace.',
  run: peakSearch,
  options: [
    SOURCE_OPTION,
    PEAK_TYPE_OPTION,
    { key: 'count', label: 'Max number of peaks', kind: 'number',
      default: 1, min: 1, max: 10, step: 1 },
  ],
};
