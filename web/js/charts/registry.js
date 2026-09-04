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

// Every chart the desktop application offers, described as data. A
// frequency chart is just a name plus the value to take from each point.

import { FrequencyChart, shortNumber } from './frequency.js';
import { PolarChart, SmithChart } from './smith.js';
import { TDRChart } from './tdrchart.js';
import {
  cAbs,
  cDiv,
  cScale,
  cx,
  groupDelay,
  impedanceToCapacitance,
  impedanceToInductance,
} from '../rf/rftools.js';

/** Vacuum permeability, as scipy.constants.mu_0. */
const MU_0 = 1.25663706212e-6;

/**
 * Core geometry for the permeability charts, in the units the desktop
 * dialog uses: millimetres and square millimetres.
 */
export const coreParameters = { length: 1.0, area: 1.0, windings: 1 };

const MU = 'µ';
const OHM = 'Ω';

/** Relative permeability of the core a winding is measured on. */
function muR(dp, refImpedance = 50) {
  const impedance = dp.impedance(refImpedance);
  // inductance = z / (2j * pi * f)
  const inductance = cDiv(impedance, cx(0, 2 * Math.PI * dp.freq));
  const scale =
    coreParameters.length / 1e3 /
    (MU_0 * coreParameters.windings ** 2 * (coreParameters.area / 1e6));
  const scaled = cScale(inductance, scale);
  // mu_r = mu' - j mu''
  return { re: scaled.re, im: -scaled.im };
}

const dB = (v) => `${shortNumber(v)} dB`;
const degrees = (v) => `${shortNumber(v)}°`;
const ohms = (v) => `${shortNumber(v)} ${OHM}`;
const seconds = (v) => `${shortNumber(v)} s`;
const farads = (v) => `${shortNumber(v)} F`;
const henries = (v) => `${shortNumber(v)} H`;

/**
 * The catalogue.
 *
 * `series` entries take a value from a data point; `colorKey` selects
 * the trace colour so a two value chart can tell its lines apart.
 */
