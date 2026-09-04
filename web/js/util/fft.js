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

// The TDR display needs an inverse FFT. numpy is not available in a
// browser, so this module supplies the handful of numpy.fft entry points
// the port uses, on split real/imaginary Float64Arrays.
//
// Transform lengths are always a power of two here: the TDR code pads to
// one, and Bluestein's algorithm would only add code for no benefit.

/** A complex signal held as two parallel arrays. */
export function complexArray(length) {
  return { re: new Float64Array(length), im: new Float64Array(length) };
}

function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * In-place radix-2 FFT.
 *
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @param {boolean} inverse when true, conjugate the twiddle factors
 */
function transform(re, im, inverse) {
  const n = re.length;
  if (n <= 1) return;
  if (!isPowerOfTwo(n)) throw new RangeError(`FFT length ${n} is not a power of two`);

  // bit reversal permutation
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (sign * 2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * Forward FFT, resizing to `n` by truncation or zero padding.
 *
 * The signature mirrors numpy.fft.fft(a, n).
 */
export function fft(input, n = input.re.length) {
  const out = resize(input, n);
  transform(out.re, out.im, false);
  return out;
}

/** Inverse FFT, normalised by 1/n as numpy.fft.ifft is. */
export function ifft(input, n = input.re.length) {
  const out = resize(input, n);
  transform(out.re, out.im, true);
  for (let i = 0; i < n; i += 1) {
    out.re[i] /= n;
    out.im[i] /= n;
  }
  return out;
}

function resize(input, n) {
  const out = complexArray(n);
  const count = Math.min(n, input.re.length);
  out.re.set(input.re.subarray(0, count));
  out.im.set(input.im.subarray(0, count));
  return out;
}

/** numpy.fft.fftshift: move the zero frequency to the centre. */
export function fftshift(input) {
  const n = input.re.length;
  const shift = Math.floor(n / 2);
  return roll(input, shift);
}

/** numpy.fft.ifftshift, the inverse of {@link fftshift}. */
export function ifftshift(input) {
  const n = input.re.length;
  const shift = -Math.floor(n / 2);
  return roll(input, shift);
}

function roll(input, shift) {
  const n = input.re.length;
  const out = complexArray(n);
  for (let i = 0; i < n; i += 1) {
    const j = (((i + shift) % n) + n) % n;
    out.re[j] = input.re[i];
    out.im[j] = input.im[i];
  }
  return out;
}

/** Full linear convolution of a complex signal with a real one. */
export function convolveFull(signal, kernel) {
  const n = signal.re.length;
  const m = kernel.length;
  const out = complexArray(n + m - 1);
  // The TDR step response convolves with a constant unit step, so this
  // reduces to a running sum; keeping it general costs nothing here
  // because the kernel is scanned once per output sample.
  for (let i = 0; i < n; i += 1) {
    const sRe = signal.re[i];
    const sIm = signal.im[i];
    if (sRe === 0 && sIm === 0) continue;
    for (let j = 0; j < m; j += 1) {
      out.re[i + j] += sRe * kernel[j];
      out.im[i + j] += sIm * kernel[j];
    }
  }
  return out;
}

/**
 * Cumulative sum of a complex signal.
 *
 * Convolving with a unit step of length n and keeping the first n
 * samples is exactly this, and is what the TDR step response needs.
 */
export function cumulativeSum(signal, length = signal.re.length) {
  const out = complexArray(length);
  let accRe = 0;
  let accIm = 0;
  for (let i = 0; i < length; i += 1) {
    accRe += i < signal.re.length ? signal.re[i] : 0;
    accIm += i < signal.im.length ? signal.im[i] : 0;
    out.re[i] = accRe;
    out.im[i] = accIm;
  }
  return out;
}
