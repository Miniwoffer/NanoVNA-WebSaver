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

// A port of NanoVNASaver/Calibration.py: the SOLT solver, the
// calibration kit models and the .cal file format.

import {
  Datapoint,
  cAdd,
  cDiv,
  cExp,
  cMul,
  cScale,
  cSub,
  cSquare,
  cx,
} from './rftools.js';
import { ComplexInterpolator } from './interpolate.js';

export const IDEAL_SHORT = cx(-1, 0);
export const IDEAL_OPEN = cx(1, 0);
export const IDEAL_LOAD = cx(0, 0);
export const IDEAL_THROUGH = cx(1, 0);

export const STANDARDS = ['short', 'open', 'load', 'through', 'thrurefl', 'isolation'];
/** Which trace each standard is measured from. */
export const STANDARDS_FROM_S21 = new Set(['through', 'isolation']);

const RXP_CAL_HEADER =
  /^#\s+Hz\s+ShortR\s+ShortI\s+OpenR\s+OpenI\s+LoadR\s+LoadI(\s+ThroughR\s+ThroughI)?(\s+ThrureflR\s+ThrureflI)?(\s+IsolationR\s+IsolationI)?\s*$/i;

const RXP_CAL_LINE = new RegExp(
  '^\\s*(\\d+)\\s+' +
    '([-0-9Ee.]+)\\s+([-0-9Ee.]+)\\s+' + // short
    '([-0-9Ee.]+)\\s+([-0-9Ee.]+)\\s+' + // open
    '([-0-9Ee.]+)\\s+([-0-9Ee.]+)' + // load
    '(?:\\s+([-0-9Ee.]+)\\s+([-0-9Ee.]+))?' + // through
    '(?:\\s+([-0-9Ee.]+)\\s+([-0-9Ee.]+))?' + // thrurefl
    '(?:\\s+([-0-9Ee.]+)\\s+([-0-9Ee.]+))?' + // isolation
    '\\s*$',
);

/** Shift a data point by an electrical delay. */
export function correctDelay(dp, delay, reflect = false) {
  const mult = reflect ? 2 : 1;
  const corrected = cMul(
    dp.z,
    cExp(cx(0, 2 * Math.PI * dp.freq * delay * -1 * mult)),
  );
  return new Datapoint(dp.freq, corrected.re, corrected.im);
}

/** The measured standards and solved error terms at one frequency. */
export class CalData {
  constructor(freq = 0) {
    this.freq = freq;
    this.short = null;
    this.open = null;
    this.load = null;
    this.through = null;
    this.thrurefl = null;
    this.isolation = null;

    this.e00 = cx(0); // directivity
    this.e11 = cx(0); // port 1 match
    this.deltaE = cx(0); // tracking
    this.e10e01 = cx(0); // forward reflection tracking
    // two port
    this.e30 = cx(0); // forward isolation
    this.e22 = cx(0); // port 2 match
    this.e10e32 = cx(0); // forward transmission
  }

  toString() {
    const pair = (c) => `${c.re} ${c.im}`;
    let out = `${this.freq} ${pair(this.short)} ${pair(this.open)} ${pair(this.load)}`;
    if (this.through) {
      out += ` ${pair(this.through)} ${pair(this.thrurefl)} ${pair(this.isolation)}`;
    }
    return out;
  }
}

/** Every frequency a calibration was measured at. */
export class CalDataSet {
  constructor() {
    this.notes = '';
    this.data = new Map();
  }

