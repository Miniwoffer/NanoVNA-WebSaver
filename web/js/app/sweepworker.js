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

// The sweep runner, ported from NanoVNASaver/SweepWorker.py. The Python
// original is a QThread; here it is an async loop, which is all the
// concurrency a browser needs since the device work is I/O bound.

import { Datapoint } from '../rf/rftools.js';
import { SweepMode } from '../rf/sweep.js';
import { correctDelay } from '../rf/calibration.js';

const VALUE_MAX = 9.5;
const RETRIES_RECONNECT = 5;
const RETRIES_MAX = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Drop the values furthest from the average, as averaging asks. */
export function truncate(values, count) {
  const keep = values.length - count;
  if (count < 1 || keep < 1) return values;

  const points = values[0].length;
  const truncated = [];
  for (let i = 0; i < keep; i += 1) truncated.push(new Array(points));

  for (let p = 0; p < points; p += 1) {
    const column = values.map((row) => row[p]);
    let sumRe = 0;
    let sumIm = 0;
    for (const v of column) {
      sumRe += v.re;
      sumIm += v.im;
    }
    const avgRe = sumRe / column.length;
    const avgIm = sumIm / column.length;
    column.sort(
      (a, b) => Math.hypot(avgRe - a.re, avgIm - a.im) - Math.hypot(avgRe - b.re, avgIm - b.im),
    );
    for (let i = 0; i < keep; i += 1) truncated[i][p] = column[i];
  }
  return truncated;
}

/** Average a set of readings point by point. */
function average(values) {
  const points = values[0].length;
  const out = new Array(points);
  for (let p = 0; p < points; p += 1) {
    let re = 0;
    let im = 0;
    for (const row of values) {
      re += row[p].re;
      im += row[p].im;
    }
    out[p] = { re: re / values.length, im: im / values.length };
  }
  return out;
}

export class SweepError extends Error {}

export class SweepWorker {
  /**
   * @param {object} host provides the device, sweep, calibration and
   *   the callbacks the run reports through
   */
  constructor(host) {
    this.host = host;
    this.sweep = null;
    this.percentage = 0;
    this.data11 = [];
    this.data21 = [];
    this.rawData11 = [];
    this.rawData21 = [];
    this.errorMessage = '';
    this.offsetDelay = 0;

    this.running = false;
    this._stop = false;
    this._runPromise = null;
  }

  get stopping() {
    return this._stop;
  }

