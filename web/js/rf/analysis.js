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

// A port of the analyses in NanoVNASaver/Analysis. The Qt originals
// write their findings into form layouts; here an analysis returns a
// Result that the UI renders, which also makes them testable.

import {
  CUTOFF_VALS,
  MIN_CUTOFF_DAMPING,
  calculateRolloff,
  centerFromIdx,
  cutOffLeft,
  cutOffRight,
  dipCutOffs,
  maxima,
  minima,
  takeFromIdx,
  zeroCrossings,
} from './analytic.js';
import { findPeaks, peakProminences } from '../util/peaks.js';
import { reflectionCoefficient, cScale } from './rftools.js';
import {
  formatComplexImp,
  formatFrequency,
  formatFrequencyShort,
  formatGain,
  formatResistance,
  formatVSWR,
} from '../util/format.js';

export class AnalysisError extends Error {}

/** What an analysis found. */
export class Result {
  constructor(title, summary = '') {
    this.title = title;
    this.summary = summary;
    this.sections = [];
    /** frequencies the analysis suggests moving markers to */
    this.markers = [];
    /** points the charts should highlight */
    this.annotations = [];
    /** a narrower sweep the analysis proposes, if any */
    this.suggestedSweep = null;
    /** option values the analysis adjusted for itself */
    this.options = {};
  }

  section(title = '') {
    const sect = { title, rows: [] };
    this.sections.push(sect);
    return {
      add(label, value) {
        sect.rows.push({ label, value });
        return this;
      },
    };
  }

  annotate(index, freq, label, kind) {
    this.annotations.push({ index, freq, label, kind });
  }
}

/** The data and marker positions an analysis works on. */
export class Context {
  constructor({ s11 = [], s21 = [], markerLocations = [], refImpedance = 50, sweep = null } = {}) {
    this.s11 = s11;
    this.s21 = s21;
    this.markerLocations = markerLocations;
    this.refImpedance = refImpedance;
    this.sweep = sweep;
  }

  marker(index) {
    const location = this.markerLocations[index];
    return location === undefined || location === null ? -1 : location;
  }

  requireS11() {
    if (!this.s11.length) throw new AnalysisError('No data to analyse.');
    return this.s11;
  }

  requireS21() {
    if (!this.s21.length) throw new AnalysisError('No S21 data to analyse.');
    return this.s21;
  }
}

// ---------------------------------------------------------------- peaks

const DATA_SOURCES = ['vswr', 'resistance', 'reactance', 'gain'];
const MAX_DIPS_SHOWN = 3;

function dataAndFormat(ctx, source) {
  if (!DATA_SOURCES.includes(source)) {
    throw new AnalysisError(`Unknown data source: ${source}`);
  }
  if (source === 'gain') {
    if (!ctx.s21.length) throw new AnalysisError('S21 gain needs a two port sweep.');
    return { data: ctx.s21.map((d) => d.gain), fmt: (v) => formatGain(v), name: 'S21 gain' };
  }
  const s11 = ctx.requireS11();
  if (source === 'resistance') {
    return {
      data: s11.map((d) => d.impedance(ctx.refImpedance).re),
      fmt: (v) => formatResistance(v, true),
      name: 'Resistance',
    };
  }
  if (source === 'reactance') {
    return {
      data: s11.map((d) => d.impedance(ctx.refImpedance).im),
      fmt: (v) => formatResistance(v, true),
      name: 'Reactance',
    };
  }
  return { data: s11.map((d) => d.vswr), fmt: (v) => formatVSWR(v), name: 'VSWR' };
}

