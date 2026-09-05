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

// The driver for the text protocol spoken by the v1 firmwares, ported
// from NanoVNASaver/Hardware/VNA.py.

import { Version } from '../util/version.js';
import { TransportError } from './transport.js';

export const DISLORD_BW = {
  10: 363,
  33: 117,
  50: 78,
  100: 39,
  200: 19,
  250: 15,
  333: 11,
  500: 7,
  1000: 3,
  2000: 1,
  4000: 0,
};

/** The prompt the device prints when it is ready for a command. */
const PROMPT = 'ch>';

export class DeviceError extends Error {}

/**
 * How long to wait between bytes for one command.
 *
 * The desktop application counts empty reads instead; both come to the
 * same thing, which is that a slow sweep at a narrow bandwidth needs
 * more patience than a fast one.
 */
function commandTimeout(bandwidth, datapoints) {
  const retries = Math.round(
    20 + 20 * (datapoints / 101) + (1000 / bandwidth) ** 1.3 * (datapoints / 101),
  );
  return Math.max(4000, retries * 50);
}

export class VNA {
  static deviceName = 'VNA';
  static validDatapoints = [101, 51, 11];
  static screenWidth = 320;
  static screenHeight = 240;
  /** RGB565 byte order this device's screen capture arrives in */
  static screenshotByteOrder = 'big';
  static sweepPointsMin = 11;
  static sweepPointsMax = 101;
  static sweepMaxFreqHz = 0;
  /**
   * The lowest frequency the hardware will tune to.
   *
   * The desktop application never modelled this -- it only ever tracked
   * the upper limit -- but the frequency range bar needs somewhere to
   * start the scale. 10 kHz is what the NanoVNA family accepts; the few
   * devices that differ override it.
   */
  static sweepMinFreqHz = 10e3;

  constructor(transport, { comment = '' } = {}) {
    this.transport = transport;
    this.comment = comment;
    this.version = Version.parse('0.0.0');
    this.features = new Set();
    this.validateInput = false;
    this.datapoints = this.constructor.validDatapoints[0];
    this.bandwidth = 1000;
    this.bwMethod = 'ttrftech';
    this.serialNumber = 'NOT SUPPORTED';
    this.hardwareRevision = 'NOT SUPPORTED';
    this.sweepMaxFreqHz = this.constructor.sweepMaxFreqHz;
    this.sweepMinFreqHz = this.constructor.sweepMinFreqHz;
    this.validDatapoints = [...this.constructor.validDatapoints];
    this.sweepPointsMin = this.constructor.sweepPointsMin;
    this.sweepPointsMax = this.constructor.sweepPointsMax;
    /**
     * Output power ranges, as [[minHz, maxHz], [description, ...]].
     * The default output power comes first.
     */
    this.txPowerRanges = [];
  }

  get name() {
    return this.constructor.deviceName;
  }

  get screenWidth() {
    return this.constructor.screenWidth;
  }

  get screenHeight() {
    return this.constructor.screenHeight;
  }

  get connected() {
    return this.transport.open;
  }

  /** Read the firmware version and work out what the device can do. */
  async initialise() {
    this.version = await this.readFwVersion();
    await this.initFeatures();
    if (this.features.has('Bandwidth')) {
      // the highest bandwidth gives the fastest first sweep
      const bandwidths = await this.getBandwidths();
      await this.setBandwidth(bandwidths[bandwidths.length - 1]);
    }
  }

