/*
 *  NanoVNA-WebSaver -- tests for the ported analyses and the .cal format.
 *
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *  Licensed under the GNU General Public License v3 or later.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { assert, describe, it } from './harness.js';
import { ANALYSES, Context, AnalysisError, runAnalysis } from '../js/rf/analysis/index.js';
import { Calibration, CalDataSet } from '../js/rf/calibration.js';
import { Datapoint, reflectionCoefficient } from '../js/rf/rftools.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  readFileSync(join(HERE, 'data', name), 'utf-8');

/** A series RLC resonator seen at S11, resonant near 14.1 MHz. */
function resonator(points = 301, R = 25, L = 1e-6, C = 127e-12) {
  const out = [];
  for (let i = 0; i < points; i += 1) {
    const f = Math.round(10e6 + (i * (20e6 - 10e6)) / (points - 1));
    const w = 2 * Math.PI * f;
    const g = reflectionCoefficient({ re: R, im: w * L - 1 / (w * C) });
    out.push(new Datapoint(f, g.re, g.im));
  }
  return out;
}

/** A second order band pass at S21, centred on 15 MHz. */
function bandpass(points = 301, f0 = 15e6, Q = 8) {
  const out = [];
  for (let i = 0; i < points; i += 1) {
    const f = Math.round(10e6 + (i * (20e6 - 10e6)) / (points - 1));
    const x = Q * (f / f0 - f0 / f);
    const denom = 1 + x * x;
    out.push(new Datapoint(f, 1 / denom, -x / denom));
  }
  return out;
}

const rowsOf = (result) =>
  result.sections.flatMap((s) => s.rows.map((r) => `${r.label}=${r.value}`));

describe('analyses', () => {
  const s11 = resonator();
  const s21 = bandpass();
  const ctx = new Context({ s11, s21, markerLocations: [150, -1, -1] });

  it('offers every analysis the desktop application has', () => {
    assert.deepEqual(
      ANALYSES.map((a) => a.key).sort(),
      ['bandpass', 'bandstop', 'efhw', 'highpass', 'lowpass', 'magloop',
       'peak_search', 'resonance', 'simple_peak_search', 'vswr'],
    );
  });

  it('finds the resonance of an RLC resonator', () => {
    const result = runAnalysis('resonance', ctx);
    assert.equal(result.markers.length, 1);
    // resonance of a 1 uH / 127 pF series circuit
    const expected = 1 / (2 * Math.PI * Math.sqrt(1e-6 * 127e-12));
    assert.close(result.markers[0], expected, 40000, 'resonant frequency');
  });

  it('finds the VSWR dip and its span', () => {
    const result = runAnalysis('vswr', ctx, { vswrLimit: 3.0 });
    assert.equal(result.sections.length, 1);
    const rows = rowsOf(result);
    assert.ok(rows.some((r) => r.startsWith('Minimum=')), 'reports a minimum');
    assert.ok(rows.some((r) => r.startsWith('Span=')), 'reports a span');
    assert.equal(result.markers.length, 1);
  });

  it('reports nothing when no VSWR dip is low enough', () => {
    const result = runAnalysis('vswr', ctx, { vswrLimit: 1.01 });
    assert.equal(result.markers.length, 0);
    assert.ok(result.summary.startsWith('No areas found'));
  });

  it('rejects an out of range VSWR limit', () => {
    assert.throws(() => runAnalysis('vswr', ctx, { vswrLimit: 0.5 }));
  });

  it('finds the lowest VSWR point', () => {
    const result = runAnalysis('simple_peak_search', ctx,
                               { source: 'vswr', peakType: 'lowest' });
    const vswrs = s11.map((d) => d.vswr);
    const lowest = vswrs.indexOf(Math.min(...vswrs));
    assert.equal(result.markers[0], s11[lowest].freq);
  });

  it('finds the S21 gain peak', () => {
    const result = runAnalysis('peak_search', ctx,
                               { source: 'gain', peakType: 'highest', count: 2 });
    assert.ok(result.markers.length >= 1);
    assert.close(result.markers[0], 15e6, 100000, 'band pass centre');
  });

  it('characterises a band pass filter', () => {
    const result = runAnalysis('bandpass', ctx);
    const rows = rowsOf(result);
    const centre = rows.find((r) => r.startsWith('Center frequency='));
    const q = rows.find((r) => r.startsWith('Quality factor='));
    assert.ok(centre.includes('14.9') || centre.includes('15.0'), centre);
    // the modelled Q is 8
    const qValue = parseFloat(q.split('=')[1]);
    assert.close(qValue, 8, 0.5, 'quality factor');
    assert.equal(result.markers.length, 3, 'centre and both -3 dB points');
  });

  it('characterises high pass and low pass filters', () => {
    const high = runAnalysis('highpass', ctx);
    const low = runAnalysis('lowpass', ctx);
    assert.ok(rowsOf(high)[0].startsWith('Cutoff frequency='));
    assert.ok(rowsOf(low)[0].startsWith('Cutoff frequency='));
    // the lower -3 dB point sits below the upper one
    assert.ok(high.markers[1] < low.markers[1], 'cutoffs on opposite sides');
  });

  it('characterises a band stop filter', () => {
    const result = runAnalysis('bandstop', ctx);
    assert.ok(rowsOf(result).some((r) => r.startsWith('Center frequency=')));
  });

  it('asks for a marker when a filter analysis needs one', () => {
    const noMarker = new Context({ s11, s21, markerLocations: [-1] });
    assert.throws(() => runAnalysis('bandpass', noMarker));
    assert.throws(() => runAnalysis('highpass', noMarker));
  });

  it('refuses to analyse a filter without S21', () => {
    const noS21 = new Context({ s11, s21: [], markerLocations: [150] });
    assert.throws(() => runAnalysis('bandpass', noS21));
  });

  it('proposes a narrower sweep when tuning a magnetic loop', () => {
    const result = runAnalysis('magloop', ctx, { vswrLimit: 3.0 });
    assert.ok(result.suggestedSweep, 'proposes a sweep');
    assert.ok(result.suggestedSweep.start < result.suggestedSweep.end);
    assert.ok(result.suggestedSweep.start >= 1);
  });

  it('reports EFHW resonances', () => {
    const result = runAnalysis('efhw', ctx);
    assert.ok(result.markers.length >= 1);
    assert.ok(result.summary.includes('phase crossing'));
  });

  it('rejects an unknown analysis', () => {
    assert.throws(() => runAnalysis('nonsense', ctx));
  });

  it('refuses to analyse with no data', () => {
    const empty = new Context({});
    for (const analysis of ANALYSES) {
      let threw = false;
      try {
        analysis.run(empty, {});
      } catch (error) {
        threw = error instanceof AnalysisError;
      }
      assert.ok(threw, `${analysis.key} reports missing data`);
    }
  });
});

