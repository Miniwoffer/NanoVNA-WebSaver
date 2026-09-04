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

// A port of NanoVNASaver/Formatting.py, so that the browser prints the
// same strings the desktop application does.

import { format, formatValue, parseValue } from './si.js';

export const OHM = 'Ω';
export const DEGREE = '°';
export const INFINITY_SIGN = '∞';

export const FMT_FREQ = format();
export const FMT_FREQ_SHORT = format({ maxNrDigits: 4 });
export const FMT_FREQ_SPACE = format({ spaceStr: ' ' });
export const FMT_FREQ_SWEEP = format({ maxNrDigits: 9, allowStrip: true });
export const FMT_FREQ_INPUTS = format({
  maxNrDigits: 10,
  allowStrip: true,
  printableMin: 0,
  unprintableUnder: '- ',
});
export const FMT_Q_FACTOR = format({
  maxNrDigits: 4,
  assumeInfinity: false,
  minOffset: 0,
  maxOffset: 0,
  allowStrip: true,
});
export const FMT_GROUP_DELAY = format({ maxNrDigits: 5, spaceStr: ' ' });
export const FMT_REACT = format({ maxNrDigits: 5, spaceStr: ' ', allowStrip: true });
export const FMT_COMPLEX = format({
  maxNrDigits: 3,
  allowStrip: true,
  printableMin: 0,
  unprintableUnder: '- ',
});
export const FMT_COMPLEX_NEG = format({ maxNrDigits: 3, allowStrip: true });
export const FMT_SHORT = format({ maxNrDigits: 4 });
export const FMT_WAVELENGTH = format({ maxNrDigits: 4, spaceStr: ' ' });
export const FMT_PARSE = format({
  parseSloppyUnit: true,
  parseSloppyKilo: true,
  parseClampMin: 0,
});
export const FMT_PARSE_VALUE = format({ parseSloppyUnit: true, parseSloppyKilo: true });

export const formatFrequency = (freq) => formatValue(freq, 'Hz', FMT_FREQ);
export const formatFrequencyInputs = (freq) => formatValue(freq, 'Hz', FMT_FREQ_INPUTS);
export const formatFrequencyShort = (freq) => formatValue(freq, 'Hz', FMT_FREQ_SHORT);
export const formatFrequencyChart = (freq) => formatValue(freq, '', FMT_FREQ_SHORT);
export const formatFrequencyChart2 = (freq) => formatValue(freq, '', FMT_FREQ);
export const formatFrequencySweep = (freq) => formatValue(freq, 'Hz', FMT_FREQ_SWEEP);

export const formatFrequencySpace = (freq, fmt = FMT_FREQ_SPACE) =>
  formatValue(freq, 'Hz', fmt);

export function formatGain(val, invert = false) {
  const value = invert ? -val : val;
  return `${fixed(value, 3)} dB`;
}

export function formatQFactor(val, allowNegative = false) {
  if ((!allowNegative && val < 0.0) || Math.abs(val) > 10000.0) return INFINITY_SIGN;
  return formatValue(val, '', FMT_Q_FACTOR);
}

export const formatVSWR = (val) => fixed(val, 3);
export const formatMagnitude = (val) => fixed(val, 3);

export function formatResistance(val, allowNegative = false) {
  if (!allowNegative && val < 0) return `- ${OHM}`;
  return formatValue(val, OHM, FMT_REACT);
}

export function formatCapacitance(val, allowNegative = true) {
  if (!allowNegative && val < 0) return '- pF';
  return formatValue(val, 'F', FMT_REACT);
}

export function formatInductance(val, allowNegative = true) {
  if (!allowNegative && val < 0) return '- nH';
  return formatValue(val, 'H', FMT_REACT);
}

export const formatGroupDelay = (val) => formatValue(val, 's', FMT_GROUP_DELAY);

export const formatPhase = (radians) => `${fixed((radians * 180) / Math.PI, 2)}${DEGREE}`;

/** Format an admittance, given the impedance it is the inverse of. */
export function formatComplexAdm(z, allowNegative = false) {
  if (z.re === 0 && z.im === 0) return '- S';
  const denom = z.re * z.re + z.im * z.im;
  const adm = { re: z.re / denom, im: -z.im / denom };
  const fmtRe = allowNegative ? FMT_COMPLEX_NEG : FMT_COMPLEX;
  const re = formatValue(adm.re, '', fmtRe);
  const im = formatValue(Math.abs(adm.im), '', FMT_COMPLEX);
  return `${re}${adm.im < 0 ? '-' : '+'}j${im} S`;
}

export function formatComplexImp(z, allowNegative = false) {
  const fmtRe = allowNegative ? FMT_COMPLEX_NEG : FMT_COMPLEX;
  const re = formatValue(z.re, '', fmtRe);
  const im = formatValue(Math.abs(z.im), '', FMT_COMPLEX);
  return `${re}${z.im < 0 ? '-' : '+'}j${im} ${OHM}`;
}

export const formatWavelength = (length) => formatValue(length, 'm', FMT_WAVELENGTH);

export const formatYAxis = (val, unit = '') => formatValue(val, unit, FMT_SHORT);

/** Parse a frequency entry, returning -1 when it cannot be read. */
export function parseFrequency(text) {
  const value = parseValue(text, 'Hz', FMT_PARSE);
  return Number.isFinite(value) ? Math.round(value) : -1;
}

export function parseNumber(text, unit = '', fmt = FMT_PARSE_VALUE) {
  const value = parseValue(String(text).replace(',', '.'), unit, fmt);
  return Number.isNaN(value) ? 0.0 : value;
}

/** toFixed, but rendering a non-finite value the way Python's format does. */
function fixed(value, digits) {
  if (Number.isNaN(value)) return 'nan';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  return value.toFixed(digits);
}
