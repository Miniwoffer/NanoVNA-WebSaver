/*
 *  NanoVNA-WebSaver -- tests for recording and replaying sweeps.
 *
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *  Licensed under the GNU General Public License v3 or later.
 *
 *  Not covered here (needs a real DOM, checked in a browser instead):
 *  the transport controls and the scrubber.
 */

import { assert, describe, it } from './harness.js';
import {
  RECORDING_VERSION,
  Recorder,
  RecordingError,
  decodeRecording,
  encodeRecording,
} from '../js/app/recorder.js';
import { Datapoint } from '../js/rf/rftools.js';
import { SweepWorker } from '../js/app/sweepworker.js';
import { Sweep, SweepMode } from '../js/rf/sweep.js';
import { Calibration } from '../js/rf/calibration.js';

const sweepData = (value, count = 5) =>
  Array.from({ length: count }, (_, i) => new Datapoint(1e6 + i * 1e6, value, value / 2));

describe('Recorder', () => {
  it('records nothing until it is started', () => {
    const recorder = new Recorder();
    assert.equal(recorder.capture({ s11: sweepData(0.1), s21: [] }), false);
    assert.equal(recorder.length, 0);
  });

  it('appends a frame per captured sweep, timed from the start', () => {
    const recorder = new Recorder();
    recorder.start();
    recorder.startedAt = 1000;
    recorder.capture({ s11: sweepData(0.1), s21: [] }, 1000);
    recorder.capture({ s11: sweepData(0.2), s21: [] }, 3500);
    assert.equal(recorder.length, 2);
    assert.equal(recorder.frames[0].t, 0);
    assert.equal(recorder.frames[1].t, 2500);
    assert.equal(recorder.duration, 2500);
  });

  it('ignores an empty sweep', () => {
    const recorder = new Recorder();
    recorder.start();
    assert.equal(recorder.capture({ s11: [], s21: [] }), false);
    assert.equal(recorder.length, 0);
  });

  it('times the run from its first sweep, not from arming', () => {
    const recorder = new Recorder();
    recorder.start();
    recorder.startedAt = 1000;
    // armed at 1000, but nothing arrives until 4000
    recorder.capture({ s11: sweepData(0.1), s21: [] }, 4000);
    recorder.capture({ s11: sweepData(0.2), s21: [] }, 6000);
    assert.equal(recorder.frames[0].t, 3000, 'before stopping, times are from arming');
    recorder.stop();
    assert.equal(recorder.frames[0].t, 0);
    assert.equal(recorder.frames[1].t, 2000);
    assert.equal(recorder.duration, 2000, 'the wait before the first sweep is not part of it');
    assert.equal(recorder.startedAt, 4000, 'the start moves to when recording really began');
  });

  it('stops appending once stopped', () => {
    const recorder = new Recorder();
    recorder.start();
    recorder.capture({ s11: sweepData(0.1), s21: [] });
    recorder.stop();
    recorder.capture({ s11: sweepData(0.2), s21: [] });
    assert.equal(recorder.length, 1);
  });

  it('takes a copy, so later sweeps do not rewrite recorded ones', () => {
    const recorder = new Recorder();
    recorder.start();
    const live = sweepData(0.1);
    recorder.capture({ s11: live, s21: [] });
    live.push(new Datapoint(9e6, 0.9, 0));
    assert.equal(recorder.frames[0].s11.length, 5);
  });

  it('starting again discards the previous run', () => {
    const recorder = new Recorder();
    recorder.start();
    recorder.capture({ s11: sweepData(0.1), s21: [] });
    recorder.start();
    assert.equal(recorder.length, 0);
  });
});

