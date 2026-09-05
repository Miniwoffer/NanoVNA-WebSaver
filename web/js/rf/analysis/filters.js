/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  Licensed under the GNU General Public License v3 or later; see
 *  <https://www.gnu.org/licenses/>.
 */

// What the four filter analyses share. Each of them -- highpass.js,
// lowpass.js, bandpass.js, bandstop.js -- is a thin file over one of
// these two functions.

import { AnalysisError, Result } from './context.js';
import {
  CUTOFF_VALS,
  MIN_CUTOFF_DAMPING,
  calculateRolloff,
  centerFromIdx,
  cutOffLeft,
  cutOffRight,
  dipCutOffs,
} from '../analytic.js';
import { formatFrequency } from '../../util/format.js';

const formatFreqOrDash = (value) => (Number.isNaN(value) ? '-' : formatFrequency(value));

const formatRolloff = (value, per) =>
  Number.isNaN(value) ? '-' : `${value.toFixed(3)}dB/${per}`;

function cutoffTables(s21, gains, cutoffPos) {
  const cutoffFreq = {};
  const cutoffGain = {};
  for (const [key, val] of Object.entries(cutoffPos)) {
    cutoffFreq[key] = val >= 0 ? s21[val].freq : NaN;
    cutoffGain[key] = val >= 0 ? gains[val] : NaN;
  }
  return { cutoffFreq, cutoffGain };
}

function cutoffText(freq, gain) {
  if (Number.isNaN(freq)) return '-';
  const gainText = Number.isNaN(gain) ? '' : ` (${gain.toFixed(1)} dB)`;
  return `${formatFrequency(freq)}${gainText}`;
}

function passbandPeak(ctx, gains) {
  const location = ctx.marker(0);
  if (location < 0) throw new AnalysisError('Please place marker 1 in the filter passband.');
  const peak = centerFromIdx(gains, location);
  if (peak < 0) throw new AnalysisError('Could not find the passband around marker 1.');
  return peak;
}

/** Extrapolate the -60 dB points from the -10/-20 dB roll-off. */
function derive60db(cutoffPos, cutoffFreq) {
  for (const side of ['l', 'r']) {
    if (
      Number.isNaN(cutoffFreq[`60.0dB_${side}`]) &&
      cutoffPos[`20.0dB_${side}`] > 0 &&
      cutoffPos[`10.0dB_${side}`] > 0
    ) {
      cutoffFreq[`60.0dB_${side}`] =
        cutoffFreq[`10.0dB_${side}`] *
        10 **
          (5 *
            (Math.log10(cutoffPos[`20.0dB_${side}`]) -
              Math.log10(cutoffPos[`10.0dB_${side}`])));
    }
  }
}

/** A filter with one skirt: high pass ('left') or low pass ('right'). */
export function edgeFilter(ctx, side, title) {
  const s21 = ctx.requireS21();
  const gains = s21.map((d) => d.gain);
  const peak = passbandPeak(ctx, gains);
  const peakDb = gains[peak];

  const cutOff = side === 'left' ? cutOffLeft : cutOffRight;
  const cutoffPos = {};
  for (const attn of CUTOFF_VALS) {
    cutoffPos[`${attn.toFixed(1)}dB`] = cutOff(gains, peak, peakDb, attn);
  }
  const { cutoffFreq, cutoffGain } = cutoffTables(s21, gains, cutoffPos);

  const [octave, decade] = calculateRolloff(s21, cutoffPos['10.0dB'], cutoffPos['20.0dB']);

  const result = new Result(title, `Analysis complete (${s21.length} points)`);
  result
    .section()
    .add('Cutoff frequency', cutoffText(cutoffFreq['3.0dB'], cutoffGain['3.0dB']))
    .add('-6 dB point', cutoffText(cutoffFreq['6.0dB'], cutoffGain['6.0dB']))
    .add('-60 dB point', cutoffText(cutoffFreq['60.0dB'], cutoffGain['60.0dB']))
    .add('Roll-off', formatRolloff(octave, 'octave'))
    .add('Roll-off', formatRolloff(decade, 'decade'));

  if (!Number.isNaN(cutoffGain['3.0dB']) && cutoffGain['3.0dB'] < MIN_CUTOFF_DAMPING) {
    result.summary =
      `Analysis complete (${s21.length} points).` +
      ' Insufficient data for a true -3 dB point; increase the segment count.';
  }

  result.markers = [s21[peak].freq, cutoffFreq['3.0dB'], cutoffFreq['6.0dB']]
    .filter((f) => !Number.isNaN(f))
    .map((f) => Math.round(f));
  if (cutoffPos['3.0dB'] >= 0) {
    result.annotate(cutoffPos['3.0dB'], s21[cutoffPos['3.0dB']].freq, '-3 dB', 'cutoff');
  }
  return result;
}

