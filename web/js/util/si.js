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

// A port of NanoVNASaver/SITools.py. The Python original computes in
// Decimal; doubles are used here, which only differs beyond the 15
// significant digits no display format in this application asks for.

export const PREFIXES = [
  'q', 'r', 'y', 'z', 'a', 'f', 'p', 'n', 'µ', 'm', '',
  'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q',
];

const INFINITY_SIGN = '∞';

export const DEFAULT_FORMAT = Object.freeze({
  maxNrDigits: 6,
  fixDecimals: false,
  spaceStr: '',
  assumeInfinity: true,
  minOffset: -10,
  maxOffset: 10,
  allowStrip: false,
  allwaysSigned: false,
  printableMin: -Infinity,
  printableMax: Infinity,
  unprintableUnder: '',
  unprintableOver: '',
  parseSloppyUnit: false,
  parseSloppyKilo: false,
  parseClampMin: -Infinity,
  parseClampMax: Infinity,
});

/** Build a format, filling in the defaults. */
export function format(overrides = {}) {
  return Object.freeze({ ...DEFAULT_FORMAT, ...overrides });
}

export function clamp(value, min, max) {
  if (value < min) return min;
  return value > max ? max : value;
}

export function roundCeil(value, digits = 0) {
  const factor = 10 ** -digits;
  return factor * Math.ceil(value / factor);
}

export function roundFloor(value, digits = 0) {
  const factor = 10 ** -digits;
  return factor * Math.floor(value / factor);
}

/** The largest of 1, 2 or 5 times a power of ten not exceeding x. */
export function logFloor125(x) {
  const logBase = 10 ** Math.floor(Math.log10(x));
  const logFactor = x / logBase;
  if (logFactor >= 5) return 5 * logBase;
  return logFactor >= 2 ? 2 * logBase : logBase;
}

/**
 * Render a number with an SI prefix.
 *
 * @param {number} value
 * @param {string} unit appended after the prefix
 * @param {object} fmt a format built by {@link format}
 */
export function formatValue(value, unit = '', fmt = DEFAULT_FORMAT) {
  const f = fmt;
  if (Number.isNaN(value)) return `-${f.spaceStr}${unit}`;

  if (f.assumeInfinity && Math.abs(value) >= 10 ** ((f.maxOffset + 1) * 3)) {
    return `${value < 0 ? '-' : ''}${INFINITY_SIGN}${f.spaceStr}${unit}`;
  }
  if (value < f.printableMin) return f.unprintableUnder + unit;
  if (value > f.printableMax) return f.unprintableOver + unit;

  let offset = value
    ? clamp(Math.floor(Math.log10(Math.abs(value)) / 3), f.minOffset, f.maxOffset)
    : 0;

  const real = value / 10 ** (offset * 3);

  let digits;
  if (f.maxNrDigits < 3) {
    digits = 0;
  } else {
    const maxDigits =
      f.maxNrDigits +
      (!f.fixDecimals && Math.abs(real) < 10 ? 1 : 0) +
      (!f.fixDecimals && Math.abs(real) < 100 ? 1 : 0);
    digits = maxDigits - 3;
  }

  let result = real.toFixed(digits);
  if (f.allwaysSigned && !result.startsWith('-')) result = `+${result}`;

  if (parseFloat(result) === 0.0) offset = 0;

  if (f.allowStrip && result.includes('.')) {
    result = result.replace(/0+$/, '').replace(/\.$/, '');
  }

  return result + f.spaceStr + PREFIXES[offset + 10] + unit;
}

/**
 * Parse a number that may carry an SI prefix and a unit.
 *
 * @returns {number} NaN when the text cannot be read
 */
export function parseValue(text, unit = '', fmt = DEFAULT_FORMAT) {
  if (typeof text === 'number') return text;
  let value = String(text).replace(/\s/g, '');
  if (!value) return NaN;

  if (
    unit &&
    (value.endsWith(unit) ||
      (fmt.parseSloppyUnit && value.toLowerCase().endsWith(unit.toLowerCase())))
  ) {
    value = value.slice(0, -unit.length);
  }
  if (!value) return NaN;

  let factor = 1;
  // "KHz", "mHz" and "gHz" are meant as kilo, mega and giga: milli-Hertz
  // makes no sense in a NanoVNA's context
  const last = value[value.length - 1];
  if (fmt.parseSloppyKilo && ['K', 'm', 'g'].includes(last)) {
    const swapped = last === last.toUpperCase() ? last.toLowerCase() : last.toUpperCase();
    value = value.slice(0, -1) + swapped;
  }

  const prefix = value[value.length - 1];
  const prefixIndex = PREFIXES.indexOf(prefix);
  // an empty prefix matches PREFIXES[10]; only strip a real one
  if (prefix && prefixIndex >= 0) {
    factor = 10 ** ((prefixIndex - 10) * 3);
    value = value.slice(0, -1);
  }

  let parsed;
  if (fmt.assumeInfinity && value === INFINITY_SIGN) {
    parsed = Infinity;
  } else if (fmt.assumeInfinity && value === `-${INFINITY_SIGN}`) {
    parsed = -Infinity;
  } else {
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return NaN;
    parsed = parseFloat(value) * factor;
    if (Number.isNaN(parsed)) return NaN;
    parsed = clamp(parsed, fmt.parseClampMin, fmt.parseClampMax);
  }
  return parsed;
}