describe('the recording file format', () => {
  const make = () => {
    const recorder = new Recorder();
    recorder.start({ device: 'NanoVNA-H4', sweep: { start: 1e6, end: 5e6, points: 5, segments: 1 } });
    recorder.startedAt = 1000;
    recorder.capture({ s11: sweepData(0.1), s21: sweepData(0.3) }, 1000);
    recorder.capture({ s11: sweepData(0.2), s21: sweepData(0.4) }, 2000);
    return recorder;
  };

  it('round trips a recording', () => {
    const original = make();
    const back = decodeRecording(encodeRecording(original));
    assert.equal(back.frames.length, 2);
    assert.equal(back.device, 'NanoVNA-H4');
    assert.deepEqual(back.sweep, { start: 1e6, end: 5e6, points: 5, segments: 1 });
    assert.equal(back.frames[1].t, 1000);
    assert.equal(back.frames[0].s11.length, 5);
    assert.close(back.frames[0].s11[0].re, 0.1, 1e-12);
    assert.close(back.frames[0].s21[0].im, 0.15, 1e-12);
    assert.equal(back.frames[0].s11[0].freq, 1e6);
  });

  it('writes its version and application', () => {
    const written = JSON.parse(encodeRecording(make()));
    assert.equal(written.version, RECORDING_VERSION);
    assert.equal(written.application, 'NanoVNA-WebSaver');
    assert.ok(written.startedAt.includes('T'), 'the start is an ISO timestamp');
  });

  it('refuses a file that is not a recording', () => {
    assert.throws(() => decodeRecording('not json at all'), RecordingError);
    assert.throws(() => decodeRecording('{"hello": 1}'), RecordingError);
    assert.throws(() => decodeRecording('[]'), RecordingError);
  });

  it('refuses a recording from a newer version', () => {
    const text = JSON.stringify({ version: RECORDING_VERSION + 1, frames: [{ t: 0, s11: [[1, 0, 0]] }] });
    assert.throws(() => decodeRecording(text), RecordingError);
  });

  it('refuses a recording with no usable sweeps', () => {
    assert.throws(() => decodeRecording('{"frames": [{"t": 0, "s11": []}]}'), RecordingError);
  });

  it('drops malformed points rather than the whole run', () => {
    const text = JSON.stringify({
      version: 1,
      frames: [{ t: 0, s11: [[1e6, 0.1, 0], 'nonsense', [2e6, 0.2], [3e6, 0.3, 0.1]] }],
    });
    const back = decodeRecording(text);
    assert.equal(back.frames[0].s11.length, 2, 'the two well formed points survive');
  });

  it('numbers frames that arrive without a timestamp', () => {
    const text = JSON.stringify({
      version: 1,
      frames: [{ s11: [[1e6, 0.1, 0]] }, { s11: [[1e6, 0.2, 0]] }],
    });
    const back = decodeRecording(text);
    assert.equal(back.frames[0].t, 0);
    assert.equal(back.frames[1].t, 1000);
  });
});

describe('the sweepPass signal a recording is built from', () => {
  /** A device that answers from a table instead of a serial port. */
  class StubDevice {
    constructor() {
      this.connected = true;
      this.validateInput = false;
      this.datapoints = 11;
      this.start = 0;
      this.stop = 0;
    }

    async setSweep(start, stop) {
      this.start = start;
      this.stop = stop;
    }

    async resetSweep() {}

    async readFrequencies() {
      const step = (this.stop - this.start) / (this.datapoints - 1);
      return Array.from({ length: this.datapoints }, (_, i) => Math.round(this.start + i * step));
    }

    async readValues() {
      return Array.from({ length: this.datapoints }, () => ({ re: 0.25, im: 0 }));
    }

    async reconnect() {}
  }

  it('fires once per complete pass, not once per segment', async () => {
    const device = new StubDevice();
    const sweep = new Sweep({ start: 1e6, end: 2e6, points: 11, segments: 4 });
    let passes = 0;
    let saves = 0;
    const host = {
      device,
      sweep,
      calibration: new Calibration(),
      saveData() {
        saves += 1;
      },
      onSweepPass() {
        passes += 1;
      },
      onSweepProgress() {},
      onSweepError() {},
      onSweepFinished() {},
    };

    await new SweepWorker(host).start();

    assert.equal(saves, 4, 'one save per segment');
    assert.equal(passes, 1, 'but only one completed pass');
  });

  it('fires once per pass of a continuous sweep', async () => {
    const device = new StubDevice();
    const sweep = new Sweep({ start: 1e6, end: 2e6, points: 11, segments: 1 });
    sweep.setMode(SweepMode.CONTINOUS);
    let passes = 0;
    let worker;
    const host = {
      device,
      sweep,
      calibration: new Calibration(),
      saveData() {},
      onSweepPass() {
        passes += 1;
        if (passes >= 3) worker.stop();
      },
      onSweepProgress() {},
      onSweepError() {},
      onSweepFinished() {},
    };
    worker = new SweepWorker(host);

    await worker.start();
    assert.equal(passes, 3);
  });

  it('does not fire for a pass that was stopped part way', async () => {
    const device = new StubDevice();
    const sweep = new Sweep({ start: 1e6, end: 2e6, points: 11, segments: 4 });
    let passes = 0;
    let saves = 0;
    let worker;
    const host = {
      device,
      sweep,
      calibration: new Calibration(),
      saveData() {
        saves += 1;
        if (saves === 2) worker.stop();
      },
      onSweepPass() {
        passes += 1;
      },
      onSweepProgress() {},
      onSweepError() {},
      onSweepFinished() {},
    };
    worker = new SweepWorker(host);

    await worker.start();
    assert.equal(passes, 0, 'an interrupted pass is not a frame');
  });
});
