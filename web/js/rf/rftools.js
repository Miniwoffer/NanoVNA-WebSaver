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

// A port of NanoVNASaver/RFTools.py. JavaScript has no complex type, so
// complex values are plain {re, im} objects and the arithmetic lives in
// the small helpers at the top of this module.

export const SPEED_OF_LIGHT = 299792458;
export const TAU = Math.PI * 2;

export const cx = (re, im = 0) => ({ re, im });

export const cAdd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
export const cSub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
export const cMul = (a, b) => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export function cDiv(a, b) {
  const denom = b.re * b.re + b.im * b.im;
  if (denom === 0) return { re: Infinity, im: Infinity };
  return {
    re: (a.re * b.re + a.im * b.im) / denom,
    im: (a.im * b.re - a.re * b.im) / denom,
  };
}

export const cScale = (a, k) => ({ re: a.re * k, im: a.im * k });
export const cNeg = (a) => ({ re: -a.re, im: -a.im });
export const cConj = (a) => ({ re: a.re, im: -a.im });
export const cAbs = (a) => Math.hypot(a.re, a.im);
export const cPhase = (a) => Math.atan2(a.im, a.re);

/** e^(i*theta) scaled by r. */
export const cPolar = (r, theta) => ({
  re: r * Math.cos(theta),
  im: r * Math.sin(theta),
});

/** e^z for a complex z. */
export function cExp(z) {
  const r = Math.exp(z.re);
  return { re: r * Math.cos(z.im), im: r * Math.sin(z.im) };
}

export const cSquare = (a) => cMul(a, a);

/**
 * One measured point of a sweep.
 *
 * Kept as a class with getters so that it reads like the Python
 * Datapoint it is ported from, while staying cheap to allocate.
 */
export class Datapoint {
  constructor(freq, re, im) {
    this.freq = freq;
    this.re = re;
    this.im = im;
  }

  /** The S value as a complex number. */
  get z() {
    return { re: this.re, im: this.im };
  }

  get phase() {
    return Math.atan2(this.im, this.re);
  }

  get gain() {
    const mag = Math.hypot(this.re, this.im);
    return mag > 0 ? 20 * Math.log10(mag) : -Infinity;
  }

  get vswr() {
    const mag = Math.hypot(this.re, this.im);
    return mag < 1 ? (1 + mag) / (1 - mag) : Infinity;
  }

  get wavelength() {
    return this.freq ? SPEED_OF_LIGHT / this.freq : Infinity;
  }

  impedance(refImpedance = 50) {
    return gammaToImpedance(this.z, refImpedance);
  }

  shuntImpedance(refImpedance = 50) {
    const denom = cSub(cx(1), this.z);
    if (denom.re === 0 && denom.im === 0) return cx(Infinity, Infinity);
    return cDiv(cScale(this.z, 0.5 * refImpedance), denom);
  }

  seriesImpedance(refImpedance = 50) {
    if (this.re === 0 && this.im === 0) return cx(Infinity, Infinity);
    return cDiv(cScale(cSub(cx(1), this.z), 2 * refImpedance), this.z);
  }

  qFactor(refImpedance = 50) {
    const imp = this.impedance(refImpedance);
    return imp.re === 0 ? -1 : Math.abs(imp.im / imp.re);
  }

  capacitiveEquivalent(refImpedance = 50) {
    return impedanceToCapacitance(this.impedance(refImpedance), this.freq);
  }

  inductiveEquivalent(refImpedance = 50) {
    return impedanceToInductance(this.impedance(refImpedance), this.freq);
  }
}

/** Calculate impedance from gamma. */
export function gammaToImpedance(gamma, refImpedance = 50) {
  const denom = cSub(gamma, cx(1));
  if (denom.re === 0 && denom.im === 0) return cx(Infinity, Infinity);
  return cScale(cDiv(cSub(cNeg(gamma), cx(1)), denom), refImpedance);
}

export function groupDelay(data, index) {
  const idx0 = Math.max(0, Math.min(index - 1, data.length - 1));
  const idx1 = Math.max(0, Math.min(index + 1, data.length - 1));
  const deltaAngle = data[idx1].phase - data[idx0].phase;
  const deltaFreq = data[idx1].freq - data[idx0].freq;
  return deltaFreq === 0 ? 0 : -deltaAngle / TAU / deltaFreq;
}

/** Calculate the capacitive equivalent for a reactance. */
export function impedanceToCapacitance(z, freq) {
  if (freq === 0) return -Infinity;
  return z.im === 0 ? Infinity : -(1 / (freq * TAU * z.im));
}

/** Calculate the inductive equivalent for a reactance. */
export function impedanceToInductance(z, freq) {
  return freq === 0 ? 0 : (z.im * 1) / (freq * TAU);
}

export const impedanceToNorm = (z, refImpedance = 50) => cScale(z, 1 / refImpedance);
export const normToImpedance = (z, refImpedance = 50) => cScale(z, refImpedance);

/** Convert a parallel impedance to its serial equivalent. */
export function parallelToSerial(z) {
  const zSqSum = z.re * z.re + z.im * z.im || 10.0e-30;
  return cx((z.re * z.im * z.im) / zSqSum, (z.re * z.re * z.im) / zSqSum);
}

/** Calculate the reflection coefficient for an impedance. */
export function reflectionCoefficient(z, refImpedance = 50) {
  return cDiv(cSub(z, cx(refImpedance)), cAdd(z, cx(refImpedance)));
}

/** Convert a serial impedance to its parallel equivalent. */
export function serialToParallel(z) {
  const zSqSum = z.re * z.re + z.im * z.im;
  if (z.re === 0 && z.im === 0) return cx(Infinity, Infinity);
  if (z.im === 0) return cx(zSqSum / z.re, Math.sign(zSqSum) * Infinity || Infinity);
  if (z.re === 0) return cx(Math.sign(zSqSum) * Infinity || Infinity, zSqSum / z.im);
  return cx(zSqSum / z.re, zSqSum / z.im);
}

/** Correct the ratio for a given attenuation on the S21 input. */
export function corrAttData(data, att) {
  if (att <= 0) return data;
  const factor = 10 ** (att / 20);
  return data.map((dp) => new Datapoint(dp.freq, dp.re * factor, dp.im * factor));
}
