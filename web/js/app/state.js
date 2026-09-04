/*
 *  NanoVNA-WebSaver
 *
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

// Everything the application holds while it runs: the device, the sweep
// settings, the calibration, the data and the markers. This is the web
// equivalent of the NanoVNASaver Qt main window.

import { Emitter } from '../util/emitter.js';
import { Calibration, STANDARDS_FROM_S21 } from '../rf/calibration.js';
import { Sweep, SweepMode } from '../rf/sweep.js';
import { Touchstone } from '../rf/touchstone.js';
import { corrAttData } from '../rf/rftools.js';
import { SweepWorker } from './sweepworker.js';
import { DEFAULT_BANDS, DEFAULT_REGION, BAND_REGIONS } from './bands.js';
import { DEFAULT_READOUTS, createMarker, nearestIndex, readoutsAt } from './markers.js';
import { clampLayoutToColumns, defaultLayout, normalizeLayout } from '../charts/registry.js';
import { connectDevice, describePort, grantedPorts, requestPort } from '../device/detect.js';

const STORAGE_KEY = 'nanovna-websaver.settings.v1';

export const DEFAULT_SETTINGS = {
  theme: 'system',
  refImpedance: 50,
  s21Attenuation: 0,
  offsetDelay: 0,
  returnlossIsPositive: false,
  drawLines: true,
  pointSize: 2,
  lineWidth: 1,
  bandsEnabled: false,
  bandRegion: DEFAULT_REGION,
  readouts: [...DEFAULT_READOUTS],
  layout: defaultLayout(),
  columns: 3,
  tdr: { velocityFactor: 0.66, format: '|Z| (lowpass)', window: 'kaiser6' },
};

export class AppState extends Emitter {
  constructor() {
    super();
    this.device = null;
    this.portLabel = '';
    this.sweep = new Sweep();
    this.calibration = new Calibration();
    this.data = { s11: [], s21: [] };
    this.reference = { s11: [], s21: [] };
    this.markers = [createMarker(0), createMarker(1), createMarker(2)];
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.bands = DEFAULT_BANDS;
    this.analysisResult = null;
    this.status = 'Not connected';
    this.busy = false;

    this.worker = new SweepWorker(this);
    this.loadSettings();
  }

  // -- settings ----------------------------------------------------

  loadSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...parsed };
      // migrate an older layout format (a bare array of chart-type keys)
      // and re-clamp spans in case `columns` changed since it was saved
      this.settings.layout = normalizeLayout(this.settings.layout);
      this.settings.layout = clampLayoutToColumns(this.settings.layout, this.settings.columns);
      if (parsed.sweep) this.sweep = Sweep.fromJSON(parsed.sweep);
      this.bands = BAND_REGIONS[this.settings.bandRegion] ?? DEFAULT_BANDS;
    } catch (error) {
      // corrupt or unavailable storage must never stop the application
      console.warn('Could not read stored settings', error);
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...this.settings, sweep: this.sweep.toJSON() }),
      );
    } catch (error) {
      console.warn('Could not store settings', error);
    }
  }

  updateSettings(changes) {
    this.settings = { ...this.settings, ...changes };
    if (changes.bandRegion) {
      this.bands = BAND_REGIONS[changes.bandRegion] ?? DEFAULT_BANDS;
    }
    if (changes.columns !== undefined) {
      // a narrower grid may no longer fit panels at their current width
      this.settings.layout = clampLayoutToColumns(this.settings.layout, changes.columns);
    }
    this.saveSettings();
    this.emit('settings', this.settings);
    // the attenuation and reference impedance change what is displayed
    if (changes.s21Attenuation !== undefined) this.emit('data', this.data);
  }

  // -- device ------------------------------------------------------

  async listPorts() {
    const ports = await grantedPorts();
    return ports.map((port) => ({ port, label: describePort(port) }));
  }

  async requestNewPort() {
    return requestPort();
  }

  async connect(port) {
    if (this.device) await this.disconnect();
    this.setStatus('Connecting...');
    try {
      this.device = await connectDevice(port, {
        onDisconnect: () => this.#deviceLost(),
        onError: (error) => this.#deviceLost(error),
      });
    } catch (error) {
      this.setStatus(`Connection failed: ${error.message}`);
      this.emit('device', null);
      throw error;
    }
    this.portLabel = describePort(port);
    // follow the device's own point count
    if (this.device.datapoints) this.sweep.setPoints(this.device.datapoints);
    this.setStatus(`Connected to ${this.device.name}`);
    this.emit('device', this.device);
    this.emit('sweep', this.sweep);
    return this.device;
  }

  async disconnect() {
    this.worker.stop();
    await this.worker.join();
    const device = this.device;
    this.device = null;
    if (device) {
      try {
        if (typeof device.disconnect === 'function') await device.disconnect();
      } catch {
        // the device may already be gone
      }
      try {
        await device.transport.disconnect();
      } catch {
        // likewise
      }
    }
    this.setStatus('Not connected');
    this.emit('device', null);
  }

  #deviceLost(error) {
    if (!this.device) return;
    this.device = null;
    this.worker.stop();
    this.setStatus(
      error ? `Device disconnected: ${error.message}` : 'Device disconnected',
    );
    this.emit('device', null);
  }

  get connected() {
    return !!this.device && this.device.connected;
  }

  // -- sweep -------------------------------------------------------

  updateSweep(changes) {
    const sweep = this.sweep;
    const start = changes.start ?? sweep.start;
    const end = changes.end ?? sweep.end;
    const segments = changes.segments ?? sweep.segments;
    const points = changes.points ?? sweep.points;
    // Sweep.update clamps an inverted range up to a zero span, which
    // silently loses what the user asked for; say so instead
    if (end < start) {
      throw new RangeError('The stop frequency must not be below the start frequency');
    }
    sweep.update(start, end, segments, points);
    if (changes.mode) sweep.setMode(changes.mode);
    if (changes.averages !== undefined || changes.truncates !== undefined) {
      sweep.setAverages(
        changes.averages ?? sweep.properties.averages[0],
        changes.truncates ?? sweep.properties.averages[1],
      );
    }
    if (changes.logarithmic !== undefined) sweep.setLogarithmic(changes.logarithmic);
    if (changes.name !== undefined) sweep.setName(changes.name);
    this.saveSettings();
    this.emit('sweep', sweep);
  }

  async startSweep(mode) {
    if (!this.connected) throw new Error('No device connected');
    if (this.worker.running) return;
    if (mode) this.sweep.setMode(mode);
    if (this.device.datapoints !== this.sweep.points) {
      // the device decides how many points a segment holds
      this.sweep.setPoints(this.device.datapoints);
      this.emit('sweep', this.sweep);
    }
    this.worker.offsetDelay = this.settings.offsetDelay;
    this.setStatus('Sweeping...');
    this.emit('sweepState', { running: true, percentage: 0 });
    await this.worker.start();
  }

  stopSweep() {
    this.worker.stop();
    this.setStatus('Stopping...');
  }

  // -- data --------------------------------------------------------

  /** Called by the worker after every segment. */
  saveData(s11, s21) {
    const attenuation = this.settings.s21Attenuation;
    this.data = {
      s11: [...s11],
      s21: attenuation > 0 ? corrAttData(s21, attenuation) : [...s21],
    };
    this.refreshMarkers();
    this.emit('data', this.data);
  }

  setData(s11, s21) {
    this.data = { s11: [...s11], s21: [...s21] };
    this.refreshMarkers();
    this.emit('data', this.data);
  }

  clearData() {
    this.setData([], []);
  }

  setReferenceFromData() {
    this.reference = { s11: [...this.data.s11], s21: [...this.data.s21] };
    this.emit('reference', this.reference);
  }

  setReference(s11, s21) {
    this.reference = { s11: [...s11], s21: [...s21] };
    this.emit('reference', this.reference);
  }

  clearReference() {
    this.reference = { s11: [], s21: [] };
    this.emit('reference', this.reference);
  }

  onSweepProgress(percentage) {
    this.emit('sweepState', { running: this.worker.running, percentage });
  }

  onSweepError(message) {
    this.setStatus(message.split('\n')[0]);
    this.emit('error', message);
  }

  onSweepFinished(error) {
    this.emit('sweepState', { running: false, percentage: this.worker.percentage });
    if (!error) this.setStatus(`Sweep complete: ${this.data.s11.length} points`);
  }

  // -- markers -----------------------------------------------------

  setMarkerFrequency(index, freq) {
    const marker = this.markers[index];
    if (!marker) return;
    marker.location = nearestIndex(this.data.s11, freq);
    this.emit('markers', this.markers);
  }

  setMarkerLocation(index, location) {
    const marker = this.markers[index];
    if (!marker) return;
    marker.location = location;
    this.emit('markers', this.markers);
  }

  updateMarker(index, changes) {
    const marker = this.markers[index];
    if (!marker) return;
    Object.assign(marker, changes);
    this.emit('markers', this.markers);
  }

  addMarker() {
    this.markers.push(createMarker(this.markers.length));
    this.emit('markers', this.markers);
  }

  removeMarker(index) {
    this.markers.splice(index, 1);
    this.markers.forEach((marker, i) => {
      marker.index = i;
    });
    this.emit('markers', this.markers);
  }

  /** Keep marker positions valid after the data changed. */
  refreshMarkers() {
    const length = this.data.s11.length;
    let changed = false;
    this.markers.forEach((marker, i) => {
      if (!length) {
        if (marker.location !== -1) {
          marker.location = -1;
          changed = true;
        }
        return;
      }
      if (marker.location < 0) {
        // spread the markers across the sweep the first time round
        const position = Math.round(((i + 1) * (length - 1)) / (this.markers.length + 1));
        marker.location = position;
        changed = true;
      } else if (marker.location >= length) {
        marker.location = length - 1;
        changed = true;
      }
    });
    if (changed) this.emit('markers', this.markers);
  }

  markerReadouts(index) {
    const marker = this.markers[index];
    if (!marker) return null;
    return readoutsAt(this.data.s11, this.data.s21, marker.location, {
      refImpedance: this.settings.refImpedance,
      returnlossIsPositive: this.settings.returnlossIsPositive,
    });
  }

  // -- files -------------------------------------------------------

  /** Load a Touchstone file into the sweep data or the reference. */
  loadTouchstone(text, filename = '', target = 'data') {
    const touchstone = new Touchstone(filename);
    touchstone.loads(text);
    if (!touchstone.s11.length) throw new Error('The file contains no S11 data');

    if (target === 'reference') {
      this.setReference(touchstone.s11, touchstone.s21);
    } else {
      this.setData(touchstone.s11, touchstone.s21);
      this.updateSweep({
        start: touchstone.minFreq(),
        end: touchstone.maxFreq(),
        name: filename,
      });
      this.setStatus(`Loaded ${filename || 'Touchstone data'}`);
    }
    return touchstone;
  }

  /** Serialise the sweep as Touchstone text. */
  saveTouchstone(ports = 1, source = 'data') {
    const traces = source === 'data' ? this.data : this.reference;
    if (!traces.s11.length) throw new Error('There is no data to save');
    if (ports === 2 && traces.s21.length !== traces.s11.length) {
      throw new Error('A two port file needs matching S21 data');
    }
    const touchstone = new Touchstone();
    touchstone.s11 = traces.s11;
    if (ports === 2) {
      touchstone.s21 = traces.s21;
      // S12 and S22 are not measured, so they go out as zeroes, as they
      // do from the desktop application
      const zeroes = traces.s11.map((dp) => ({ freq: dp.freq, re: 0, im: 0 }));
      touchstone.s12 = zeroes;
      touchstone.s22 = zeroes;
    }
    return touchstone.saves(ports === 2 ? 4 : 1);
  }

  // -- calibration -------------------------------------------------

  /** Store the current sweep as one calibration standard. */
  captureStandard(name) {
    const source = STANDARDS_FROM_S21.has(name) ? this.data.s21 : this.data.s11;
    if (!source.length) throw new Error('Sweep the standard before saving it');
    this.calibration.insert(name, source);
    this.calibration.isCalculated = false;
    this.emit('calibration', this.calibration);
  }

  clearStandard(name) {
    this.calibration.remove(name);
    this.emit('calibration', this.calibration);
  }

  resetCalibration() {
    this.calibration.reset();
    this.emit('calibration', this.calibration);
  }

  applyCalibration() {
    this.calibration.calcCorrections();
    this.setStatus(`Calibration applied over ${this.calibration.size()} points`);
    this.emit('calibration', this.calibration);
  }

  loadCalibration(text, filename = '') {
    this.calibration.loads(text, filename || 'Loaded');
    this.emit('calibration', this.calibration);
  }

  saveCalibration() {
    return this.calibration.saves();
  }

  // -- misc --------------------------------------------------------

  setStatus(text) {
    this.status = text;
    this.emit('status', text);
  }

  setAnalysisResult(result) {
    this.analysisResult = result;
    this.emit('analysis', result);
  }
}

export { SweepMode };