  /**
   * Send one command and collect the lines it prints.
   *
   * Commands are queued, so two callers can never interleave writes.
   */
  async execCommand(command, { timeout = null } = {}) {
    const wait = timeout ?? commandTimeout(this.bandwidth, this.datapoints);
    return this.transport.enqueue(async () => {
      this.transport.drain();
      await this.transport.write(`${command}\r`);
      const text = await this.transport.readLine(PROMPT, wait);
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && line !== command);
    });
  }

  async initFeatures() {
    const result = (await this.execCommand('help')).join(' ').split(/\s+/);
    if (result.includes('capture')) this.features.add('Screenshots');
    if (result.includes('sn:')) {
      this.features.add('SN');
      this.serialNumber = await this.getSerialNumber();
    }
    if (result.includes('bandwidth')) {
      this.features.add('Bandwidth');
      const bwresult = (await this.execCommand('bandwidth')).join(' ');
      if (bwresult.includes('Hz)')) this.bwMethod = 'dislord';
    }
    if (this.validDatapoints.length > 1) {
      this.features.add('Customizable data points');
    }
  }

  async getBandwidths() {
    if (this.bwMethod === 'dislord') return Object.keys(DISLORD_BW).map(Number);
    const result = (await this.execCommand('bandwidth')).join(' ');
    const parts = result.split(' {');
    if (parts.length < 2) return [1000];
    return parts[1]
      .replace('}', '')
      .trim()
      .split('|')
      .map((v) => parseInt(v, 10))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
  }

  async setBandwidth(bandwidth) {
    const value = this.bwMethod === 'dislord' ? DISLORD_BW[bandwidth] : bandwidth;
    if (value === undefined) throw new DeviceError(`Unsupported bandwidth: ${bandwidth}`);
    const result = (await this.execCommand(`bandwidth ${value}`)).join(' ');
    if (this.bwMethod === 'ttrftech' && result) {
      throw new DeviceError(`set_bandwidth(${bandwidth}): ${result}`);
    }
    this.bandwidth = bandwidth;
  }

  async readFrequencies() {
    return (await this.readValues('frequencies')).map((v) => Math.round(v.re));
  }

  /** Parse "re im" pairs, one per line. */
  async readValues(value) {
    const lines = await this.execCommand(value);
    return lines.map((line) => {
      const parts = line.split(/\s+/);
      return { re: parseFloat(parts[0]), im: parseFloat(parts[1] ?? '0') };
    });
  }

  async setSweep(start, stop) {
    await this.execCommand(`sweep ${start} ${stop} ${this.datapoints}`);
  }

  // eslint-disable-next-line no-unused-vars
  async resetSweep(start, stop) {
    // only the devices that pause during a sweep need to do anything
  }

  async readFirmware() {
    return (await this.execCommand('info')).join('\n');
  }

  async readFwVersion() {
    const result = await this.execCommand('version');
    return Version.parse(result[0] ?? '0.0.0');
  }

  async getSerialNumber() {
    return (await this.execCommand('sn')).join(' ');
  }

  async getCalibration() {
    return (await this.execCommand('cal')).join(' ');
  }

  /**
   * If possible read the frequencies already running, otherwise return
   * sensible defaults. Overridden by the devices that can report them.
   */
  async runningFrequencies() {
    return [27000000, 30000000];
  }

  /**
   * Grab the device's screen.
   *
   * @returns {?{width: number, height: number, rgba: Uint8ClampedArray}}
   */
  async captureScreen() {
    if (!this.features.has('Screenshots')) return null;
    const width = this.screenWidth;
    const height = this.screenHeight;
    const expected = width * height * 2;

    const raw = await this.transport.enqueue(async () => {
      this.transport.drain();
      await this.transport.write('capture\r');
      // the device echoes the command before the pixel data
      await this.transport.readLine('\n', 4000);
      return this.transport.readBytes(expected, 8000);
    });

    return rgb565ToImage(raw, width, height, this.constructor.screenshotByteOrder);
  }

  /** Bring the link back after an error, as the desktop driver does. */
  async reconnect() {
    this.transport.drain();
    await this.transport.write('\r');
  }
}

/** Expand packed RGB565 pixels into the RGBA an ImageData wants. */
export function rgb565ToImage(bytes, width, height, byteOrder = 'big') {
  const count = width * height;
  if (bytes.length < count * 2) {
    throw new TransportError(
      `Expected ${count * 2} bytes of screen data, got ${bytes.length}`,
    );
  }
  const rgba = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) {
    const hi = bytes[i * 2];
    const lo = bytes[i * 2 + 1];
    const pixel = byteOrder === 'big' ? (hi << 8) | lo : (lo << 8) | hi;
    const r = (pixel & 0xf800) >> 11;
    const g = (pixel & 0x07e0) >> 5;
    const b = pixel & 0x001f;
    // scale the 5 and 6 bit channels up to 8 bits
    rgba[i * 4] = (r * 527 + 23) >> 6;
    rgba[i * 4 + 1] = (g * 259 + 33) >> 6;
    rgba[i * 4 + 2] = (b * 527 + 23) >> 6;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}
