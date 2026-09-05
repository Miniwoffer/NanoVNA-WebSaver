/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  Licensed under the GNU General Public License v3 or later; see
 *  <https://www.gnu.org/licenses/>.
 */

// Resonances of an end fed half wave antenna, which resonates where the
// feed impedance is high as well as where the phase crosses zero.

import { Result, pointData } from './context.js';
import { maxima, zeroCrossings } from '../analytic.js';
import {
  formatComplexImp,
  formatFrequencyShort,
  formatResistance,
} from '../../util/format.js';

const EFHW_IMPEDANCE_THRESHOLD = 500;

export function efhwAnalysis(ctx) {
  const s11 = ctx.requireS11();
  const crossings = [...new Set(zeroCrossings(s11.map((d) => d.phase)))].sort((a, b) => a - b);
  const peaks = maxima(
    s11.map((d) => d.impedance(ctx.refImpedance).re),
    EFHW_IMPEDANCE_THRESHOLD,
  ).sort((a, b) => a - b);

  const indices = [...new Set([...crossings, ...peaks])].sort((a, b) => a - b);

  const result = new Result('EFHW analysis');
  if (!indices.length) {
    result.summary = 'No resonance found';
    return result;
  }

  result.summary =
    `${crossings.length} phase crossing(s), ${peaks.length} high impedance peak(s).`;
  const section = result.section();
  for (const idx of indices) {
    const data = pointData(s11, idx, ctx.refImpedance);
    section.add(
      formatFrequencyShort(data.freq),
      `${formatComplexImp(data.impedance, true)}` +
        `  R=${formatResistance(data.r, true)}` +
        `  ${Math.round(data.lambda * 100) / 100} m`,
    );
    result.annotate(
      idx,
      data.freq,
      formatResistance(data.r, true),
      crossings.includes(idx) ? 'resonance' : 'peak',
    );
  }
  result.markers = indices.map((idx) => s11[idx].freq);
  return result;
}

export const efhwAnalysisEntry = {
  key: 'efhw',
  name: 'EFHW analysis',
  description: 'Resonances of an end fed half wave antenna.',
  run: efhwAnalysis,
  options: [],
};
