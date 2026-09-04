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

// A port of NanoVNASaver/Touchstone.py, reading and writing Touchstone
// 1.1 s1p and s2p files.

import { Datapoint, cPolar } from './rftools.js';
import { interpolateTrace } from './interpolate.js';

const UNIT_TO_FACTOR = { ghz: 1e9, mhz: 1e6, khz: 1e3, hz: 1 };
const VALID_UNITS = Object.keys(UNIT_TO_FACTOR);
const VALID_PARAMETERS = 'syzgh';
const VALID_FORMATS = ['ma', 'db', 'ri'];

export class Options {
  constructor(unit = 'GHZ', parameter = 'S', tFormat = 'ma', resistance = 50) {
    this.unit = unit.toLowerCase();
    this.parameter = parameter.toLowerCase();
    this.format = tFormat.toLowerCase();
    this.resistance = resistance;
  }

  get factor() {
    return UNIT_TO_FACTOR[this.unit];
  }

  toString() {
    return `# ${this.unit} ${this.parameter} ${this.format} r ${this.resistance}`.toUpperCase();
  }

  /**
   * Read an option line. In Touchstone 1.1 every parameter is optional
   * and unordered; the line only has to start with "#".
   */
  parse(line) {
    if (!line.startsWith('#')) throw new TypeError(`Not an option line: ${line}`);
    let punit = false;
    let pparam = false;
    let pformat = false;
    let presist = false;
    const params = line.slice(1).toLowerCase().split(/\s+/).filter(Boolean);
    for (let i = 0; i < params.length; i += 1) {
      const p = params[i];
      if (VALID_UNITS.includes(p) && !punit) {
        this.unit = p;
        punit = true;
      } else if (VALID_PARAMETERS.includes(p) && p.length === 1 && !pparam) {
        this.parameter = p;
        pparam = true;
      } else if (VALID_FORMATS.includes(p) && !pformat) {
        this.format = p;
        pformat = true;
      } else if (p === 'r' && !presist) {
        i += 1;
        const value = parseFloat(params[i]);
        this.resistance = Number.isFinite(value) ? Math.round(value) : 50;
        presist = true;
      } else {
        throw new TypeError(`Illegal option line: ${line}`);
      }
    }
  }
}

export class Touchstone {
  static FIELD_ORDER = ['11', '21', '12', '22'];

  constructor(filename = '') {
    this.filename = filename;
    /** at most four data pairs, ordered s11, s21, s12, s22 */
    this.sdata = [[], [], [], []];
    this.comments = [];
    this.opts = new Options();
  }

  get s11() {
    return this.sdata[0];
  }

  set s11(value) {
    this.sdata[0] = value;
  }

  get s21() {
    return this.sdata[1];
  }

  set s21(value) {
    this.sdata[1] = value;
  }

  get s12() {
    return this.sdata[2];
  }

  set s12(value) {
    this.sdata[2] = value;
  }

  get s22() {
    return this.sdata[3];
  }

  set s22(value) {
    this.sdata[3] = value;
  }

  get r() {
    return this.opts.resistance;
  }

  s(name) {
    return this.sdata[Touchstone.FIELD_ORDER.indexOf(name)];
  }

  /** The interpolated value of one parameter at an arbitrary frequency. */
  sFreq(name, freq) {
    const data = this.s(name);
    if (!data.length) return new Datapoint(freq, 0, 0);
    return interpolateTrace(data, freq);
  }

  /** Swap the reflection and transmission ports. */
  swap() {
    this.sdata = [this.sdata[3], this.sdata[2], this.sdata[1], this.sdata[0]];
  }

  minFreq() {
    return this.s11.length ? this.s11[0].freq : 0;
  }

  maxFreq() {
    return this.s11.length ? this.s11[this.s11.length - 1].freq : 0;
  }

  /**
   * Parse Touchstone 1.1 text, appending to any data already held.
   *
   * @throws {TypeError} on malformed data
   */
  loads(text) {
    const lines = text.split(/\r?\n/);
    let index = 0;

    // leading comments, then the option line
    let optsLine = '';
    for (; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (line.startsWith('!')) {
        this.comments.push(line);
        continue;
      }
      if (line === '') continue;
      optsLine = line;
      index += 1;
      break;
    }
    this.opts.parse(optsLine);

    let needReorder = false;
    let prevFreq = 0.0;
    let prevLen = 0;

    for (; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (line === '') continue;
      if (line.startsWith('!')) {
        // a comment after the header is unusual but legal
        this.comments.push(line);
        continue;
      }

      // trailing comments are dropped
      const fields = line.split('!')[0].trim().split(/\s+/).filter(Boolean);
      if (!fields.length) continue;
      const freq = Math.round(parseFloat(fields[0]) * this.opts.factor);
      const data = fields.slice(1);
      if (!Number.isFinite(freq)) throw new TypeError(`Illegal frequency: ${line}`);
      if (data.length % 2 !== 0) throw new TypeError(`Data values aren't pairs: ${line}`);

      if (freq <= prevFreq) needReorder = true;
      prevFreq = freq;

      if (prevLen === 0) prevLen = data.length;
      else if (data.length !== prevLen) {
        throw new TypeError(`Inconsistent number of pairs: ${line}`);
      }

      this.#appendLineData(freq, data);
    }

    if (needReorder) {
      this.sdata.forEach((list) => list.sort((a, b) => a.freq - b.freq));
    }
    return this;
  }

  #appendLineData(freq, data) {
    for (let pair = 0; pair * 2 < data.length && pair < 4; pair += 1) {
      const a = parseFloat(data[pair * 2]);
      const b = parseFloat(data[pair * 2 + 1]);
      let point;
      if (this.opts.format === 'ri') {
        point = new Datapoint(freq, a, b);
      } else if (this.opts.format === 'ma') {
        const z = cPolar(a, (b * Math.PI) / 180);
        point = new Datapoint(freq, z.re, z.im);
      } else {
        // "db": magnitude in dB and angle in degrees
        const z = cPolar(10 ** (a / 20), (b * Math.PI) / 180);
        point = new Datapoint(freq, z.re, z.im);
      }
      this.sdata[pair].push(point);
    }
  }

  /**
   * Serialise as Touchstone text.
   *
   * @param {number} nrParams number of s-parameters: 1 for s1p, 4 for s2p
   */
  saves(nrParams = 1) {
    if (nrParams !== 1 && nrParams !== 4) {
      throw new TypeError('nrParams must be 1 or 4');
    }
    const out = ['# HZ S RI R 50'];
    for (let i = 0; i < this.s11.length; i += 1) {
      const dpS11 = this.s11[i];
      let row = `${dpS11.freq} ${dpS11.re} ${dpS11.im}`;
      for (let j = 1; j < nrParams; j += 1) {
        const dp = this.sdata[j][i];
        if (!dp || dp.freq !== dpS11.freq) {
          throw new RangeError('Frequencies of sdata not correlated');
        }
        row += ` ${dp.re} ${dp.im}`;
      }
      out.push(row);
    }
    return `${out.join('\n')}\n`;
  }
}
