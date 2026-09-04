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

// A port of NanoVNASaver/Windows/TDR.py: time domain reflectometry from
// a reflection sweep.

import { complexArray, fftshift, ifft, ifftshift } from '../util/fft.js';
import { blackman, hanning, kaiser, sum } from '../util/windows.js';
import { SPEED_OF_LIGHT } from './rftools.js';

export const MIN_DATA_LENGTH = 2;
export const FFT_POINTS = 2 ** 12;

//
// Amplitude correction for losses in the IFFT due to windowing and
// zero-padding when using a kaiser window. From Christian Zietz,
// https://groups.io/g/nanovna-users/topic/should_the_builtin_tdr_mode/77043091
//
const kaiserCorrection = (lens11, arg) => sum(kaiser(lens11, arg));

export const WINDOWS = {
  hanning: {
    name: 'Hanning',
    fn: (m) => hanning(m),
    corr: (lens11) => lens11 / 2.0,
    arg: null,
  },
  // The 1/0.42 is the amplitude correction factor for the Blackman
  // window; 0.42 is the average amplitude of the window across its range.
  blackman: {
    name: 'Blackman',
    fn: (m) => blackman(m),
    corr: (lens11) => lens11 / (1 / 0.42),
    arg: null,
  },
  kaiser0: {
    name: 'Minimal (Kaiser, β=0)',
    fn: (m, arg) => kaiser(m, arg),
    corr: kaiserCorrection,
    arg: 0,
  },
  kaiser6: {
    name: 'Normal (Kaiser, β=6)',
    fn: (m, arg) => kaiser(m, arg),
    corr: kaiserCorrection,
    arg: 6,
  },
  kaiser13: {
    name: 'Strong (Kaiser, β=13)',
    fn: (m, arg) => kaiser(m, arg),
    corr: kaiserCorrection,
    arg: 13,
  },
  kaiser100: {
    name: 'Maximal (Kaiser, β=100)',
    fn: (m, arg) => kaiser(m, arg),
    corr: kaiserCorrection,
    arg: 100,
  },
};

export const FORMATS = [
  '|Z| (lowpass)',
  'S11 (lowpass)',
  'VSWR (lowpass)',
  'Refl (lowpass)',
  'Refl (bandpass)',
];

export const CABLE_PARAMETERS = [
  ['Jelly filled (0.64)', 0.64],
  ['Polyethylene (0.66)', 0.66],
  ['PTFE (Teflon) (0.70)', 0.7],
  ['Pulp Insulation (0.72)', 0.72],
  ['Foam or Cellular PE (0.78)', 0.78],
  ['Semi-solid PE (SSPE) (0.84)', 0.84],
  ['Air (Helical spacers) (0.94)', 0.94],
  // Lots of cable types added by Larry Goga, AE5CZ
  ['RG-6/U PE 75Ω (Belden 8215) (0.66)', 0.66],
  ['RG-6/U Foam 75Ω (Belden 9290) (0.81)', 0.81],
  ['RG-8/U PE 50Ω (Belden 8237) (0.66)', 0.66],
  ['RG-8/U Foam (Belden 8214) (0.78)', 0.78],
  ['RG-8/U (Belden 9913) (0.84)', 0.84],
  // Next one added by EKZ, KC3KZ, from measurement of actual cable
  ['RG-8/U (Shireen RFC®400 Low Loss) (0.86)', 0.86],
  ['RG-8X (Belden 9258) (0.82)', 0.82],
  // Next three added by EKZ, KC3KZ, from measurement of actual cable
  ['RG-8X (Wireman "Super 8" CQ106) (0.81)', 0.81],
  ['RG-8X (Wireman "MINI-8 Lo-Loss" CQ118) (0.82)', 0.82],
  ['RG-58 (Wireman "CQ 58 Lo-Loss Flex" CQ129FF) (0.79)', 0.79],
  ['RG-11/U 75Ω Foam HDPE (Belden 9292) (0.84)', 0.84],
  ['RG-58/U 52Ω PE (Belden 9201) (0.66)', 0.66],
  ['RG-58A/U 54Ω Foam (Belden 8219) (0.73)', 0.73],
  ['RG-59A/U PE 75Ω (Belden 8241) (0.66)', 0.66],
  ['RG-59A/U Foam 75Ω (Belden 8241F) (0.78)', 0.78],
  ['RG-174 PE (Belden 8216)(0.66)', 0.66],
  ['RG-174 Foam (Belden 7805R) (0.735)', 0.735],
  ['RG-213/U PE (Belden 8267) (0.66)', 0.66],
  ['RG316 (0.695)', 0.695],
  ['RG402 (0.695)', 0.695],
  ['LMR-240 (0.84)', 0.84],
  ['LMR-240UF (0.80)', 0.8],
  ['LMR-400 (0.85)', 0.85],
  ['LMR400UF (0.83)', 0.83],
  ['Davis Bury-FLEX (0.82)', 0.82],
];

