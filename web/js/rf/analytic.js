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

// A port of NanoVNASaver/AnalyticTools.py.

import { findPeaks } from '../util/peaks.js';

/** Attenuations, in dB, at which filter cutoff points are reported. */
export const CUTOFF_VALS = [3.0, 6.0, 10.0, 20.0, 60.0];
/** Below this the sweep is too coarse to place a true -3 dB point. */
export const MIN_CUTOFF_DAMPING = -4.0;

/**
 * Sorted indices of the points where the data crosses zero.
 *
 * Exact zeroes count, except at the very first and last sample.
 */
export function zeroCrossings(data) {
  if (!data.length) return [];

  const realZeros = [];
  for (let i = 1; i < data.length - 1; i += 1) {
    if (data[i] === 0.0) realZeros.push(i);
  }

  const crossings = [];
  for (let i = 0; i < data.length - 1; i += 1) {
    if (data[i] * data[i + 1] < 0.0) {
      // report whichever side of the crossing is nearer to zero
      crossings.push(Math.abs(data[i]) < Math.abs(data[i + 1]) ? i : i + 1);
    }
  }
  return [...realZeros, ...crossings].sort((a, b) => a - b);
}

/** Indices of the maxima, optionally only those above a threshold. */
export function maxima(data, threshold = 0.0) {
  const { peaks } = findPeaks(data, { width: 2, distance: 3, prominence: 1 });
  return threshold ? peaks.filter((i) => data[i] > threshold) : peaks;
}

/** Indices of the minima, optionally only those below a threshold. */
export function minima(data, threshold = 0.0) {
  const inverted = data.map((v) => -v);
  const { peaks } = findPeaks(inverted, { width: 2, distance: 3, prominence: 1 });
  return threshold ? peaks.filter((i) => data[i] < threshold) : peaks;
}

/**
 * Indices matching a predicate, taken outwards from a start position.
 *
 * Both directions stop at the first element that fails the predicate.
 *
 * @param {number[]} data
 * @param {number} idx the position to start from
 * @param {(index: number, value: number) => boolean} predicate
 */
export function takeFromIdx(data, idx, predicate) {
  const lower = [];
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (!predicate(i, data[i])) break;
    lower.push(i);
  }
  lower.reverse();

  const upper = [];
  for (let i = idx; i < data.length; i += 1) {
    if (!predicate(i, data[i])) break;
    upper.push(i);
  }
  return [...lower, ...upper];
}

/**
 * Position of the highest gain within `delta` dB of the start position.
 *
 * @returns {number} -1 when there is no data
 */
export function centerFromIdx(gains, idx, delta = 3.0) {
  const peakDb = gains[idx];
  const rng = takeFromIdx(gains, idx, (_, value) => Math.abs(peakDb - value) < delta);
  if (!rng.length) return -1;
  return rng.reduce((best, i) => (gains[i] > gains[best] ? i : best), rng[0]);
}

/**
 * First position left of `idx` whose gain is more than `attn` below the peak.
 *
 * @returns {number} -1 when there is none
 */
export function cutOffLeft(gains, idx, peakGain, attn = 3.0) {
  for (let i = idx; i >= 0; i -= 1) {
    if (peakGain - gains[i] > attn) return i;
  }
  return -1;
}

/** The same, searching right of `idx`. */
export function cutOffRight(gains, idx, peakGain, attn = 3.0) {
  for (let i = idx; i < gains.length; i += 1) {
    if (peakGain - gains[i] > attn) return i;
  }
  return -1;
}

/** The outermost positions of a dip more than `attn` below the peak. */
export function dipCutOffs(gains, peakGain, attn = 3.0) {
  const rng = [];
  for (let i = 0; i < gains.length; i += 1) {
    if (gains[i] < peakGain - attn) rng.push(i);
  }
  return rng.length ? [rng[0], rng[rng.length - 1]] : [0, 0];
}

/**
 * Roll-off between two sweep positions.
 *
 * @returns {[number, number]} attenuation per octave and per decade
 */
export function calculateRolloff(s21, idx1, idx2) {
  if (idx1 === idx2) return [NaN, NaN];
  if (idx1 < 0 || idx2 < 0 || idx1 >= s21.length || idx2 >= s21.length) {
    return [NaN, NaN];
  }
  const freq1 = s21[idx1].freq;
  const freq2 = s21[idx2].freq;
  const gain1 = s21[idx1].gain;
  const gain2 = s21[idx2].gain;
  const factor = freq1 > freq2 ? freq1 / freq2 : freq2 / freq1;
  const attn = Math.abs(gain1 - gain2);
  const decadeAttn = attn / Math.log10(factor);
  const octaveAttn = decadeAttn * Math.log10(2);
  return [octaveAttn, decadeAttn];
}