  /** Start a run. Resolves when the run has finished. */
  start() {
    if (this.running) throw new SweepError('A sweep is already running');
    this._stop = false;
    this.errorMessage = '';
    this.running = true;
    this._runPromise = this.#guardedRun().finally(() => {
      this.running = false;
    });
    return this._runPromise;
  }

  stop() {
    this._stop = true;
  }

  /** Resolve once any run in flight has finished. */
  async join() {
    if (this._runPromise) await this._runPromise.catch(() => {});
  }

  async #guardedRun() {
    try {
      await this.#run();
    } catch (error) {
      this.errorMessage = `ERROR during sweep\n\nStopped\n\n${error.message}`;
      this.host.onSweepError(this.errorMessage);
    } finally {
      this.host.onSweepFinished(this.errorMessage);
    }
  }

  async #run() {
    const device = this.host.device;
    if (!device || !device.connected) {
      this.errorMessage = 'Not connected to a device';
      this.host.onSweepError(this.errorMessage);
      return;
    }

    this.percentage = 0;
    this.#adoptSweep();

    const sweep = await this.#runLoop(device);

    if (sweep.segments > 1) {
      await device.resetSweep(sweep.start, sweep.end);
    }
    this.percentage = 100;
    this.host.onSweepProgress(this.percentage);
  }

  /**
   * Take up whatever range the application is currently asking for.
   *
   * The buffers are only rebuilt when the frequency grid itself moves.
   * Editing the sweep's name or its averaging leaves the points where
   * they are, and wiping the traces for that would be a visible glitch
   * for no reason.
   */
  #adoptSweep() {
    const wanted = this.host.sweep.copy();
    const previous = this.sweep;
    this.sweep = wanted;
    const sameGrid =
      previous &&
      previous.start === wanted.start &&
      previous.end === wanted.end &&
      previous.points === wanted.points &&
      previous.segments === wanted.segments &&
      previous.properties.logarithmic === wanted.properties.logarithmic;
    if (!sameGrid) this.initData();
  }

  /**
   * Run passes until asked to stop, returning the sweep of the last one.
   *
   * The range is re-read between passes rather than captured once, so
   * that changing start/stop -- from the sweep controls, the range bar or
   * a zoom drag on a chart -- reaches a continuous sweep without it having
   * to be stopped and started again. It is deliberately not re-read
   * between *segments*: updateData writes at `sweep.points * index`
   * offsets, so the point count must stay put for the whole pass.
   */
  async #runLoop(device) {
    for (;;) {
      const { sweep } = this;
      const averages =
        sweep.properties.mode === SweepMode.AVERAGE ? sweep.properties.averages[0] : 1;

      for (let i = 0; i < sweep.segments; i += 1) {
        if (this._stop) break;
        const [start, stop] = sweep.getIndexRange(i);

        const segment = await this.readAveragedSegment(device, start, stop, averages);
        if (!segment) break; // aborted part way through an average
        this.percentage = ((i + 1) * 100) / sweep.segments;
        this.updateData(segment.freq, segment.values11, segment.values21, i);
        // let the browser paint between segments
        await sleep(0);
      }
      if (sweep.properties.mode !== SweepMode.CONTINOUS || this._stop) return sweep;
      this.#adoptSweep();
    }
  }

  initData() {
    this.data11 = [];
    this.data21 = [];
    this.rawData11 = [];
    this.rawData21 = [];
    for (const freq of this.sweep.getFrequencies()) {
      this.data11.push(new Datapoint(freq, 0, 0));
      this.data21.push(new Datapoint(freq, 0, 0));
      this.rawData11.push(new Datapoint(freq, 0, 0));
      this.rawData21.push(new Datapoint(freq, 0, 0));
    }
  }

  updateData(frequencies, values11, values21, index) {
    const offset = this.sweep.points * index;

    const rawData11 = frequencies.map(
      (freq, i) => new Datapoint(freq, values11[i].re, values11[i].im),
    );
    const rawData21 = frequencies.map(
      (freq, i) => new Datapoint(freq, values21[i].re, values21[i].im),
    );

    const [data11, data21] = this.applyCalibration(rawData11, rawData21);
    for (let i = 0; i < frequencies.length; i += 1) {
      this.data11[offset + i] = data11[i];
      this.data21[offset + i] = data21[i];
      this.rawData11[offset + i] = rawData11[i];
      this.rawData21[offset + i] = rawData21[i];
    }

    this.host.saveData(this.data11, this.data21);
  }

  applyCalibration(rawData11, rawData21) {
    const calibration = this.host.calibration;
    let data11 = [];
    let data21 = [];

    if (!calibration.isCalculated) {
      data11 = rawData11.slice();
      data21 = rawData21.slice();
    } else if (calibration.isValid1Port()) {
      data11 = rawData11.map((dp) => calibration.correct11(dp));
    } else {
      data11 = rawData11.slice();
    }

    if (calibration.isCalculated && calibration.isValid2Port()) {
      data21 = rawData21.map((dp, i) => calibration.correct21(dp, rawData11[i]));
    } else if (!data21.length) {
      data21 = rawData21.slice();
    }

    if (this.offsetDelay !== 0) {
      data11 = data11.map((dp) => correctDelay(dp, this.offsetDelay, true));
      data21 = data21.map((dp) => correctDelay(dp, this.offsetDelay));
    }
    return [data11, data21];
  }

  async readAveragedSegment(device, start, stop, averages = 1) {
    let freq = [];
    const values11 = [];
    const values21 = [];

    for (let i = 0; i < averages; i += 1) {
      if (this._stop) {
        if (averages === 1) break;
        // a part finished average would bias the result
        return null;
      }

      let retries = RETRIES_RECONNECT;
      let tmp11 = [];
      let tmp21 = [];
      while (retries && !tmp11.length) {
        if (retries < RETRIES_RECONNECT) await sleep(500);
        retries -= 1;
        const segment = await this.readSegment(device, start, stop);
        freq = segment.frequencies;
        tmp11 = segment.values11;
        tmp21 = segment.values21;
      }
      if (!tmp11.length) throw new SweepError('Invalid data during sweep');

      values11.push(tmp11);
      values21.push(tmp21);
      this.percentage += 100 / (this.sweep.segments * averages);
      this.host.onSweepProgress(this.percentage);
      await sleep(0);
    }

    if (!values11.length) throw new SweepError('Invalid data during sweep');

    const truncates = this.sweep.properties.averages[1];
    if (truncates > 0 && averages > 1) {
      return {
        freq,
        values11: average(truncate(values11, truncates)),
        values21: average(truncate(values21, truncates)),
      };
    }
    return { freq, values11: average(values11), values21: average(values21) };
  }

  async readSegment(device, start, stop) {
    await device.setSweep(start, stop);
    const frequencies = await device.readFrequencies();
    const values11 = await this.readData(device, 'data 0');
    const values21 = await this.readData(device, 'data 1');
    if (frequencies.length !== values11.length || frequencies.length !== values21.length) {
      return { frequencies: [], values11: [], values21: [] };
    }
    return { frequencies, values11, values21 };
  }

  async readData(device, what) {
    let retries = RETRIES_MAX;
    while (retries) {
      retries -= 1;
      try {
        const result = await device.readValues(what);
        const implausible =
          device.validateInput && result.some((v) => Math.hypot(v.re, v.im) > VALUE_MAX);
        if (!implausible) return result;
      } catch {
        // fall through to the retry below
      }
      await sleep(200);
      await device.reconnect();
    }
    throw new SweepError(
      `Failed reading ${what} ${RETRIES_MAX} times.\n` +
        'Data outside expected valid ranges, or in an unexpected format.\n\n' +
        'You can disable data validation in the device settings.',
    );
  }
}