/** A filter with two skirts: 'bandpass' or 'bandstop'. */
export function bandFilter(ctx, kind, title) {
  const s21 = ctx.requireS21();
  const gains = s21.map((d) => d.gain);

  let peak;
  const cutoffPos = {};
  if (kind === 'bandpass') {
    const location = ctx.marker(0);
    if (location <= 0 || location >= gains.length - 1) {
      throw new AnalysisError('Please place marker 1 in the passband.');
    }
    peak = centerFromIdx(gains, location);
    if (peak < 0) throw new AnalysisError('Bandpass center not found.');
    const peakDb = gains[peak];
    for (const attn of CUTOFF_VALS) {
      cutoffPos[`${attn.toFixed(1)}dB_l`] = cutOffLeft(gains, peak, peakDb, attn);
      cutoffPos[`${attn.toFixed(1)}dB_r`] = cutOffRight(gains, peak, peakDb, attn);
    }
  } else {
    // band stop: the reference level is the highest gain
    peak = gains.reduce((best, v, i) => (v > gains[best] ? i : best), 0);
    const peakDb = gains[peak];
    for (const attn of CUTOFF_VALS) {
      const [left, right] = dipCutOffs(gains, peakDb, attn);
      cutoffPos[`${attn.toFixed(1)}dB_l`] = left;
      cutoffPos[`${attn.toFixed(1)}dB_r`] = right;
    }
  }

  const { cutoffFreq, cutoffGain } = cutoffTables(s21, gains, cutoffPos);
  derive60db(cutoffPos, cutoffFreq);

  const span3db = cutoffFreq['3.0dB_r'] - cutoffFreq['3.0dB_l'];
  const span6db = cutoffFreq['6.0dB_r'] - cutoffFreq['6.0dB_l'];
  const freqCenter = Math.sqrt(cutoffFreq['3.0dB_l'] * cutoffFreq['3.0dB_r']);
  const qFactor = span3db ? freqCenter / span3db : NaN;

  const [octaveL, decadeL] = calculateRolloff(
    s21, cutoffPos['10.0dB_l'], cutoffPos['20.0dB_l'],
  );
  const [octaveR, decadeR] = calculateRolloff(
    s21, cutoffPos['10.0dB_r'], cutoffPos['20.0dB_r'],
  );

  const result = new Result(title, `Analysis complete (${s21.length} points)`);
  result
    .section()
    .add('Center frequency', formatFreqOrDash(freqCenter))
    .add('Bandwidth (-3 dB)', formatFreqOrDash(span3db))
    .add('Quality factor', Number.isNaN(qFactor) ? '-' : qFactor.toFixed(2))
    .add('Bandwidth (-6 dB)', formatFreqOrDash(span6db));

  for (const [side, label, octave, decade] of [
    ['l', 'Lower side', octaveL, decadeL],
    ['r', 'Upper side', octaveR, decadeR],
  ]) {
    result
      .section(label)
      .add(
        'Cutoff frequency',
        cutoffText(cutoffFreq[`3.0dB_${side}`], cutoffGain[`3.0dB_${side}`]),
      )
      .add('-6 dB point', cutoffText(cutoffFreq[`6.0dB_${side}`], cutoffGain[`6.0dB_${side}`]))
      .add(
        '-60 dB point',
        cutoffText(cutoffFreq[`60.0dB_${side}`], cutoffGain[`60.0dB_${side}`]),
      )
      .add('Roll-off', formatRolloff(octave, 'octave'))
      .add('Roll-off', formatRolloff(decade, 'decade'));
  }

  if (
    cutoffGain['3.0dB_l'] < MIN_CUTOFF_DAMPING ||
    cutoffGain['3.0dB_r'] < MIN_CUTOFF_DAMPING
  ) {
    result.summary =
      `Analysis complete (${s21.length} points).` +
      ' Insufficient data for analysis. Increase the segment count.';
  }

  result.markers = [freqCenter, cutoffFreq['3.0dB_l'], cutoffFreq['3.0dB_r']]
    .filter((f) => !Number.isNaN(f))
    .map((f) => Math.round(f));
  for (const side of ['l', 'r']) {
    const pos = cutoffPos[`3.0dB_${side}`];
    if (pos >= 0) result.annotate(pos, s21[pos].freq, '-3 dB', 'cutoff');
  }
  return result;
}
