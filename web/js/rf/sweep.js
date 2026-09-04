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

// A port of NanoVNASaver/Settings/Sweep.py. The Python class guards its
// mutations with a lock; JavaScript is single threaded, so the lock is
// simply not needed here.

export const SweepMode = Object.freeze({
  SINGLE: 'SINGLE',
  CONTINOUS: 'CONTINOUS',
  AVERAGE: 'AVERAGE',
});

export class Sweep {
  constructor({
    start = 3600000,
    end = 30000000,
    points = 101,
    segments = 1,
    properties = {},
  } = {}) {
    this._start = start;
    this._end = end;
    this._points = points;
    this._segments = segments;
    this._properties = {
      name: '',
      mode: SweepMode.SINGLE,
      averages: [3, 0],
      logarithmic: false,
      ...properties,
    };
    this.check();
  }

  copy() {
    return new Sweep({
      start: this._start,
      end: this._end,
      points: this._points,
      segments: this._segments,
      properties: { ...this._properties, averages: [...this._properties.averages] },
    });
  }

  equals(other) {
    return (
      this.start === other.start &&
      this.end === other.end &&
      this.points === other.points &&
      this.segments === other.segments &&
      this.properties.name === other.properties.name &&
      this.properties.mode === other.properties.mode &&
      this.properties.logarithmic === other.properties.logarithmic &&
      this.properties.averages[0] === other.properties.averages[0] &&
      this.properties.averages[1] === other.properties.averages[1]
    );
  }

  get start() {
    return this._start;
  }

  get end() {
    return this._end;
  }

  get points() {
    return this._points;
  }

  get segments() {
    return this._segments;
  }

  get properties() {
    return this._properties;
  }

  get span() {
    return this.end - this.start;
  }

  get stepsize() {
    return Math.round(this.span / (this.points * this.segments - 1));
  }

  /** Every frequency the whole sweep will visit, in order. */
  get totalPoints() {
    return this.points * this.segments;
  }

  setPoints(points) {
    this._points = points;
    this.check();
  }

  update(start, end, segments, points) {
    this._start = Math.max(start, 1);
    this._end = Math.max(end, this._start);
    this._segments = Math.max(segments, 1);
    this._points = Math.max(points, 1);
    this.check();
  }

  setName(name) {
    this._properties.name = name;
  }

  setMode(mode) {
    if (!SweepMode[mode]) throw new RangeError(`Unknown sweep mode: ${mode}`);
    this._properties.mode = mode;
  }

  setAverages(amount, truncates) {
    this._properties.averages = [amount, truncates];
  }

  setLogarithmic(logarithmic) {
    this._properties.logarithmic = !!logarithmic;
  }

  check() {
    if (
      this.segments < 1 ||
      this.points < 1 ||
      this.start < 1 ||
      this.end < this.start ||
      this.stepsize < 0
    ) {
      throw new RangeError(`Illegal sweep settings: ${JSON.stringify(this.toJSON())}`);
    }
  }

  _expFactor(index) {
    return Math.exp(
      (Math.log((this.start + this.span) / this.start) / this.segments) * index,
    );
  }

  /** The [start, end] frequencies of one segment. */
  getIndexRange(index) {
    if (this.properties.logarithmic) {
      return [
        Math.round(this.start * this._expFactor(index)),
        Math.round(this.start * this._expFactor(index + 1)),
      ];
    }
    const start = this.start + index * this.points * this.stepsize;
    return [start, start + (this.points - 1) * this.stepsize];
  }

  /** Every frequency of the whole sweep, segment by segment. */
  getFrequencies() {
    const out = [];
    for (let i = 0; i < this.segments; i += 1) {
      const [start, stop] = this.getIndexRange(i);
      const step = (stop - start) / (this.points - 1);
      let freq = start;
      for (let j = 0; j < this.points; j += 1) {
        out.push(Math.round(freq));
        freq += step;
      }
    }
    return out;
  }

  toJSON() {
    return {
      start: this._start,
      end: this._end,
      points: this._points,
      segments: this._segments,
      name: this._properties.name,
      mode: this._properties.mode,
      averages: this._properties.averages,
      logarithmic: this._properties.logarithmic,
    };
  }

  static fromJSON(data) {
    return new Sweep({
      start: data.start,
      end: data.end,
      points: data.points,
      segments: data.segments,
      properties: {
        name: data.name ?? '',
        mode: data.mode ?? SweepMode.SINGLE,
        averages: data.averages ?? [3, 0],
        logarithmic: data.logarithmic ?? false,
      },
    });
  }
}
