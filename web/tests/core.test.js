/*
 *  NanoVNA-WebSaver -- tests for the ported RF core.
 *
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *  Licensed under the GNU General Public License v3 or later.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { assert, describe, it } from './harness.js';
import { Datapoint, gammaToImpedance, groupDelay, serialToParallel,
         parallelToSerial, reflectionCoefficient, corrAttData } from '../js/rf/rftools.js';
import { Touchstone } from '../js/rf/touchstone.js';
import { Sweep, SweepMode } from '../js/rf/sweep.js';
import { formatFrequency, formatFrequencySweep, formatVSWR, formatResistance,
         formatCapacitance, formatInductance, formatComplexImp, parseFrequency,
         formatQFactor, formatGroupDelay, formatWavelength } from '../js/util/format.js';
import { zeroCrossings, maxima, minima, takeFromIdx, centerFromIdx,
         cutOffLeft, cutOffRight, dipCutOffs, calculateRolloff } from '../js/rf/analytic.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(HERE, 'data');
export const fixture = (name) => readFileSync(join(DATA_DIR, name), 'utf-8');

describe('rftools', () => {
  it('computes gain, vswr and phase like the desktop app', () => {
    const dp = new Datapoint(14000000, 0.5, 0.5);
    assert.close(dp.gain, 20 * Math.log10(Math.hypot(0.5, 0.5)), 1e-12);
    assert.close(dp.vswr, (1 + Math.hypot(0.5, 0.5)) / (1 - Math.hypot(0.5, 0.5)), 1e-12);
    assert.close(dp.phase, Math.PI / 4, 1e-12);
    assert.close(dp.wavelength, 299792458 / 14000000, 1e-9);
  });

  it('converts a matched load to 50 ohm', () => {
    const z = gammaToImpedance({ re: 0, im: 0 });
    assert.close(z.re, 50, 1e-12);
    assert.close(z.im, 0, 1e-12);
  });

  it('round trips impedance through the reflection coefficient', () => {
    const z = { re: 75, im: -22 };
    const back = gammaToImpedance(reflectionCoefficient(z));
    assert.close(back.re, z.re, 1e-9);
    assert.close(back.im, z.im, 1e-9);
  });

  it('round trips serial and parallel equivalents', () => {
    const z = { re: 30, im: 40 };
    const back = parallelToSerial(serialToParallel(z));
    assert.close(back.re, z.re, 1e-9);
    assert.close(back.im, z.im, 1e-9);
  });

  it('reports zero group delay on a flat phase', () => {
    const data = [0, 1, 2].map((i) => new Datapoint(1000 + i * 10, 1, 0));
    assert.close(groupDelay(data, 1), 0, 1e-15);
  });

  it('scales s21 by an attenuator value', () => {
    const data = [new Datapoint(1e6, 0.5, 0)];
    assert.close(corrAttData(data, 20)[0].re, 5, 1e-9);
    assert.equal(corrAttData(data, 0)[0].re, 0.5);
  });
});

describe('formatting', () => {
  it('formats frequencies as the desktop app does', () => {
    assert.equal(formatFrequency(1), '1.00000Hz');
    assert.equal(formatFrequency(1000), '1.00000kHz');
    assert.equal(formatFrequency(14250000), '14.2500MHz');
    assert.equal(formatFrequencySweep(14250000), '14.25MHz');
  });

  it('parses frequency entries', () => {
    assert.equal(parseFrequency('14.25MHz'), 14250000);
    assert.equal(parseFrequency('14250k'), 14250000);
    assert.equal(parseFrequency('1G'), 1000000000);
    assert.equal(parseFrequency('nonsense'), -1);
  });

  it('formats the marker readouts', () => {
    assert.equal(formatVSWR(1.5), '1.500');
    assert.equal(formatResistance(-5), '- Ω');
    assert.equal(formatResistance(-5, true), '-5 Ω');
    assert.equal(formatCapacitance(1e-12), '1 pF');
    assert.equal(formatInductance(1e-9), '1 nH');
    assert.equal(formatComplexImp({ re: 50, im: -25 }), '50-j25 Ω');
    assert.equal(formatQFactor(-1), '∞');
    assert.equal(formatGroupDelay(1e-9), '1.0000 ns');
    assert.equal(formatWavelength(21.4), '21.40 m');
  });
});

describe('touchstone', () => {
  it('reads a real ri s1p fixture', () => {
    const ts = new Touchstone('valid.s1p');
    ts.loads(fixture('valid.s1p'));
    assert.ok(ts.s11.length > 0);
    assert.equal(ts.s21.length, 0);
    assert.equal(ts.opts.format, 'ri');
  });

  it('reads the same attenuator in ri, ma and db form', () => {
    const traces = ['RI', 'MA', 'DB'].map((suffix) => {
      const ts = new Touchstone();
      ts.loads(fixture(`attenuator-0643_${suffix}.s2p`));
      return ts;
    });
    const [ri, ma, db] = traces;
    assert.equal(ri.s11.length, ma.s11.length);
    assert.equal(ri.s11.length, db.s11.length);
    for (let i = 0; i < ri.s11.length; i += 1) {
      assert.equal(ri.s11[i].freq, ma.s11[i].freq);
      assert.close(ri.s11[i].re, ma.s11[i].re, 1e-4, `s11 re at ${i}`);
      assert.close(ri.s11[i].im, ma.s11[i].im, 1e-4, `s11 im at ${i}`);
      assert.close(ri.s21[i].re, db.s21[i].re, 1e-4, `s21 re at ${i}`);
      assert.close(ri.s21[i].im, db.s21[i].im, 1e-4, `s21 im at ${i}`);
    }
  });

  it('sorts unordered data', () => {
    const ts = new Touchstone();
    ts.loads(fixture('unordered.s1p'));
    for (let i = 1; i < ts.s11.length; i += 1) {
      assert.ok(ts.s11[i].freq >= ts.s11[i - 1].freq, 'frequencies ascending');
    }
  });

  it('rejects broken pairs', () => {
    const ts = new Touchstone();
    assert.throws(() => ts.loads(fixture('broken_pair.s2p')));
  });

  it('round trips through saves()', () => {
    const ts = new Touchstone();
    ts.loads(fixture('valid.s1p'));
    const again = new Touchstone();
    again.loads(ts.saves(1));
    assert.equal(again.s11.length, ts.s11.length);
    for (let i = 0; i < ts.s11.length; i += 1) {
      assert.equal(again.s11[i].freq, ts.s11[i].freq);
      assert.close(again.s11[i].re, ts.s11[i].re, 1e-12);
    }
  });

  it('interpolates between samples', () => {
    const ts = new Touchstone();
    ts.loads('# HZ S RI R 50\n1000 0 0\n2000 1 1\n');
    const mid = ts.sFreq('11', 1500);
    assert.close(mid.re, 0.5, 1e-12);
    assert.close(mid.im, 0.5, 1e-12);
    // outside the range the end values are held
    assert.close(ts.sFreq('11', 10).re, 0, 1e-12);
    assert.close(ts.sFreq('11', 1e9).re, 1, 1e-12);
  });
});

describe('sweep', () => {
  it('splits a span into segments', () => {
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 101, segments: 2 });
    assert.equal(sweep.totalPoints, 202);
    const freqs = sweep.getFrequencies();
    assert.equal(freqs.length, 202);
    assert.equal(freqs[0], 1000000);
    // the step size is rounded to whole Hz, so the last point falls
    // just short of the requested end -- as it does on the desktop
    assert.equal(sweep.stepsize, 4975);
    assert.equal(freqs[freqs.length - 1], 1999975);
    for (let i = 1; i < freqs.length; i += 1) {
      assert.ok(freqs[i] > freqs[i - 1], `ascending at ${i}`);
    }
  });

  it('spaces a logarithmic sweep geometrically', () => {
    const sweep = new Sweep({ start: 1000000, end: 100000000, points: 11, segments: 4 });
    sweep.setLogarithmic(true);
    const [s0] = sweep.getIndexRange(0);
    const [, e3] = sweep.getIndexRange(3);
    assert.equal(s0, 1000000);
    assert.close(e3, 100000000, 1);
    const [, e0] = sweep.getIndexRange(0);
    const [s1] = sweep.getIndexRange(1);
    assert.equal(e0, s1, 'segments meet');
  });

  it('rejects illegal settings', () => {
    assert.throws(() => new Sweep({ start: 0 }));
    assert.throws(() => new Sweep({ start: 1000, end: 100 }));
  });

  it('carries its properties through a copy', () => {
    const sweep = new Sweep();
    sweep.setMode(SweepMode.AVERAGE);
    sweep.setAverages(5, 2);
    const copy = sweep.copy();
    assert.ok(sweep.equals(copy));
    copy.setAverages(9, 0);
    assert.equal(sweep.properties.averages[0], 5, 'copy is independent');
  });
});

describe('analytic tools', () => {
  it('finds zero crossings', () => {
    assert.deepEqual(zeroCrossings([]), []);
    assert.deepEqual(zeroCrossings([1, 1, -1, -1]), [2]);
    assert.deepEqual(zeroCrossings([-1, 0, 1]), [1]);
    assert.deepEqual(zeroCrossings([1, 0.1, -2]), [1]);
  });

  it('finds maxima and minima', () => {
    const data = [];
    for (let i = 0; i < 200; i += 1) data.push(Math.sin((i / 200) * 4 * Math.PI) * 10);
    const tops = maxima(data);
    const bottoms = minima(data);
    assert.equal(tops.length, 2);
    assert.equal(bottoms.length, 2);
    assert.ok(data[tops[0]] > 9);
    assert.ok(data[bottoms[0]] < -9);
  });

  it('takes values outwards from an index', () => {
    const data = [5, 1, 1, 1, 5];
    assert.deepEqual(takeFromIdx(data, 2, (_, v) => v < 3), [1, 2, 3]);
  });

  it('finds cutoff positions', () => {
    const gains = [-30, -20, -10, 0, -10, -20, -30];
    assert.equal(centerFromIdx(gains, 3), 3);
    assert.equal(cutOffLeft(gains, 3, 0, 3), 2);
    assert.equal(cutOffRight(gains, 3, 0, 3), 4);
    assert.equal(cutOffLeft(gains, 3, 0, 100), -1);
    assert.deepEqual(dipCutOffs(gains, 0, 3), [0, 6]);
  });

  it('computes roll-off per octave and decade', () => {
    const s21 = [
      new Datapoint(1000000, 10 ** (-10 / 20), 0),
      new Datapoint(10000000, 10 ** (-30 / 20), 0),
    ];
    const [octave, decade] = calculateRolloff(s21, 0, 1);
    assert.close(decade, 20, 1e-6);
    assert.close(octave, 20 * Math.log10(2), 1e-6);
    assert.ok(Number.isNaN(calculateRolloff(s21, 1, 1)[0]));
  });
});
