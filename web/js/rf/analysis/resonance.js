/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  Licensed under the GNU General Public License v3 or later; see
 *  <https://www.gnu.org/licenses/>.
 */

// Frequencies where the S11 phase crosses zero.

import { Result, pointData } from './context.js';
import { zeroCrossings } from '../analytic.js';
import {
  formatComplexImp,
  formatFrequency,
  formatFrequencyShort,
} from '../../util/format.js';

export function resonanceAnalysis(ctx) {
  const s11 = ctx.requireS11();
  const crossings = [...new Set(zeroCrossings(s11.map((d) => d.phase)))].sort((a, b) => a - b);

  const result = new Result('Resonance analysis');
  if (!crossings.length) {
    result.summary = 'No resonance found';
    return result;
  }

  result.summary = `${crossings.length} resonance(s) found.`;
  const section = result.section();
  for (const crossing of crossings) {
    const data = pointData(s11, crossing, ctx.refImpedance);
    section.add(
      'Resonance',
      `${formatFrequency(data.freq)}  ${formatComplexImp(data.impedance, true)}`,
    );
    result.annotate(crossing, data.freq, formatFrequencyShort(data.freq), 'resonance');
  }
  result.markers = crossings.map((c) => s11[c].freq);
  return result;
}

export const resonanceAnalysisEntry = {
  key: 'resonance',
  name: 'Resonance analysis',
  description: 'Frequencies where the S11 phase crosses zero.',
  run: resonanceAnalysis,
  options: [],
};
