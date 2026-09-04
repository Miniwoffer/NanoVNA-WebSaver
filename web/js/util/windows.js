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

// The window functions the TDR display offers, matching numpy.hanning,
// numpy.blackman and numpy.kaiser.

/**
 * Modified Bessel function of the first kind, order zero.
 *
 * Evaluated as its power series; the terms peak around k = x/2 and then
 * fall away quickly, and stay well inside a double's range for the
 * beta values the TDR window offers.
 */
export function besselI0(x) {
  const halfX = x / 2;
  let term = 1;
  let sum = 1;
  for (let k = 1; k < 500; k += 1) {
    const ratio = halfX / k;
    term *= ratio * ratio;
    sum += term;
    if (term < sum * 1e-18) break;
  }
  return sum;
}

/** numpy.hanning */
export function hanning(m) {
  const out = new Float64Array(m);
  if (m < 1) return out;
  if (m === 1) {
    out[0] = 1;
    return out;
  }
  for (let n = 0; n < m; n += 1) {
    out[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (m - 1));
  }
  return out;
}

/** numpy.blackman */
export function blackman(m) {
  const out = new Float64Array(m);
  if (m < 1) return out;
  if (m === 1) {
    out[0] = 1;
    return out;
  }
  for (let n = 0; n < m; n += 1) {
    const t = (2 * Math.PI * n) / (m - 1);
    out[n] = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t);
  }
  return out;
}

/** numpy.kaiser */
export function kaiser(m, beta) {
  const out = new Float64Array(m);
  if (m < 1) return out;
  if (m === 1) {
    out[0] = 1;
    return out;
  }
  const alpha = (m - 1) / 2;
  const denom = besselI0(beta);
  for (let n = 0; n < m; n += 1) {
    const t = (n - alpha) / alpha;
    out[n] = besselI0(beta * Math.sqrt(Math.max(0, 1 - t * t))) / denom;
  }
  return out;
}

export function sum(values) {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += values[i];
  return total;
}