export const CHART_TYPES = [
  // ---- S11 -------------------------------------------------------
  {
    key: 's11_log_mag',
    name: 'S11 Return Loss',
    group: 'S11',
    kind: 'frequency',
    unit: 'dB',
    formatY: dB,
    series: [{ source: 's11', label: 'Return loss', value: (dp) => dp.gain }],
  },
  {
    key: 's11_smith',
    name: 'S11 Smith Chart',
    group: 'S11',
    kind: 'smith',
    series: [{ source: 's11', label: 'S11' }],
  },
  {
    key: 's11_vswr',
    name: 'S11 VSWR',
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    logarithmicYAllowed: true,
    referenceLines: [1.5, 2.0, 3.0],
    series: [{ source: 's11', label: 'VSWR', value: (dp) => dp.vswr }],
  },
  {
    key: 's11_phase',
    name: 'S11 Phase',
    group: 'S11',
    kind: 'frequency',
    unit: '°',
    formatY: degrees,
    series: [
      { source: 's11', label: 'Phase', value: (dp) => (dp.phase * 180) / Math.PI },
    ],
  },
  {
    key: 's11_magnitude',
    name: '|S11|',
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    logarithmicYAllowed: true,
    series: [{ source: 's11', label: '|S11|', value: (dp) => cAbs(dp.z) }],
  },
  {
    key: 's11_magnitude_z',
    name: 'S11 |Z|',
    group: 'S11',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    logarithmicYAllowed: true,
    series: [
      { source: 's11', label: '|Z|', value: (dp) => cAbs(dp.impedance()) },
    ],
  },
  {
    key: 's11_real_imag',
    name: 'S11 R+jX',
    group: 'S11',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    series: [
      { source: 's11', label: 'R', value: (dp) => dp.impedance().re, colorKey: 'sweep' },
      {
        source: 's11',
        label: 'X',
        value: (dp) => dp.impedance().im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 's11_q_factor',
    name: 'S11 Quality Factor',
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    series: [{ source: 's11', label: 'Q', value: (dp) => dp.qFactor() }],
  },
  {
    key: 's11_group_delay',
    name: 'S11 Group Delay',
    group: 'S11',
    kind: 'frequency',
    unit: 's',
    formatY: seconds,
    series: [
      { source: 's11', label: 'Group delay', value: (dp, i, data) => groupDelay(data, i) },
    ],
  },
  {
    key: 's11_capacitance',
    name: 'S11 Serial C',
    group: 'S11',
    kind: 'frequency',
    unit: 'F',
    formatY: farads,
    series: [
      {
        source: 's11',
        label: 'Series C',
        value: (dp) => impedanceToCapacitance(dp.impedance(), dp.freq),
      },
    ],
  },
  {
    key: 's11_inductance',
    name: 'S11 Serial L',
    group: 'S11',
    kind: 'frequency',
    unit: 'H',
    formatY: henries,
    series: [
      {
        source: 's11',
        label: 'Series L',
        value: (dp) => impedanceToInductance(dp.impedance(), dp.freq),
      },
    ],
  },
  {
    key: 's11_s_parameter',
    name: 'S11 Real/Imaginary',
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    series: [
      { source: 's11', label: 'Real', value: (dp) => dp.re, colorKey: 'sweep' },
      {
        source: 's11',
        label: 'Imaginary',
        value: (dp) => dp.im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 's11_permeability',
    name: `S11 Permeability (${MU}${OHM} / Hz)`,
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    logarithmicYAllowed: true,
    series: [
      {
        source: 's11',
        label: "R'",
        value: (dp) => (dp.impedance().re * 10e6) / dp.freq,
        colorKey: 'sweep',
      },
      {
        source: 's11',
        label: "X'",
        value: (dp) => (dp.impedance().im * 10e6) / dp.freq,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 's11_real_imag_mu',
    name: `S11 ${MU}'/${MU}''`,
    group: 'S11',
    kind: 'frequency',
    formatY: shortNumber,
    series: [
      { source: 's11', label: `${MU}'`, value: (dp) => muR(dp).re, colorKey: 'sweep' },
      {
        source: 's11',
        label: `${MU}''`,
        value: (dp) => muR(dp).im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },

  // ---- S21 -------------------------------------------------------
  {
    key: 's21_log_mag',
    name: 'S21 Gain',
    group: 'S21',
    kind: 'frequency',
    unit: 'dB',
    formatY: dB,
    series: [{ source: 's21', label: 'Gain', value: (dp) => dp.gain }],
  },
  {
    key: 's21_phase',
    name: 'S21 Phase',
    group: 'S21',
    kind: 'frequency',
    unit: '°',
    formatY: degrees,
    series: [
      { source: 's21', label: 'Phase', value: (dp) => (dp.phase * 180) / Math.PI },
    ],
  },
  {
    key: 's21_polar',
    name: 'S21 Polar Plot',
    group: 'S21',
    kind: 'polar',
    series: [{ source: 's21', label: 'S21' }],
  },
  {
    key: 's21_magnitude',
    name: '|S21|',
    group: 'S21',
    kind: 'frequency',
    formatY: shortNumber,
    logarithmicYAllowed: true,
    series: [{ source: 's21', label: '|S21|', value: (dp) => cAbs(dp.z) }],
  },
  {
    key: 's21_group_delay',
    name: 'S21 Group Delay',
    group: 'S21',
    kind: 'frequency',
    unit: 's',
    formatY: seconds,
    series: [
      {
        source: 's21',
        label: 'Group delay',
        // the desktop halves the S21 group delay
        value: (dp, i, data) => groupDelay(data, i) / 2,
      },
    ],
  },
  {
    key: 's21_magnitude_z_shunt',
    name: 'S21 |Z| shunt',
    group: 'S21',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    logarithmicYAllowed: true,
    series: [
      { source: 's21', label: '|Z| shunt', value: (dp) => cAbs(dp.shuntImpedance()) },
    ],
  },
  {
    key: 's21_magnitude_z_series',
    name: 'S21 |Z| series',
    group: 'S21',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    logarithmicYAllowed: true,
    series: [
      { source: 's21', label: '|Z| series', value: (dp) => cAbs(dp.seriesImpedance()) },
    ],
  },
  {
    key: 's21_real_imag_shunt',
    name: 'S21 R+jX shunt',
    group: 'S21',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    series: [
      { source: 's21', label: 'R', value: (dp) => dp.shuntImpedance().re, colorKey: 'sweep' },
      {
        source: 's21',
        label: 'X',
        value: (dp) => dp.shuntImpedance().im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 's21_real_imag_series',
    name: 'S21 R+jX series',
    group: 'S21',
    kind: 'frequency',
    unit: OHM,
    formatY: ohms,
    series: [
      { source: 's21', label: 'R', value: (dp) => dp.seriesImpedance().re, colorKey: 'sweep' },
      {
        source: 's21',
        label: 'X',
        value: (dp) => dp.seriesImpedance().im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 's21_s_parameter',
    name: 'S21 Real/Imaginary',
    group: 'S21',
    kind: 'frequency',
    formatY: shortNumber,
    series: [
      { source: 's21', label: 'Real', value: (dp) => dp.re, colorKey: 'sweep' },
      {
        source: 's21',
        label: 'Imaginary',
        value: (dp) => dp.im,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },

  // ---- combined --------------------------------------------------
  {
    key: 'combined_log_mag',
    name: 'S11 & S21 LogMag',
    group: 'Combined',
    kind: 'frequency',
    unit: 'dB',
    formatY: dB,
    series: [
      { source: 's11', label: 'S11', value: (dp) => dp.gain, colorKey: 'sweep' },
      {
        source: 's21',
        label: 'S21',
        value: (dp) => dp.gain,
        colorKey: 'sweepSecondary',
        referenceColorKey: 'referenceSecondary',
      },
    ],
  },
  {
    key: 'tdr',
    name: 'TDR',
    group: 'Combined',
    kind: 'tdr',
    series: [],
  },
];

export const CHART_TYPES_BY_KEY = new Map(CHART_TYPES.map((t) => [t.key, t]));

/** The charts shown when the application is first opened. */
export const DEFAULT_LAYOUT = [
  's11_log_mag',
  's11_smith',
  's11_vswr',
  's21_log_mag',
  's11_phase',
  'tdr',
];

export function createChart(key) {
  const definition = CHART_TYPES_BY_KEY.get(key);
  if (!definition) throw new RangeError(`Unknown chart type: ${key}`);
  switch (definition.kind) {
    case 'smith':
      return new SmithChart(definition);
    case 'polar':
      return new PolarChart(definition);
    case 'tdr':
      return new TDRChart(definition);
    default:
      return new FrequencyChart(definition);
  }
}
