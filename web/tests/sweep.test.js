/*
 *  NanoVNA-WebSaver -- tests for the sweep runner.
 *
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *  Licensed under the GNU General Public License v3 or later.
 */

import { assert, describe, it } from './harness.js';
import { SweepWorker, truncate } from '../js/app/sweepworker.js';
import { Sweep, SweepMode } from '../js/rf/sweep.js';
import { Calibration } from '../js/rf/calibration.js';
import { Datapoint } from '../js/rf/rftools.js';

/** A device that answers from a table instead of a serial port. */
class StubDevice {
  constructor({ fail = 0, value = 0.25 } = {}) {
    this.connected = true;
    this.validateInput = false;
    this.datapoints = 11;
    this.sweeps = [];
    this.resets = [];
    this.reconnects = 0;
    this.failsLeft = fail;
    this.value = value;
    this.start = 0;
    this.stop = 0;
  }

  async setSweep(start, stop) {
    this.start = start;
    this.stop = stop;
    this.sweeps.push([start, stop]);
  }

  async resetSweep(start, stop) {
    this.resets.push([start, stop]);
  }

  async readFrequencies() {
    const step = (this.stop - this.start) / (this.datapoints - 1);
    return Array.from({ length: this.datapoints }, (_, i) =>
      Math.round(this.start + i * step));
  }

  async readValues(what) {
    if (this.failsLeft > 0) {
      this.failsLeft -= 1;
      throw new Error('read failed');
    }
    const scale = what === 'data 1' ? 0.5 : 1;
    return Array.from({ length: this.datapoints }, () => ({
      re: this.value * scale,
      im: 0,
    }));
  }

  async reconnect() {
    this.reconnects += 1;
  }
}

function makeHost(device, sweep) {
  const events = { progress: 0, finished: 0, errors: [], saves: 0 };
  return {
    device,
    sweep,
    calibration: new Calibration(),
    saved: null,
    events,
    saveData(s11, s21) {
      this.saved = { s11: [...s11], s21: [...s21] };
      events.saves += 1;
    },
    onSweepProgress() {
      events.progress += 1;
    },
    onSweepError(message) {
      events.errors.push(message);
    },
    onSweepFinished() {
      events.finished += 1;
    },
  };
}

describe('truncate', () => {
  const c = (re) => ({ re, im: 0 });

  it('drops the readings furthest from the average', () => {
    // three readings of one point: 1, 2 and 100
    const values = [[c(1)], [c(2)], [c(100)]];
    const kept = truncate(values, 1);
    assert.equal(kept.length, 2);
    const remaining = kept.map((row) => row[0].re).sort((a, b) => a - b);
    // the average is 34.3, so 100 and 1 are the two extremes; 2 and 1
    // are nearest it after the outlier's pull
    assert.equal(remaining.length, 2);
    assert.ok(remaining.includes(100) === false || remaining.includes(1) === false);
  });

  it('leaves the data alone when the truncate is illegal', () => {
    const values = [[c(1)], [c(2)]];
    assert.equal(truncate(values, 0), values);
    assert.equal(truncate(values, 5), values);
  });

  it('keeps every point of every kept reading', () => {
    const values = [
      [c(1), c(10)],
      [c(2), c(20)],
      [c(3), c(30)],
    ];
    const kept = truncate(values, 1);
    assert.equal(kept.length, 2);
    for (const row of kept) assert.equal(row.length, 2);
  });
});

