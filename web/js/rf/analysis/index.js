/*
 *  NanoVNA-WebSaver
 *
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

// A port of the analyses in NanoVNASaver/Analysis. The Qt originals write
// their findings into form layouts; here an analysis returns a Result that
// the UI renders, which also makes them testable.
//
// One analysis per module; this file is only the catalogue. The order
// below is the order they appear in the analysis picker.

import { simplePeakSearchAnalysis } from './simplepeak.js';
import { peakSearchAnalysis } from './peak.js';
import { vswrAnalysisEntry } from './vswr.js';
import { resonanceAnalysisEntry } from './resonance.js';
import { efhwAnalysisEntry } from './efhw.js';
import { maglooopAnalysisEntry } from './magloop.js';
import { highpassAnalysis } from './highpass.js';
import { lowpassAnalysis } from './lowpass.js';
import { bandpassAnalysis } from './bandpass.js';
import { bandstopAnalysis } from './bandstop.js';
import { AnalysisError } from './context.js';

export { AnalysisError, Context, Result, vswrTransformed } from './context.js';
export { MAGLOOP_VSWR_BANDWIDTH } from './magloop.js';

export const ANALYSES = [
  simplePeakSearchAnalysis,
  peakSearchAnalysis,
  vswrAnalysisEntry,
  resonanceAnalysisEntry,
  efhwAnalysisEntry,
  maglooopAnalysisEntry,
  highpassAnalysis,
  lowpassAnalysis,
  bandpassAnalysis,
  bandstopAnalysis,
];

const BY_KEY = new Map(ANALYSES.map((a) => [a.key, a]));

export function getAnalysis(key) {
  const analysis = BY_KEY.get(key);
  if (!analysis) throw new AnalysisError(`Unknown analysis: ${key}`);
  return analysis;
}

export function runAnalysis(key, ctx, options = {}) {
  return getAnalysis(key).run(ctx, options);
}
