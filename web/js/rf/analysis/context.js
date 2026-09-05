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

// What every analysis is handed and what it hands back, plus the few
// helpers more than one of them needs. Each analysis itself lives in its
// own module alongside this one; index.js collects them.

import { reflectionCoefficient, cScale } from '../rftools.js';
import {
  formatGain,
  formatResistance,
  formatVSWR,
} from '../../util/format.js';

export class AnalysisError extends Error {}

/** What an analysis found. */
export class Result {
  constructor(title, summary = '') {
    this.title = title;
    this.summary = summary;
    this.sections = [];
    /** frequencies the analysis suggests moving markers to */
    this.markers = [];
    /** points the charts should highlight */
    this.annotations = [];
    /** a narrower sweep the analysis proposes, if any */
    this.suggestedSweep = null;
    /** option values the analysis adjusted for itself */
    this.options = {};
  }

  section(title = '') {
    const sect = { title, rows: [] };
    this.sections.push(sect);
    return {
      add(label, value) {
        sect.rows.push({ label, value });
        return this;
      },
    };
  }

  annotate(index, freq, label, kind) {
    this.annotations.push({ index, freq, label, kind });
  }
}

/** The data and marker positions an analysis works on. */
export class Context {
  constructor({ s11 = [], s21 = [], markerLocations = [], refImpedance = 50, sweep = null } = {}) {
    this.s11 = s11;
    this.s21 = s21;
    this.markerLocations = markerLocations;
    this.refImpedance = refImpedance;
    this.sweep = sweep;
  }

  marker(index) {
    const location = this.markerLocations[index];
    return location === undefined || location === null ? -1 : location;
  }

  requireS11() {
    if (!this.s11.length) throw new AnalysisError('No data to analyse.');
    return this.s11;
  }

  requireS21() {
    if (!this.s21.length) throw new AnalysisError('No S21 data to analyse.');
    return this.s21;
  }
}

// ---------------------------------------------------------- trace picking

export const DATA_SOURCES = ['vswr', 'resistance', 'reactance', 'gain'];

/** The trace a peak-searching analysis was asked to work on. */
export function dataAndFormat(ctx, source) {
  if (!DATA_SOURCES.includes(source)) {
    throw new AnalysisError(`Unknown data source: ${source}`);
  }
  if (source === 'gain') {
    if (!ctx.s21.length) throw new AnalysisError('S21 gain needs a two port sweep.');
    return { data: ctx.s21.map((d) => d.gain), fmt: (v) => formatGain(v), name: 'S21 gain' };
  }
  const s11 = ctx.requireS11();
  if (source === 'resistance') {
    return {
      data: s11.map((d) => d.impedance(ctx.refImpedance).re),
      fmt: (v) => formatResistance(v, true),
      name: 'Resistance',
    };
  }
  if (source === 'reactance') {
    return {
      data: s11.map((d) => d.impedance(ctx.refImpedance).im),
      fmt: (v) => formatResistance(v, true),
      name: 'Reactance',
    };
  }
  return { data: s11.map((d) => d.vswr), fmt: (v) => formatVSWR(v), name: 'VSWR' };
}

// ------------------------------------------------------------- resonance

/** VSWR seen through an impedance transformer of the given ratio. */
export function vswrTransformed(z, ratio = 49) {
  const refl = reflectionCoefficient(cScale(z, 1 / ratio), 50);
  const mag = Math.hypot(refl.re, refl.im);
  return mag === 1 ? 1 : (1 + mag) / (1 - mag);
}

/** Everything the resonance and EFHW analyses report about one point. */
export function pointData(s11, index, refImpedance) {
  const dp = s11[index];
  const impedance = dp.impedance(refImpedance);
  return {
    index,
    freq: dp.freq,
    lambda: dp.wavelength,
    impedance,
    vswr: dp.vswr,
    vswr49: vswrTransformed(impedance, 49),
    vswr4: vswrTransformed(impedance, 4),
    r: impedance.re,
    x: impedance.im,
  };
}

// ------------------------------------------------------- shared options

export const SOURCE_OPTION = {
  key: 'source',
  label: 'Data source',
  kind: 'choice',
  default: 'vswr',
  choices: [
    ['vswr', 'VSWR'],
    ['resistance', 'Resistance'],
    ['reactance', 'Reactance'],
    ['gain', 'S21 gain'],
  ],
};

export const PEAK_TYPE_OPTION = {
  key: 'peakType',
  label: 'Peak type',
  kind: 'choice',
  default: 'highest',
  choices: [
    ['highest', 'Highest value'],
    ['lowest', 'Lowest value'],
  ],
};