/**
 * Transform a reflection sweep into the distance domain.
 *
 * @param {Datapoint[]} s11
 * @param {{velocityFactor?: number, format?: string, window?: string,
 *          fftPoints?: number}} options
 * @returns {?object} null when the sweep is too short or has no span
 */
export function computeTDR(s11, options = {}) {
  const {
    velocityFactor = 0.66,
    format = '|Z| (lowpass)',
    window = 'kaiser6',
    fftPoints = FFT_POINTS,
  } = options;

  if (s11.length < MIN_DATA_LENGTH) return null;
  if (!FORMATS.includes(format)) throw new RangeError(`Unknown TDR format: ${format}`);
  const tdrWindow = WINDOWS[window];
  if (!tdrWindow) throw new RangeError(`Unknown TDR window: ${window}`);

  const stepSize = s11[1].freq - s11[0].freq;
  if (stepSize === 0) return null; // cannot compute a cable length at 0 span

  // In lowpass mode the frequency is measured down to DC. Because the
  // impulse response is real, the frequency data can be mirrored so the
  // output of the IFFT is a real signal.
  //
  // In bandpass mode the low frequency information is missing, so the
  // data has to stay complex and only the magnitude of the impulse
  // response is available.
  const lowpass = format.includes('lowpass');
  let data = complexArray(s11.length);
  for (let i = 0; i < s11.length; i += 1) {
    data.re[i] = s11[i].re;
    data.im[i] = s11[i].im;
  }
  if (lowpass) data = fftshift(mirrorConjugate(data));

  const length = data.re.length;
  const taper = tdrWindow.fn(length, tdrWindow.arg);
  let windowed = complexArray(length);
  for (let i = 0; i < length; i += 1) {
    windowed.re[i] = taper[i] * data.re[i];
    windowed.im[i] = taper[i] * data.im[i];
  }

  let td;
  let stepResponseZ;
  if (lowpass) {
    ({ td, stepResponseZ } = tdrLowpass(format, length, windowed, tdrWindow, fftPoints));
  } else {
    td = ifft(windowed, fftPoints);
    // Convolving with a step function is unnecessary; only the magnitude
    // of the impulse response is available here.
    const magnitude = new Float64Array(fftPoints);
    for (let i = 0; i < fftPoints; i += 1) {
      magnitude[i] = Math.hypot(td.re[i], td.im[i]);
    }
    td = { re: magnitude, im: new Float64Array(fftPoints) };
    stepResponseZ = new Float64Array(fftPoints);
    const corr = tdrWindow.corr(length, tdrWindow.arg);
    for (let i = 0; i < fftPoints; i += 1) {
      stepResponseZ[i] = (magnitude[i] * fftPoints) / corr;
    }
  }

  // The chart plots, and the peak search runs on, the real part of the
  // impulse response; in bandpass mode that is already its magnitude.
  const impulse = td.re.slice(0, fftPoints);

  const distanceAxis = new Float64Array(fftPoints);
  for (let i = 0; i < fftPoints; i += 1) {
    const time = (i / (fftPoints - 1)) * (1 / stepSize);
    distanceAxis[i] = time * velocityFactor * SPEED_OF_LIGHT;
  }

  // We should check that this is an actual peak and not just a vague
  // maximum, as the desktop implementation notes.
  let indexPeak = 0;
  for (let i = 1; i < fftPoints; i += 1) {
    if (impulse[i] > impulse[indexPeak]) indexPeak = i;
  }

  const cableLength = round(distanceAxis[indexPeak] / 2, 3);
  const feet = Math.floor(cableLength / 0.3048);
  const inches = round((cableLength / 0.3048 - feet) * 12, 1);

  return {
    format,
    window,
    velocityFactor,
    stepSize,
    distanceAxis,
    impulse,
    stepResponseZ,
    indexPeak,
    cableLength,
    cableLengthText: `${cableLength}m (${feet}ft ${inches}in)`,
  };
}