  #entry(freq) {
    let cal = this.data.get(freq);
    if (!cal) {
      cal = new CalData(freq);
      this.data.set(freq, cal);
    }
    return cal;
  }

  insert(name, dp) {
    if (!STANDARDS.includes(name)) throw new RangeError(name);
    this.#entry(dp.freq)[name] = dp.z;
  }

  frequencies() {
    return [...this.data.keys()].sort((a, b) => a - b);
  }

  freqMin() {
    const f = this.frequencies();
    return f.length ? f[0] : 0;
  }

  freqMax() {
    const f = this.frequencies();
    return f.length ? f[f.length - 1] : 0;
  }

  get(freq) {
    return this.data.get(freq);
  }

  /** Entries in ascending frequency order. */
  values() {
    return this.frequencies().map((freq) => this.data.get(freq));
  }

  /** How many frequencies carry a measurement of one standard. */
  sizeOf(name) {
    let count = 0;
    for (const cal of this.data.values()) if (cal[name]) count += 1;
    return count;
  }

  complete1Port() {
    if (!this.data.size) return false;
    for (const cal of this.data.values()) {
      if (!cal.short || !cal.open || !cal.load) return false;
    }
    return true;
  }

  complete2Port() {
    if (!this.complete1Port()) return false;
    for (const cal of this.data.values()) {
      if (!cal.through || !cal.thrurefl || !cal.isolation) return false;
    }
    return true;
  }

  toString() {
    if (!this.complete1Port()) return '';
    const lines = ['# Calibration data for NanoVNA-Saver'];
    for (const note of this.notes.split('\n')) lines.push(`! ${note}`);
    lines.push(
      '# Hz ShortR ShortI OpenR OpenI LoadR LoadI' +
        (this.complete2Port()
          ? ' ThroughR ThroughI ThrureflR ThrureflI IsolationR IsolationI'
          : ''),
    );
    for (const freq of this.frequencies()) lines.push(this.data.get(freq).toString());
    return `${lines.join('\n')}\n`;
  }

  /** Read a .cal file. Unreadable lines are skipped with a warning. */
  fromString(text) {
    this.notes = '';
    this.data = new Map();
    let header = '';
    const warnings = [];

    text.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith('!')) {
        this.notes += `${line.slice(2)}\n`;
        return;
      }
      const headerMatch = RXP_CAL_HEADER.exec(line);
      if (headerMatch) {
        if (header) warnings.push(`Duplicate header in cal data. ${i + 1}: ${line}`);
        header = headerMatch[1] ? 'through' : 'sol';
        return;
      }
      if (!line || line.startsWith('#')) return;

      const m = RXP_CAL_LINE.exec(line);
      if (!m) {
        warnings.push(`Illegal caldata. Line ${i + 1}: ${line}`);
        return;
      }
      if (!header) warnings.push(`Caldata without having read header: ${i + 1}: ${line}`);
      this.#appendMatch(m, header, i + 1, line, warnings);
    });

    this.warnings = warnings;
    return this;
  }

  #appendMatch(m, header, lineNr, line, warnings) {
    const freq = parseInt(m[1], 10);
    const cal = {
      short: [m[2], m[3]],
      open: [m[4], m[5]],
      load: [m[6], m[7]],
      through: [m[8], m[9]],
      thrurefl: [m[10], m[11]],
      isolation: [m[12], m[13]],
    };

    if (cal.through[0] !== undefined && header === 'sol') {
      warnings.push(`Through data with sol header. ${lineNr}: ${line}`);
    }
    // older files wrote isolation where thrurefl now sits
    if (cal.thrurefl[0] !== undefined && cal.isolation[0] === undefined) {
      cal.isolation = cal.thrurefl;
      cal.thrurefl = [undefined, undefined];
    }

    for (const name of STANDARDS) {
      const [re, im] = cal[name];
      if (re === undefined || im === undefined) continue;
      this.insert(name, new Datapoint(freq, parseFloat(re), parseFloat(im)));
    }
  }
}

/** The calibration kit definition. */
export function newCalElement() {
  return {
    shortState: '',
    shortTouchstone: null,
    shortIsIdeal: true,
    shortL0: 5.7e-12,
    shortL1: -8.96e-20,
    shortL2: -1.1e-29,
    shortL3: -4.12e-37,
    shortLength: -34.2, // ps

    openState: '',
    openTouchstone: null,
    openIsIdeal: true,
    openC0: 2.1e-14,
    openC1: 5.67e-23,
    openC2: -2.39e-31,
    openC3: 2.0e-40,
    openLength: 0.0,

    loadState: '',
    loadTouchstone: null,
    loadIsIdeal: true,
    loadR: 50.0,
    loadL: 0.0,
    loadC: 0.0,
    loadLength: 0.0,

    throughIsIdeal: true,
    throughLength: 0.0,
  };
}

export class CalibrationError extends Error {}

export class Calibration {
  constructor() {
    this.notes = [];
    this.dataset = new CalDataSet();
    this.calElement = newCalElement();
    this.interp = null;
    this.isCalculated = false;
    this.source = 'Manual';
  }

  insert(name, data) {
    for (const dp of data) this.dataset.insert(name, dp);
  }

  /** Forget one measured standard. */
  remove(name) {
    for (const cal of this.dataset.data.values()) cal[name] = null;
    for (const [freq, cal] of [...this.dataset.data.entries()]) {
      if (STANDARDS.every((s) => !cal[s])) this.dataset.data.delete(freq);
    }
    this.isCalculated = false;
    this.interp = null;
  }