describe('calibration files', () => {
  it('reads a one port cal file', () => {
    const cal = new Calibration();
    cal.loads(fixture('test_1port_fixed.cal'), 'test_1port_fixed.cal');
    assert.ok(cal.isValid1Port(), 'one port complete');
    assert.equal(cal.isValid2Port(), false, 'not a two port cal');
    assert.ok(cal.size() > 0);
    assert.equal(cal.source, 'test_1port_fixed.cal');
  });

  it('reads a two port cal file and solves it', () => {
    const cal = new Calibration();
    cal.loads(fixture('test_2port_long.cal'));
    assert.ok(cal.isValid1Port());
    assert.ok(cal.isValid2Port());
    cal.calElement.shortState = 'IDEAL';
    cal.calElement.openState = 'IDEAL';
    cal.calElement.loadState = 'IDEAL';
    cal.calcCorrections();
    assert.ok(cal.isCalculated);
    const dp = new Datapoint(cal.dataset.freqMin(), 0.1, 0.1);
    const corrected = cal.correct11(dp);
    assert.ok(Number.isFinite(corrected.re), 'correction produces a number');
    assert.ok(Number.isFinite(cal.correct21(dp, dp).re));
  });

  it('reads a file whose header promises more than its data', () => {
    // test_1port_broken.cal carries a two port header above one port
    // data; the desktop application reads it as a valid one port
    // calibration, and so does this one
    const cal = new Calibration();
    cal.loads(fixture('test_1port_broken.cal'));
    assert.equal(cal.size(), 101);
    assert.ok(cal.isValid1Port());
    assert.equal(cal.isValid2Port(), false);
    for (const name of ['short', 'open', 'load']) {
      assert.equal(cal.dataSize(name), 101, name);
    }
    for (const name of ['through', 'thrurefl', 'isolation']) {
      assert.equal(cal.dataSize(name), 0, name);
    }
  });

  it('refuses to solve without short, open and load', () => {
    const cal = new Calibration();
    cal.insert('short', [new Datapoint(1e6, -1, 0)]);
    assert.throws(() => cal.calcCorrections());
  });

  it('round trips through the cal file format', () => {
    const cal = new Calibration();
    cal.loads(fixture('test_2port_long.cal'));
    cal.notes = ['a note', 'and another'];
    const text = cal.saves();

    const again = new Calibration();
    again.loads(text);
    assert.equal(again.size(), cal.size());
    assert.ok(again.isValid2Port());
    assert.deepEqual(again.notes, cal.notes);
    const freq = cal.dataset.freqMin();
    assert.close(again.dataset.get(freq).short.re, cal.dataset.get(freq).short.re, 1e-12);
    assert.close(again.dataset.get(freq).isolation.im,
                 cal.dataset.get(freq).isolation.im, 1e-12);
  });

  it('counts the measured standards', () => {
    const cal = new Calibration();
    cal.loads(fixture('test_2port_long.cal'));
    const points = cal.size();
    for (const name of ['short', 'open', 'load', 'through', 'thrurefl', 'isolation']) {
      assert.equal(cal.dataSize(name), points, `${name} measured everywhere`);
    }
    cal.remove('through');
    assert.equal(cal.dataSize('through'), 0);
    assert.equal(cal.isValid2Port(), false);
    assert.ok(cal.isValid1Port(), 'the one port cal survives');
  });

  it('treats old files that omit thrurefl as isolation data', () => {
    const set = new CalDataSet().fromString(
      '# Hz ShortR ShortI OpenR OpenI LoadR LoadI ThroughR ThroughI ThrureflR ThrureflI\n' +
      '1000000 -1 0 1 0 0 0 1 0 0.5 0.25\n',
    );
    const entry = set.get(1000000);
    assert.equal(entry.thrurefl, null, 'the third pair is read as isolation');
    assert.close(entry.isolation.re, 0.5, 1e-12);
    assert.close(entry.isolation.im, 0.25, 1e-12);
  });
});
