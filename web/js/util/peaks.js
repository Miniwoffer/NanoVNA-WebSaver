/*
 *  NanoVNA-WebSaver
 *
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

// The desktop application finds peaks with scipy.signal.find_peaks and
// peak_prominences. The analyses depend closely on how those behave, so
// this is a direct port of their algorithms rather than an approximation:
// local maxima, then a distance filter, then prominence, then width --
// in that order, which is the order scipy applies them in.

/**
 * Local maxima of a sequence.
 *
 * A flat run counts as one peak, reported at the middle of the run.
 * The first and last sample can never be a peak.
 */
export function localMaxima(x) {
  const midpoints = [];
  const leftEdges = [];
  const rightEdges = [];
  const n = x.length;
  let i = 1;
  const iMax = n - 1;

  while (i < iMax) {
    if (x[i - 1] < x[i]) {
      let iAhead = i + 1;
      // walk to the end of a flat top
      while (iAhead < iMax && x[iAhead] === x[i]) iAhead += 1;

      if (x[iAhead] < x[i]) {
        leftEdges.push(i);
        rightEdges.push(iAhead - 1);
        midpoints.push((i + iAhead - 1) >> 1);
        i = iAhead;
      } else {
        i = iAhead;
        continue;
      }
    }
    i += 1;
  }
  return { midpoints, leftEdges, rightEdges };
}

/**
 * Keep the highest peak of every group closer together than `distance`.
 *
 * @param {number[]} peaks sample indices, ascending
 * @param {number[]} priority the value to rank peaks by
 */
export function selectByPeakDistance(peaks, priority, distance) {
  const n = peaks.length;
  const keep = new Array(n).fill(true);
  const minDistance = Math.ceil(distance);

  // visit peaks from highest to lowest and suppress their neighbours
  const order = peaks.map((_, i) => i).sort((a, b) => priority[a] - priority[b]);

  for (let j = n - 1; j >= 0; j -= 1) {
    const i = order[j];
    if (!keep[i]) continue;

    let k = i - 1;
    while (k >= 0 && peaks[i] - peaks[k] < minDistance) {
      keep[k] = false;
      k -= 1;
    }
    k = i + 1;
    while (k < n && peaks[k] - peaks[i] < minDistance) {
      keep[k] = false;
      k += 1;
    }
  }
  return keep;
}

/**
 * Prominence of each peak, with the bases it is measured from.
 *
 * The prominence is the height of a peak above the highest of the two
 * lowest points reached before running into higher ground on either side.
 */
export function peakProminences(x, peaks, wlen = -1) {
  const prominences = new Array(peaks.length);
  const leftBases = new Array(peaks.length);
  const rightBases = new Array(peaks.length);

  for (let p = 0; p < peaks.length; p += 1) {
    const peak = peaks[p];
    let iMin = 0;
    let iMax = x.length - 1;

    if (wlen >= 2) {
      iMin = Math.max(peak - Math.floor(wlen / 2), iMin);
      iMax = Math.min(peak + Math.floor(wlen / 2), iMax);
    }

    let i = peak;
    let leftMin = x[peak];
    while (i >= iMin && x[i] <= x[peak]) {
      if (x[i] < leftMin) leftMin = x[i];
      i -= 1;
    }
    leftBases[p] = i + 1;

    i = peak;
    let rightMin = x[peak];
    while (i <= iMax && x[i] <= x[peak]) {
      if (x[i] < rightMin) rightMin = x[i];
      i += 1;
    }
    rightBases[p] = i - 1;

    prominences[p] = x[peak] - Math.max(leftMin, rightMin);
  }
  return { prominences, leftBases, rightBases };
}

/** Width of each peak at `relHeight` of its prominence. */
export function peakWidths(x, peaks, relHeight, prominenceData) {
  const { prominences, leftBases, rightBases } = prominenceData;
  const widths = new Array(peaks.length);
  const widthHeights = new Array(peaks.length);

  for (let p = 0; p < peaks.length; p += 1) {
    const iMin = leftBases[p];
    const iMax = rightBases[p];
    const peak = peaks[p];
    const height = x[peak] - prominences[p] * relHeight;
    widthHeights[p] = height;

    let i = peak;
    while (iMin < i && height < x[i]) i -= 1;
    let leftIp = i;
    if (x[i] < height) {
      // interpolate onto the sample crossing the height
      leftIp += (height - x[i]) / (x[i + 1] - x[i]);
    }

    i = peak;
    while (i < iMax && height < x[i]) i += 1;
    let rightIp = i;
    if (x[i] < height) {
      rightIp -= (height - x[i]) / (x[i - 1] - x[i]);
    }

    widths[p] = rightIp - leftIp;
  }
  return { widths, widthHeights };
}

function withinBounds(value, bounds) {
  if (bounds === null || bounds === undefined) return true;
  const [min, max] = Array.isArray(bounds) ? bounds : [bounds, null];
  if (min !== null && min !== undefined && !(value >= min)) return false;
  if (max !== null && max !== undefined && !(value <= max)) return false;
  return true;
}

/**
 * Find peaks, applying the same filters in the same order as
 * scipy.signal.find_peaks.
 *
 * @param {number[]} x
 * @param {{height?, threshold?, distance?, prominence?, width?, wlen?,
 *          relHeight?}} options each bound is a number or a [min, max] pair
 * @returns {{peaks: number[], prominences: number[], widths: number[]}}
 */
export function findPeaks(x, options = {}) {
  const {
    height = null,
    threshold = null,
    distance = null,
    prominence = null,
    width = null,
    wlen = -1,
    relHeight = 0.5,
  } = options;

  let { midpoints: peaks } = localMaxima(x);

  if (height !== null) {
    peaks = peaks.filter((i) => withinBounds(x[i], height));
  }

  if (threshold !== null) {
    peaks = peaks.filter((i) => {
      const left = x[i] - x[i - 1];
      const right = x[i] - x[i + 1];
      return withinBounds(Math.min(left, right), threshold);
    });
  }

  if (distance !== null) {
    const keep = selectByPeakDistance(peaks, peaks.map((i) => x[i]), distance);
    peaks = peaks.filter((_, idx) => keep[idx]);
  }

  let prominenceData = null;
  if (prominence !== null || width !== null) {
    prominenceData = peakProminences(x, peaks, wlen);
  }

  if (prominence !== null) {
    const keep = prominenceData.prominences.map((v) => withinBounds(v, prominence));
    peaks = peaks.filter((_, idx) => keep[idx]);
    prominenceData = {
      prominences: prominenceData.prominences.filter((_, i) => keep[i]),
      leftBases: prominenceData.leftBases.filter((_, i) => keep[i]),
      rightBases: prominenceData.rightBases.filter((_, i) => keep[i]),
    };
  }

  let widths = null;
  if (width !== null) {
    const widthData = peakWidths(x, peaks, relHeight, prominenceData);
    const keep = widthData.widths.map((v) => withinBounds(v, width));
    peaks = peaks.filter((_, idx) => keep[idx]);
    widths = widthData.widths.filter((_, i) => keep[i]);
    prominenceData = {
      prominences: prominenceData.prominences.filter((_, i) => keep[i]),
      leftBases: prominenceData.leftBases.filter((_, i) => keep[i]),
      rightBases: prominenceData.rightBases.filter((_, i) => keep[i]),
    };
  }

  return {
    peaks,
    prominences: prominenceData ? prominenceData.prominences : null,
    widths,
  };
}
