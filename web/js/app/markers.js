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

// Markers and their readouts, ported from NanoVNASaver/Marker.

import {
  groupDelay,
  impedanceToCapacitance,
  impedanceToInductance,
  serialToParallel,
  cAbs,
} from '../rf/rftools.js';
import {
  formatCapacitance,
  formatComplexAdm,
  formatComplexImp,
  formatFrequencySpace,
  formatGain,
  formatGroupDelay,
  formatInductance,
  formatMagnitude,
  formatPhase,
  formatQFactor,
  formatResistance,
  formatVSWR,
  formatWavelength,
} from '../util/format.js';

/** Every readout the desktop marker offers, in its order. */
export const READOUT_TYPES = [
  ['actualfreq', 'Frequency', 'Actual frequency', true],
  ['lambda', 'Wavelength', 'Wavelength', false],
  ['impedance', 'Impedance', 'Impedance', true],
  ['admittance', 'Admittance', 'Admittance', false],
  ['serr', 'Series R', 'Series R', false],
  ['serlc', 'Series X', 'Series equivalent L/C', false],
  ['serl', 'Series L', 'Series equivalent L', true],
  ['serc', 'Series C', 'Series equivalent C', true],
  ['parr', 'Parallel R', 'Parallel R', true],
  ['parlc', 'Parallel X', 'Parallel equivalent L/C', true],
  ['parl', 'Parallel L', 'Parallel equivalent L', false],
  ['parc', 'Parallel C', 'Parallel equivalent C', false],
  ['vswr', 'VSWR', 'VSWR', true],
  ['returnloss', 'Return loss', 'Return loss', true],
  ['s11mag', '|S11|', 'S11 Magnitude', false],
  ['s11q', 'Quality factor', 'S11 Quality factor', true],
  ['s11z', 'S11 |Z|', 'S11 Z Magnitude', false],
  ['s11phase', 'S11 Phase', 'S11 Phase', true],
  ['s11polar', 'S11 Polar', 'S11 Polar', false],
  ['s11groupdelay', 'S11 Group Delay', 'S11 Group Delay', false],
  ['s21gain', 'S21 Gain', 'S21 Gain', true],
  ['s21mag', '|S21|', 'S21 Magnitude', false],
  ['s21phase', 'S21 Phase', 'S21 Phase', true],
  ['s21polar', 'S21 Polar', 'S21 Polar', false],
  ['s21groupdelay', 'S21 Group Delay', 'S21 Group Delay', false],
  ['s21magshunt', 'S21 |Z| shunt', 'S21 Z Magnitude shunt', false],
  ['s21magseries', 'S21 |Z| series', 'S21 Z Magnitude series', false],
  ['s21realimagshunt', 'S21 R+jX shunt', 'S21 Z Real+Imag shunt', false],
  ['s21realimagseries', 'S21 R+jX series', 'S21 Z Real+Imag series', false],
].map(([id, name, description, defaultActive]) => ({
  id,
  name,
  description,
  defaultActive,
}));

export const DEFAULT_READOUTS = READOUT_TYPES.filter((t) => t.defaultActive).map(
  (t) => t.id,
);

export const MARKER_COLORS = ['#ffdf00', '#00d0ff', '#ff6ec7', '#7cff5b'];

export function createMarker(index) {
  return {
    index,
    name: `Marker ${index + 1}`,
    color: MARKER_COLORS[index % MARKER_COLORS.length],
    enabled: true,
    /** index into the sweep data, or -1 when unplaced */
    location: -1,
  };
}

/** The sweep index nearest a frequency. */
export function nearestIndex(data, freq) {
  if (!data.length) return -1;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < data.length; i += 1) {
    const distance = Math.abs(data[i].freq - freq);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * Every readout for one sweep position.
 *
 * A port of Marker.Widget.updateLabels, using the same formatters so
 * the browser prints what the desktop prints.
 *
 * @returns {?{location, values, raw}}
 */
export function readoutsAt(s11, s21, location, options = {}) {
  const { refImpedance = 50, returnlossIsPositive = false } = options;
  if (!s11.length || location < 0 || location >= s11.length) return null;

  const dp = s11[location];
  const imp = dp.impedance(refImpedance);
  const impP = serialToParallel(imp);

  const cap = impedanceToCapacitance(imp, dp.freq);
  const ind = impedanceToInductance(imp, dp.freq);
  const capP = impedanceToCapacitance(impP, dp.freq);
  const indP = impedanceToInductance(impP, dp.freq);

  const capStr = formatCapacitance(cap);
  const indStr = formatInductance(ind);
  const capPStr = formatCapacitance(capP);
  const indPStr = formatInductance(indP);

  const s11GroupDelay = groupDelay(s11, location);

  const values = {
    actualfreq: formatFrequencySpace(dp.freq),
    lambda: formatWavelength(dp.wavelength),
    admittance: formatComplexAdm(imp),
    impedance: formatComplexImp(imp),
    parc: capPStr,
    parl: indPStr,
    parlc: impP.im < 0 ? capPStr : indPStr,
    parr: formatResistance(impP.re),
    returnloss: formatGain(dp.gain, returnlossIsPositive),
    s11groupdelay: formatGroupDelay(s11GroupDelay),
    s11mag: formatMagnitude(cAbs(dp.z)),
    s11phase: formatPhase(dp.phase),
    s11polar: `${Math.round(cAbs(dp.z) * 100) / 100}∠${formatPhase(dp.phase)}`,
    s11q: formatQFactor(dp.qFactor(refImpedance)),
    s11z: formatResistance(cAbs(imp)),
    serc: capStr,
    serl: indStr,
    serlc: imp.im < 0 ? capStr : indStr,
    serr: formatResistance(imp.re),
    vswr: formatVSWR(dp.vswr),
  };

  const raw = {
    freq: dp.freq,
    s11: { re: dp.re, im: dp.im },
    gain: dp.gain,
    vswr: dp.vswr,
    impedance: imp,
    q: dp.qFactor(refImpedance),
    capacitance: cap,
    inductance: ind,
    groupDelay: s11GroupDelay,
    wavelength: dp.wavelength,
  };

  if (s21.length === s11.length) {
    const dp21 = s21[location];
    const s21GroupDelay = groupDelay(s21, location) / 2;
    Object.assign(values, {
      s21gain: formatGain(dp21.gain),
      s21groupdelay: formatGroupDelay(s21GroupDelay),
      s21mag: formatMagnitude(cAbs(dp21.z)),
      s21phase: formatPhase(dp21.phase),
      s21polar: `${Math.round(cAbs(dp21.z) * 100) / 100}∠${formatPhase(dp21.phase)}`,
      s21magshunt: formatMagnitude(cAbs(dp21.shuntImpedance(refImpedance))),
      s21magseries: formatMagnitude(cAbs(dp21.seriesImpedance(refImpedance))),
      s21realimagshunt: formatComplexImp(dp21.shuntImpedance(refImpedance), true),
      s21realimagseries: formatComplexImp(dp21.seriesImpedance(refImpedance), true),
    });
    Object.assign(raw, {
      s21: { re: dp21.re, im: dp21.im },
      s21Gain: dp21.gain,
      s21GroupDelay,
    });
  }

  return { location, values, raw };
}