/** Append the conjugate mirror of a spectrum, excluding DC. */
function mirrorConjugate(data) {
  const n = data.re.length;
  const out = complexArray(2 * n - 1);
  out.re.set(data.re);
  out.im.set(data.im);
  for (let i = 1; i < n; i += 1) {
    out.re[n + i - 1] = data.re[n - i];
    out.im[n + i - 1] = -data.im[n - i];
  }
  return out;
}

function tdrLowpass(format, lens11, windowedInput, tdrWindow, fftPoints) {
  // pad the spectrum out to fftPoints, centred
  const padPoints = Math.floor((fftPoints - windowedInput.re.length) / 2);
  let windowed = complexArray(fftPoints);
  windowed.re.set(windowedInput.re, padPoints + 1);
  windowed.im.set(windowedInput.im, padPoints + 1);
  windowed = ifftshift(windowed);

  const td = ifft(windowed, fftPoints);

  // convolve(td, ones(fftPoints)) + convolve(reverse(td), ones(fftPoints)).
  // This fixes the issue with the impedance being wrong when the length
  // is zero.
  const stepResponse = stepConvolution(td, fftPoints);

  const n = stepResponse.re.length;
  const stepResponseZ = new Float64Array(n);

  if (format === 'Refl (lowpass)') {
    const corr = tdrWindow.corr(lens11, tdrWindow.arg);
    const out = new Float64Array(fftPoints);
    for (let i = 0; i < fftPoints; i += 1) out[i] = (td.re[i] * fftPoints) / corr;
    return { td, stepResponseZ: out };
  }

  for (let i = 0; i < n; i += 1) {
    // step_Z = 50 * (1 + step_response) / (1 - step_response)
    const numRe = 1 + stepResponse.re[i];
    const numIm = stepResponse.im[i];
    const denRe = 1 - stepResponse.re[i];
    const denIm = -stepResponse.im[i];
    const denom = denRe * denRe + denIm * denIm;
    const zRe = (50 * (numRe * denRe + numIm * denIm)) / denom;
    const zIm = (50 * (numIm * denRe - numRe * denIm)) / denom;

    if (format === '|Z| (lowpass)') {
      stepResponseZ[i] = Math.hypot(zRe, zIm);
      continue;
    }
    // magnitude of the step impedance's reflection coefficient,
    // |(z - 50) / (z + 50)|
    const refl = Math.hypot(zRe - 50, zIm) / Math.hypot(zRe + 50, zIm);
    if (format === 'S11 (lowpass)') {
      stepResponseZ[i] = 20 * Math.log10(refl);
    } else {
      // "VSWR (lowpass)"
      stepResponseZ[i] = Math.abs((1 + refl) / (1 - refl));
    }
  }
  return { td, stepResponseZ };
}

/**
 * The full convolution of the impulse response with a unit step, added
 * to that of its time reverse.
 *
 * Computed from prefix sums rather than by convolving, which is the same
 * result in linear rather than quadratic time.
 */
function stepConvolution(td, n) {
  const prefixRe = new Float64Array(n + 1);
  const prefixIm = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    prefixRe[i + 1] = prefixRe[i] + td.re[i];
    prefixIm[i + 1] = prefixIm[i] + td.im[i];
  }

  const outLength = 2 * n - 1;
  const out = complexArray(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const lo = Math.max(0, i - n + 1);
    const hi = Math.min(i, n - 1);
    // forward: sum of td[lo..hi]
    const fwdRe = prefixRe[hi + 1] - prefixRe[lo];
    const fwdIm = prefixIm[hi + 1] - prefixIm[lo];
    // reversed: sum of td[n-1-hi .. n-1-lo]
    const revRe = prefixRe[n - lo] - prefixRe[n - 1 - hi];
    const revIm = prefixIm[n - lo] - prefixIm[n - 1 - hi];
    out.re[i] = fwdRe + revRe;
    out.im[i] = fwdIm + revIm;
  }
  return out;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
