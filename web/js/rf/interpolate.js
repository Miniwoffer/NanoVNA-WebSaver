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

// The desktop application interpolates calibration terms and reference
// traces with scipy's interp1d(kind="slinear", bounds_error=False,
// fill_value=(first, last)): piecewise linear inside the sampled range,
// held flat at the end values outside it. That is what this module does.

import { Datapoint } from './rftools.js';

/** Index of the last sample at or below x, clamped into [0, n-2]. */
function segmentIndex(xs, x) {
  let lo = 0;
  let hi = xs.length - 1;
  if (x <= xs[0]) return 0;
  if (x >= xs[hi]) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * A reusable linear interpolator over one sampled real function.
 *
 * Values outside the sampled range are held at the first and last
 * sample rather than extrapolated.
 */
export class Interpolator {
  constructor(xs, ys) {
    if (xs.length !== ys.length) throw new RangeError('xs and ys differ in length');
    if (!xs.length) throw new RangeError('nothing to interpolate');
    this.xs = xs;
    this.ys = ys;
  }

  at(x) {
    const { xs, ys } = this;
    if (xs.length === 1) return ys[0];
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    const i = segmentIndex(xs, x);
    const span = xs[i + 1] - xs[i];
    if (span === 0) return ys[i];
    const t = (x - xs[i]) / span;
    return ys[i] + t * (ys[i + 1] - ys[i]);
  }
}

/** The same, over a sampled complex function. */
export class ComplexInterpolator {
  constructor(xs, values) {
    this.re = new Interpolator(xs, values.map((v) => v.re));
    this.im = new Interpolator(xs, values.map((v) => v.im));
  }

  at(x) {
    return { re: this.re.at(x), im: this.im.at(x) };
  }
}

/** Interpolate a sweep trace to an arbitrary frequency. */
export function interpolateTrace(data, freq) {
  if (!data.length) return new Datapoint(freq, 0, 0);
  const xs = data.map((d) => d.freq);
  const re = new Interpolator(xs, data.map((d) => d.re));
  const im = new Interpolator(xs, data.map((d) => d.im));
  return new Datapoint(freq, re.at(freq), im.at(freq));
}

/**
 * Resample a trace onto another trace's frequencies.
 *
 * Used to draw a reference sweep taken over a different span.
 */
export function resampleTrace(data, frequencies) {
  if (!data.length) return [];
  const xs = data.map((d) => d.freq);
  const re = new Interpolator(xs, data.map((d) => d.re));
  const im = new Interpolator(xs, data.map((d) => d.im));
  return frequencies.map((f) => new Datapoint(f, re.at(f), im.at(f)));
}