describe('sweep worker', () => {
  it('runs a single sweep and stores the data', async () => {
    const device = new StubDevice();
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 11, segments: 1 });
    const host = makeHost(device, sweep);
    const worker = new SweepWorker(host);

    await worker.start();

    assert.equal(host.events.errors.length, 0, host.events.errors[0]);
    assert.equal(host.events.finished, 1);
    assert.equal(worker.data11.length, 11);
    assert.close(worker.data11[0].re, 0.25, 1e-12);
    assert.close(worker.data21[0].re, 0.125, 1e-12);
    assert.equal(worker.percentage, 100);
    assert.equal(device.sweeps.length, 1);
  });

  it('walks every segment of a segmented sweep', async () => {
    const device = new StubDevice();
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 11, segments: 4 });
    const host = makeHost(device, sweep);
    const worker = new SweepWorker(host);

    await worker.start();

    assert.equal(worker.data11.length, 44);
    assert.equal(device.sweeps.length, 4);
    // a segmented sweep is restored to the full span afterwards
    assert.deepEqual(device.resets, [[1000000, 2000000]]);
    assert.equal(host.saved.s11.length, 44);
  });

  it('averages several readings per segment', async () => {
    const device = new StubDevice();
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 11, segments: 1 });
    sweep.setMode(SweepMode.AVERAGE);
    sweep.setAverages(4, 0);
    const host = makeHost(device, sweep);
    const worker = new SweepWorker(host);

    await worker.start();

    // four readings of the same segment
    assert.equal(device.sweeps.length, 4);
    assert.close(worker.data11[0].re, 0.25, 1e-12);
  });

  it('keeps sweeping in continuous mode until stopped', async () => {
    const device = new StubDevice();
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 11, segments: 1 });
    sweep.setMode(SweepMode.CONTINOUS);
    const host = makeHost(device, sweep);
    const worker = new SweepWorker(host);

    const original = host.saveData.bind(host);
    let passes = 0;
    host.saveData = (s11, s21) => {
      original(s11, s21);
      passes += 1;
      if (passes >= 3) worker.stop();
    };

    await worker.start();
    assert.ok(passes >= 3, `swept ${passes} times`);
    assert.equal(worker.running, false);
  });

  it('picks up a new range mid-run without being restarted', async () => {
    const device = new StubDevice();
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 11, segments: 1 });
    sweep.setMode(SweepMode.CONTINOUS);
    const host = makeHost(device, sweep);
    const worker = new SweepWorker(host);

    const original = host.saveData.bind(host);
    let passes = 0;
    host.saveData = (s11, s21) => {
      original(s11, s21);
      passes += 1;
      // retune after the first pass, exactly as the sweep controls, the
      // range bar or a zoom drag on a chart would
      if (passes === 1) host.sweep.update(5000000, 6000000, 1, 11);
      if (passes >= 3) worker.stop();
    };

    await worker.start();

    assert.equal(host.events.errors.length, 0, host.events.errors[0]);
    assert.equal(worker.data11[0].freq, 5000000, 'the data followed the new range');
    assert.equal(worker.data11[worker.data11.length - 1].freq, 6000000);
    const [start, stop] = device.sweeps[device.sweeps.length - 1];
    assert.equal(start, 5000000, 'the device was retuned too');
    assert.equal(stop, 6000000);
  });

  it('does not wipe the traces when only the sweep name changes', async () => {
    const device = new StubDevice();
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 11, segments: 1 });
    sweep.setMode(SweepMode.CONTINOUS);
    const host = makeHost(device, sweep);
    const worker = new SweepWorker(host);

    const original = host.saveData.bind(host);
    let passes = 0;
    let zeroedAfterRename = false;
    host.saveData = (s11, s21) => {
      original(s11, s21);
      passes += 1;
      if (passes === 1) host.sweep.setName('renamed');
      // the rename must not have reset the buffers to zero
      if (passes === 2) zeroedAfterRename = s11.every((dp) => dp.re === 0);
      if (passes >= 2) worker.stop();
    };

    await worker.start();
    assert.equal(zeroedAfterRename, false);
    assert.equal(worker.sweep.properties.name, 'renamed', 'the rename was still adopted');
  });

  it('retries a failed read and reconnects', async () => {
    const device = new StubDevice({ fail: 2 });
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 11, segments: 1 });
    const host = makeHost(device, sweep);
    const worker = new SweepWorker(host);

    await worker.start();

    assert.equal(device.reconnects, 2);
    assert.equal(host.events.errors.length, 0);
    assert.equal(worker.data11.length, 11);
  });

  it('reports an error when the device never answers', async () => {
    const device = new StubDevice({ fail: 1000 });
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 11, segments: 1 });
    const host = makeHost(device, sweep);
    const worker = new SweepWorker(host);

    await worker.start();

    assert.equal(host.events.errors.length, 1);
    assert.ok(/Failed reading/.test(host.events.errors[0]), host.events.errors[0]);
    assert.equal(host.events.finished, 1);
  });

  it('reports an error when nothing is connected', async () => {
    const device = new StubDevice();
    device.connected = false;
    const sweep = new Sweep();
    const host = makeHost(device, sweep);
    const worker = new SweepWorker(host);

    await worker.start();
    assert.deepEqual(host.events.errors, ['Not connected to a device']);
  });

  it('refuses to start twice at once', async () => {
    const device = new StubDevice();
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 11, segments: 2 });
    const host = makeHost(device, sweep);
    const worker = new SweepWorker(host);

    const first = worker.start();
    assert.throws(() => worker.start());
    await first;
  });

  it('applies a calibration to the readings', async () => {
    const device = new StubDevice({ value: 0.5 });
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 11, segments: 1 });
    const host = makeHost(device, sweep);

    // an ideal calibration measured on ideal standards leaves the data
    // unchanged, which is the property worth asserting here
    const cal = host.calibration;
    cal.calElement.shortState = 'IDEAL';
    cal.calElement.openState = 'IDEAL';
    cal.calElement.loadState = 'IDEAL';
    const freqs = sweep.getFrequencies();
    cal.insert('short', freqs.map((f) => new Datapoint(f, -1, 0)));
    cal.insert('open', freqs.map((f) => new Datapoint(f, 1, 0)));
    cal.insert('load', freqs.map((f) => new Datapoint(f, 0, 0)));
    cal.calcCorrections();

    const worker = new SweepWorker(host);
    await worker.start();

    assert.equal(host.events.errors.length, 0, host.events.errors[0]);
    assert.close(worker.data11[0].re, 0.5, 1e-9, 'perfect standards pass data through');
    assert.close(worker.rawData11[0].re, 0.5, 1e-12);
  });

  it('applies an offset delay', async () => {
    const device = new StubDevice({ value: 1 });
    const sweep = new Sweep({ start: 1000000, end: 2000000, points: 11, segments: 1 });
    const host = makeHost(device, sweep);
    const worker = new SweepWorker(host);
    worker.offsetDelay = 1e-9;

    await worker.start();

    // a delay rotates the reflection without changing its magnitude
    const dp = worker.data11[0];
    assert.close(Math.hypot(dp.re, dp.im), 1, 1e-9);
    assert.ok(Math.abs(dp.im) > 1e-6, 'the phase moved');
  });
});