  reset() {
    this.dataset = new CalDataSet();
    this.notes = [];
    this.interp = null;
    this.isCalculated = false;
    this.source = 'Manual';
  }

  size() {
    return this.dataset.frequencies().length;
  }

  dataSize(name) {
    return this.dataset.sizeOf(name);
  }

  isValid1Port() {
    return this.dataset.complete1Port();
  }

  isValid2Port() {
    return this.dataset.complete2Port();
  }

  #calcPort1(cal) {
    const g1 = this.gammaShort(cal.freq);
    const g2 = this.gammaOpen(cal.freq);
    const g3 = this.gammaLoad(cal.freq);

    const gm1 = cal.short;
    const gm2 = cal.open;
    const gm3 = cal.load;

    // denominator =
    //   g1*(g2-g3)*gm1 + g2*g3*gm2 - g2*g3*gm3 - (g2*gm2 - g3*gm3)*g1
    const g2g3 = cMul(g2, g3);
    const denominator = cSub(
      cAdd(
        cSub(cMul(cMul(g1, cSub(g2, g3)), gm1), cMul(g2g3, gm3)),
        cMul(g2g3, gm2),
      ),
      cMul(cSub(cMul(g2, gm2), cMul(g3, gm3)), g1),
    );

    if (denominator.re === 0 && denominator.im === 0) {
      throw new CalibrationError(
        `Two of short, open and load returned the same values at frequency ${cal.freq}Hz.`,
      );
    }

    // e00 = -(((g2*gm3 - g3*gm3)*g1*gm2
    //          - (g2*g3*gm2 - g2*g3*gm3 - (g3*gm2 - g2*gm3)*g1)*gm1)) / denom
    const termA = cMul(cMul(cSub(cMul(g2, gm3), cMul(g3, gm3)), g1), gm2);
    const termB = cMul(
      cSub(
        cSub(cMul(g2g3, gm2), cMul(g2g3, gm3)),
        cMul(cSub(cMul(g3, gm2), cMul(g2, gm3)), g1),
      ),
      gm1,
    );
    cal.e00 = cDiv(cScale(cSub(termA, termB), -1), denominator);

    // e11 = ((g2-g3)*gm1 - g1*(gm2-gm3) + g3*gm2 - g2*gm3) / denom
    cal.e11 = cDiv(
      cAdd(
        cSub(cMul(cSub(g2, g3), gm1), cMul(g1, cSub(gm2, gm3))),
        cSub(cMul(g3, gm2), cMul(g2, gm3)),
      ),
      denominator,
    );