function simplePeakSearch(ctx, options = {}) {
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

function peakSearch(ctx, options = {}) {
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

function vswrAnalysis(ctx, options = {}) {
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

// magnetic loop antennas are tuned by repeatedly zooming in on the dip
export const MAGLOOP_VSWR_BANDWIDTH = 2.56; // -3 dB ?!?
const MAGLOOP_BANDWIDTH = 25000; // 25 kHz

function maglooopAnalysis(ctx, options = {}) {
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

// ------------------------------------------------------------ resonance

/** An end fed half wave resonates where the feed impedance is high. */
const EFHW_IMPEDANCE_THRESHOLD = 500;

export function vswrTransformed(z, ratio = 49) {
  const refl = reflectionCoefficient(cScale(z, 1 / ratio), 50);
  const mag = Math.hypot(refl.re, refl.im);
  return mag === 1 ? 1 : (1 + mag) / (1 - mag);
}

function pointData(s11, index, refImpedance) {
  const dp = s11[index];
  const impedance = dp.impedance(refImpedance);
  return {
    index,
    freq: dp.freq,
    lambda: dp.wavelength,
    impedance,
    vswr: dp.vswr,
    vswr49: vswrTransformed(impedance, 49),
    vswr4: vswrTransformed(impedance, 4),
    r: impedance.re,
    x: impedance.im,
  };
}

function resonanceAnalysis(ctx) {
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

function efhwAnalysis(ctx) {
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

// -------------------------------------------------------------- filters

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

function edgeFilter(ctx, side, title) {
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

function bandFilter(ctx, kind, title) {
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

// ------------------------------------------------------------- registry

const SOURCE_OPTION = {
  key: 'source',
  label: 'Data source',
  kind: 'choice',
  default: 'vswr',
  choices: [
    ['vswr', 'VSWR'],
    ['resistance', 'Resistance'],
    ['reactance', 'Reactance'],
    ['gain', 'S21 gain'],
  ],
};

const PEAK_TYPE_OPTION = {
  key: 'peakType',
  label: 'Peak type',
  kind: 'choice',
  default: 'highest',
  choices: [
    ['highest', 'Highest value'],
    ['lowest', 'Lowest value'],
  ],
};

export const ANALYSES = [
  {
    key: 'simple_peak_search',
    name: 'Simple peak search',
    description: 'The single highest or lowest point of a trace.',
    run: simplePeakSearch,
    options: [SOURCE_OPTION, PEAK_TYPE_OPTION],
  },
  {
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
  },
  {
    key: 'vswr',
    name: 'VSWR analysis',
    description: 'Frequency ranges where VSWR stays below a limit.',
    run: vswrAnalysis,
    options: [
      { key: 'vswrLimit', label: 'VSWR limit', kind: 'number',
        default: 1.5, min: 1, max: 25, step: 0.1 },
    ],
  },
  {
    key: 'resonance',
    name: 'Resonance analysis',
    description: 'Frequencies where the S11 phase crosses zero.',
    run: resonanceAnalysis,
    options: [],
  },
  {
    key: 'efhw',
    name: 'EFHW analysis',
    description: 'Resonances of an end fed half wave antenna.',
    run: efhwAnalysis,
    options: [],
  },
  {
    key: 'magloop',
    name: 'Magnetic loop tuning',
    description: 'Finds the VSWR dip and proposes a narrower sweep around it.',
    run: maglooopAnalysis,
    options: [
      { key: 'vswrLimit', label: 'VSWR limit', kind: 'number',
        default: MAGLOOP_VSWR_BANDWIDTH, min: 1, max: 25, step: 0.1 },
    ],
  },
  {
    key: 'highpass',
    name: 'Highpass filter',
    description: 'Cutoff and roll-off of a high pass filter.',
    run: (ctx) => edgeFilter(ctx, 'left', 'Highpass filter analysis'),
    options: [],
    needsS21: true,
    needsMarker: true,
  },
  {
    key: 'lowpass',
    name: 'Lowpass filter',
    description: 'Cutoff and roll-off of a low pass filter.',
    run: (ctx) => edgeFilter(ctx, 'right', 'Lowpass filter analysis'),
    options: [],
    needsS21: true,
    needsMarker: true,
  },
  {
    key: 'bandpass',
    name: 'Band pass filter',
    description: 'Center, bandwidth, Q and roll-off of a band pass filter.',
    run: (ctx) => bandFilter(ctx, 'bandpass', 'Band pass filter analysis'),
    options: [],
    needsS21: true,
    needsMarker: true,
  },
  {
    key: 'bandstop',
    name: 'Band stop filter',
    description: 'Center, bandwidth, Q and roll-off of a band stop filter.',
    run: (ctx) => bandFilter(ctx, 'bandstop', 'Band stop filter analysis'),
    options: [],
    needsS21: true,
  },
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
