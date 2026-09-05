/*
 *  NanoVNA-WebSaver -- tests for the frequency range bar's mapping.
 *
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *  Licensed under the GNU General Public License v3 or later.
 *
 *  Not covered here (needs a real DOM, checked in a browser instead):
 *  the drag, wheel and click interactions themselves.
 */

import { assert, describe, it } from './harness.js';
import {
  clampRange,
  decadeTicks,
  deviceLimits,
  fromFraction,
  toFraction,
} from '../js/ui/rangebar.js';

const H4 = { min: 10e3, max: 1.5e9 };

describe('deviceLimits', () => {
  it('falls back to a NanoVNA-H4 range with no device', () => {
    assert.deepEqual(deviceLimits(null), { min: 10e3, max: 1.5e9 });
    assert.deepEqual(deviceLimits(undefined), { min: 10e3, max: 1.5e9 });
  });

  it('uses what the device declares', () => {
    assert.deepEqual(
      deviceLimits({ sweepMinFreqHz: 50e3, sweepMaxFreqHz: 900e6 }),
      { min: 50e3, max: 900e6 },
    );
  });

  it('ignores a device that reports nothing useful', () => {
    // sweepMaxFreqHz defaults to 0 on the base class
    assert.deepEqual(deviceLimits({ sweepMaxFreqHz: 0 }), { min: 10e3, max: 1.5e9 });
    assert.deepEqual(deviceLimits({ sweepMinFreqHz: 9e9, sweepMaxFreqHz: 1e9 }),
      { min: 10e3, max: 1.5e9 }, 'an inverted range is not usable');
  });
});

describe('the logarithmic track', () => {
  it('puts the limits at the ends', () => {
    assert.close(toFraction(H4.min, H4), 0, 1e-12);
    assert.close(toFraction(H4.max, H4), 1, 1e-12);
  });

  it('places each decade an equal distance apart', () => {
    const decades = [1e5, 1e6, 1e7, 1e8].map((f) => toFraction(f, H4));
    const gaps = decades.slice(1).map((v, i) => v - decades[i]);
    for (const gap of gaps) assert.close(gap, gaps[0], 1e-12);
  });

  it('gives the low end real estate a linear scale would not', () => {
    // 1 MHz is under a thousandth of the way along a linear track but
    // roughly two fifths of the way along this one
    const at1MHz = toFraction(1e6, H4);
    assert.ok(at1MHz > 0.35 && at1MHz < 0.45, `1 MHz sits at ${at1MHz}`);
  });

  it('round trips a frequency through the track', () => {
    for (const freq of [10e3, 137e3, 3.5e6, 14.1e6, 144e6, 1.29e9]) {
      assert.close(fromFraction(toFraction(freq, H4), H4), freq, Math.max(1, freq * 1e-9));
    }
  });

  it('clamps out of range input rather than running off the ends', () => {
    assert.equal(toFraction(1, H4), 0);
    assert.equal(toFraction(9e9, H4), 1);
    assert.equal(fromFraction(-5, H4), H4.min);
    assert.equal(fromFraction(5, H4), H4.max);
  });

  it('returns whole hertz', () => {
    const freq = fromFraction(0.37, H4);
    assert.equal(freq, Math.round(freq));
  });
});

describe('decadeTicks', () => {
  it('labels every whole decade inside the limits', () => {
    assert.deepEqual(decadeTicks(H4), [1e4, 1e5, 1e6, 1e7, 1e8, 1e9]);
  });

  it('skips decades the device cannot reach', () => {
    assert.deepEqual(decadeTicks({ min: 50e3, max: 900e6 }), [1e5, 1e6, 1e7, 1e8]);
  });

  it('copes with a range narrower than a decade', () => {
    assert.deepEqual(decadeTicks({ min: 2e6, max: 8e6 }), []);
  });
});

describe('clampRange', () => {
  it('leaves a range that already fits alone', () => {
    assert.deepEqual(clampRange(1e6, 2e6, H4), { start: 1e6, end: 2e6 });
  });

  it('slides a range back inside without narrowing it', () => {
    const below = clampRange(1e3, 1e6, H4);
    assert.equal(below.start, H4.min);
    assert.equal(below.end - below.start, 1e6 - 1e3, 'the width is kept');

    const above = clampRange(1.4e9, 2e9, H4);
    assert.equal(above.end, H4.max);
    assert.equal(above.end - above.start, 2e9 - 1.4e9);
  });

  it('gives up width only when the range is wider than the device', () => {
    assert.deepEqual(clampRange(1, 9e9, H4), { start: H4.min, end: H4.max });
  });

  it('never produces an inverted or zero span', () => {
    const range = clampRange(5e6, 5e6, H4);
    assert.ok(range.end > range.start, JSON.stringify(range));
  });
});