    // delta_e = -(((g1*(gm2-gm3) - g2*gm2 + g3*gm3)*gm1
    //              + (g2*gm3 - g3*gm3)*gm2)) / denom
    const termC = cMul(
      cAdd(cSub(cMul(g1, cSub(gm2, gm3)), cMul(g2, gm2)), cMul(g3, gm3)),
      gm1,
    );
    const termD = cMul(cSub(cMul(g2, gm3), cMul(g3, gm3)), gm2);
    cal.deltaE = cDiv(cScale(cAdd(termC, termD), -1), denominator);
  }

  #calcPort2(cal) {
    const gt = this.gammaThrough(cal.freq);
    const gt2 = cSquare(gt);

    const gm4 = cal.through;
    const gm5 = cal.thrurefl;
    const gm6 = cal.isolation;
    const gm7 = cSub(gm5, cal.e00);

    cal.e30 = cal.isolation;
    cal.e10e01 = cSub(cMul(cal.e00, cal.e11), cal.deltaE);
    cal.e22 = cDiv(
      gm7,
      cAdd(cMul(cMul(gm7, cal.e11), gt2), cMul(cal.e10e01, gt2)),
    );
    cal.e10e32 = cDiv(
      cMul(cSub(gm4, gm6), cSub(cx(1), cMul(cMul(cal.e11, cal.e22), gt2))),
      gt,
    );
  }

  /** Solve the error terms. Throws when the data is insufficient. */
  calcCorrections() {
    if (!this.isValid1Port()) {
      throw new CalibrationError(
        'All of short, open and load calibration steps must be completed' +
          ' for calibration to be applied.',
      );
    }
    for (const cal of this.dataset.values()) {
      this.#calcPort1(cal);
      if (this.isValid2Port()) this.#calcPort2(cal);
    }
    this.genInterpolation();
    this.isCalculated = true;
  }

  gammaShort(freq) {
    const el = this.calElement;
    if (el.shortState === 'IDEAL') return IDEAL_SHORT;
    if (el.shortState === 'FILE' && el.shortTouchstone) {
      const dp = el.shortTouchstone.sFreq('11', freq);
      return cx(dp.re, dp.im);
    }
    // Referencing https://arxiv.org/pdf/1606.02446.pdf (18) - (21)
    const zsp = cx(
      0.0,
      2.0 *
        Math.PI *
        freq *
        (el.shortL0 + el.shortL1 * freq + el.shortL2 * freq ** 2 + el.shortL3 * freq ** 3),
    );
    const norm = cScale(zsp, 1 / 50.0);
    return cMul(
      cDiv(cSub(norm, cx(1)), cAdd(norm, cx(1))),
      cExp(cx(0.0, -4.0 * Math.PI * freq * el.shortLength)),
    );
  }

  gammaOpen(freq) {
    const el = this.calElement;
    if (el.openState === 'IDEAL') return IDEAL_OPEN;
    if (el.openState === 'FILE' && el.openTouchstone) {
      const dp = el.openTouchstone.sFreq('11', freq);
      return cx(dp.re, dp.im);
    }
    const zop = cx(
      0.0,
      2.0 *
        Math.PI *
        freq *
        (el.openC0 + el.openC1 * freq + el.openC2 * freq ** 2 + el.openC3 * freq ** 3),
    );
    const scaled = cScale(zop, 50.0);
    return cMul(
      cDiv(cSub(cx(1.0), scaled), cAdd(cx(1.0), scaled)),
      cExp(cx(0.0, -4.0 * Math.PI * freq * el.openLength)),
    );
  }

  gammaLoad(freq) {
    const el = this.calElement;
    if (el.loadState === 'IDEAL') return IDEAL_LOAD;
    if (el.loadState === 'FILE' && el.loadTouchstone) {
      const dp = el.loadTouchstone.sFreq('11', freq);
      return cx(dp.re, dp.im);
    }
    let zl = cx(el.loadR, 0.0);
    if (el.loadC > 0.0) {
      zl = cDiv(cx(el.loadR), cx(1.0, 2.0 * el.loadR * Math.PI * freq * el.loadC));
    }
    if (el.loadL > 0.0) {
      zl = cAdd(zl, cx(0.0, 2 * Math.PI * freq * el.loadL));
    }
    const norm = cScale(zl, 1 / 50.0);
    return cMul(
      cDiv(cSub(norm, cx(1.0)), cAdd(norm, cx(1.0))),
      cExp(cx(0.0, -4 * Math.PI * freq * el.loadLength)),
    );
  }

  gammaThrough(freq) {
    const el = this.calElement;
    if (el.throughIsIdeal) return IDEAL_THROUGH;
    return cExp(cx(0.0, -2.0 * Math.PI * el.throughLength * freq));
  }

  genInterpolation() {
    const entries = this.dataset.values();
    const freq = entries.map((c) => c.freq);
    const build = (key) => new ComplexInterpolator(freq, entries.map((c) => c[key]));
    this.interp = {
      e00: build('e00'),
      e11: build('e11'),
      deltaE: build('deltaE'),
      e10e01: build('e10e01'),
      e30: build('e30'),
      e22: build('e22'),
      e10e32: build('e10e32'),
    };
  }

  correct11(dp) {
    const i = this.interp;
    const s11 = cDiv(
      cSub(dp.z, i.e00.at(dp.freq)),
      cSub(cMul(dp.z, i.e11.at(dp.freq)), i.deltaE.at(dp.freq)),
    );
    return new Datapoint(dp.freq, s11.re, s11.im);
  }

  correct21(dp, dp11) {
    const i = this.interp;
    let s21 = cDiv(cSub(dp.z, i.e30.at(dp.freq)), i.e10e32.at(dp.freq));
    s21 = cMul(
      s21,
      cDiv(
        i.e10e01.at(dp.freq),
        cSub(cMul(i.e11.at(dp.freq), dp11.z), i.deltaE.at(dp.freq)),
      ),
    );
    return new Datapoint(dp.freq, s21.re, s21.im);
  }

  /** Serialise to the .cal file format. */
  saves() {
    this.dataset.notes = this.notes.join('\n');
    if (!this.isValid1Port()) throw new CalibrationError('Not a valid calibration');
    return this.dataset.toString();
  }

  /** Read a .cal file. */
  loads(text, name = 'Loaded') {
    this.source = name;
    this.dataset = new CalDataSet().fromString(text);
    this.notes = this.dataset.notes.split('\n').filter((n, i, all) =>
      i < all.length - 1 || n !== '');
    this.isCalculated = false;
    this.interp = null;
    return this;
  }
}
