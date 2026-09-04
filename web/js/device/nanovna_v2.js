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

// The NanoVNA V2 (S-A-A-2) and LiteVNA speak a register protocol of
// packed binary structures rather than the line based one of the v1
// firmwares. Ported from NanoVNASaver/Hardware/NanoVNA_V2.py and
// LiteVNA64.py.

import { Version } from '../util/version.js';
import { VNA, rgb565ToImage } from './vna.js';
import { DeviceError } from './vna.js';

export const CMD_NOP = 0x00;
export const CMD_INDICATE = 0x0d;
export const CMD_READ = 0x10;
export const CMD_READ2 = 0x11;
export const CMD_READ4 = 0x12;
export const CMD_READFIFO = 0x18;
export const CMD_WRITE = 0x20;
export const CMD_WRITE2 = 0x21;
export const CMD_WRITE4 = 0x22;
export const CMD_WRITE8 = 0x23;
export const CMD_WRITEFIFO = 0x28;

export const ADDR_SWEEP_START = 0x00;
export const ADDR_SWEEP_STEP = 0x10;
export const ADDR_SWEEP_POINTS = 0x20;
export const ADDR_SWEEP_VALS_PER_FREQ = 0x22;
export const ADDR_RAW_SAMPLES_MODE = 0x26;
export const ADDR_VALUES_FIFO = 0x30;
export const ADDR_DEVICE_VARIANT = 0xf0;
export const ADDR_PROTOCOL_VERSION = 0xf1;
export const ADDR_HARDWARE_REVISION = 0xf2;
export const ADDR_FW_MAJOR = 0xf3;
export const ADDR_FW_MINOR = 0xf4;

const WRITE_SLEEP_MS = 50;
/** each FIFO entry is 32 bytes */
const FIFO_ENTRY_SIZE = 32;
/** the firmware will not hand over more than this in one read */
const MAX_FIFO_READ = 255;

export const ADF4350_TXPOWER_DESC_MAP = {
  0: '9dB attenuation',
  1: '6dB attenuation',
  2: '3dB attenuation',
  3: 'Maximum',
};
const ADF4350_TXPOWER_DESC_REV_MAP = Object.fromEntries(
  Object.entries(ADF4350_TXPOWER_DESC_MAP).map(([k, v]) => [v, Number(k)]),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pack a little endian register write. */
function packWrite(cmd, addr, value, size) {
  const buffer = new ArrayBuffer(2 + size);
  const view = new DataView(buffer);
  view.setUint8(0, cmd);
  view.setUint8(1, addr);
  if (size === 1) view.setUint8(2, value);
  else if (size === 2) view.setUint16(2, value, true);
  else if (size === 4) view.setUint32(2, value, true);
  else view.setBigUint64(2, BigInt(Math.round(value)), true);
  return new Uint8Array(buffer);
}

export class NanoVNA_V2 extends VNA {
  static deviceName = 'NanoVNA-V2';
  static validDatapoints = [101, 11, 51, 201, 301, 501, 1023];
  static screenWidth = 320;
  static screenHeight = 240;
  static sweepMaxFreqHz = 3000e6;

  constructor(transport, options) {
    super(transport, options);
    this.sweepStartHz = 200e6;
    this.sweepStepHz = 1e6;
    this._sweepdata = [];
    this.boardRevision = Version.parse('0.0.0');
  }

  async initialise() {
    // put the protocol back into a known state: eight NOPs
    await this.transport.write(new Uint8Array(8));
    await sleep(WRITE_SLEEP_MS);

    this.version = await this.readFwVersion();
    if (this.version.major === 0xff) {
      throw new DeviceError('The device is in DFU mode');
    }
    await this.initFeatures();

    if (this.features.has('S21 hack')) {
      this.validDatapoints = [101, 11, 51, 201, 301, 501, 1021];
    }
    if (!this.validDatapoints.includes(this.datapoints)) {
      [this.datapoints] = this.validDatapoints;
    }
    await this.updateSweep();
  }

  async initFeatures() {
    this.features.add('Customizable data points');
    // TODO: more than one data point per frequency
    this.features.add('Multi data points');

    this.boardRevision = await this.readBoardRevision();
    this.hardwareRevision = this.boardRevision.toString();
    this.sweepMaxFreqHz = this.boardRevision.atLeast('2.0.4') ? 4400e6 : 3000e6;

    if (this.version.atMost('1.0.1')) {
      // the first sweep point of S21 is unreliable on these firmwares
      this.features.add('S21 hack');
    }
    if (this.version.atLeast('1.0.2')) {
      this.features.add('Set TX power partial');
      this.features.add('Set Average');
      // only the ADF4350 power can be set, that is from 140 MHz up
      this.txPowerRanges = [
        [
          [140e6, this.sweepMaxFreqHz],
          [3, 2, 1, 0].map((v) => ADF4350_TXPOWER_DESC_MAP[v]),
        ],
      ];
    }
  }

  async getCalibration() {
    return 'Unknown';
  }

  async readFirmware() {
    return `HW: ${this.boardRevision}\nFW: ${this.version}`;
  }

  async readFrequencies() {
    const out = [];
    for (let i = 0; i < this.datapoints; i += 1) {
      out.push(Math.round(this.sweepStartHz + i * this.sweepStepHz));
    }
    return out;
  }

  /**
   * Read both channels at once.
   *
   * The hardware returns every channel together, so the whole sweep is
   * fetched when channel 0 is asked for and channel 1 is served from
   * the same read.
   */
  async readValues(value) {
    if (value === 'data 0') {
      await this.transport.enqueue(() => this.#readFifo());
    }
    const index = value === 'data 1' ? 1 : 0;
    return this._sweepdata.map((pair) => pair[index]);
  }

  async #readFifo() {
    const s21hack = this.features.has('S21 hack') ? 1 : 0;

    // reset the protocol, then clear the FIFO
    this.transport.drain();
    await this.transport.write(new Uint8Array(8));
    await sleep(WRITE_SLEEP_MS);
    await this.transport.write(packWrite(CMD_WRITE, ADDR_VALUES_FIFO, 0, 1));
    await sleep(WRITE_SLEEP_MS);

    const total = this.datapoints + s21hack;
    this._sweepdata = new Array(total).fill(null).map(() => [
      { re: 0, im: 0 },
      { re: 0, im: 0 },
    ]);

    let todo = total;
    while (todo > 0) {
      const toRead = Math.min(MAX_FIFO_READ, todo);
      const request = new Uint8Array([CMD_READFIFO, ADDR_VALUES_FIFO, toRead]);
      await this.transport.write(request);

      // empirically just over 3 seconds for 101 points and 7 for 255
      const timeout = Math.max(4000, toRead * 60);
      const raw = await this.transport.readBytes(toRead * FIFO_ENTRY_SIZE, timeout);
      this.#decodeFifo(raw, toRead);
      todo -= toRead;
    }

    if (s21hack) this._sweepdata = this._sweepdata.slice(1);
  }

  /** Each 32 byte entry is <iiiiiihxxxxxx: three complex ints and an index. */
  #decodeFifo(raw, count) {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < count; i += 1) {
      const base = i * FIFO_ENTRY_SIZE;
      const fwdRe = view.getInt32(base, true);
      const fwdIm = view.getInt32(base + 4, true);
      const rev0Re = view.getInt32(base + 8, true);
      const rev0Im = view.getInt32(base + 12, true);
      const rev1Re = view.getInt32(base + 16, true);
      const rev1Im = view.getInt32(base + 20, true);
      const freqIndex = view.getInt16(base + 24, true);

      // refl / fwd and thru / fwd
      const denom = fwdRe * fwdRe + fwdIm * fwdIm;
      const divide = (re, im) =>
        denom === 0
          ? { re: 0, im: 0 }
          : {
              re: (re * fwdRe + im * fwdIm) / denom,
              im: (im * fwdRe - re * fwdIm) / denom,
            };

      if (freqIndex >= 0 && freqIndex < this._sweepdata.length) {
        this._sweepdata[freqIndex] = [divide(rev0Re, rev0Im), divide(rev1Re, rev1Im)];
      }
    }
  }

  async setSweep(start, stop) {
    const step = (stop - start) / (this.datapoints - 1);
    if (start === this.sweepStartHz && step === this.sweepStepHz) return;
    this.sweepStartHz = start;
    this.sweepStepHz = step;
    await this.updateSweep();
  }

  async resetSweep(start, stop) {
    await this.setSweep(start, stop);
  }

  async updateSweep() {
    const s21hack = this.features.has('S21 hack') ? 1 : 0;
    const start = Math.max(50000, Math.round(this.sweepStartHz - this.sweepStepHz * s21hack));

    const parts = [
      packWrite(CMD_WRITE8, ADDR_SWEEP_START, start, 8),
      packWrite(CMD_WRITE8, ADDR_SWEEP_STEP, Math.round(this.sweepStepHz), 8),
      packWrite(CMD_WRITE2, ADDR_SWEEP_POINTS, this.datapoints + s21hack, 2),
      packWrite(CMD_WRITE2, ADDR_SWEEP_VALS_PER_FREQ, 1, 2),
    ];
    const command = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      command.set(part, offset);
      offset += part.length;
    }

    await this.transport.enqueue(async () => {
      await this.transport.write(command);
      await sleep(WRITE_SLEEP_MS);
    });
  }

  async setTXPower(freqRange, powerDesc) {
    if (freqRange[0] !== 140e6) throw new DeviceError('Invalid TX power frequency range');
    await this.setRegister(0x42, ADF4350_TXPOWER_DESC_REV_MAP[powerDesc], 1);
  }

  async setRegister(addr, value, size) {
    const cmd = { 1: CMD_WRITE, 2: CMD_WRITE2, 4: CMD_WRITE4, 8: CMD_WRITE8 }[size];
    await this.transport.enqueue(() => this.transport.write(packWrite(cmd, addr, value, size)));
  }

  /** Read a pair of one byte registers as a version. */
  async readVersionRegisters(addrMajor, addrMinor, { asRevision = true } = {}) {
    return this.transport.enqueue(async () => {
      this.transport.drain();
      await this.transport.write(
        new Uint8Array([CMD_READ, addrMajor, CMD_READ, addrMinor]),
      );
      const resp = await this.transport.readBytes(2, 4000);
      // the V2 reports major.0.minor, the LiteVNA major.minor.0
      return asRevision
        ? Version.build(resp[0], 0, resp[1])
        : Version.build(resp[0], resp[1], 0);
    });
  }

  async readFwVersion() {
    return this.readVersionRegisters(ADDR_FW_MAJOR, ADDR_FW_MINOR);
  }

  async readBoardRevision() {
    return this.readVersionRegisters(ADDR_DEVICE_VARIANT, ADDR_HARDWARE_REVISION);
  }

  async captureScreen() {
    // the V2 firmware has no capture command
    return null;
  }

  async reconnect() {
    this.transport.drain();
    await this.transport.write(new Uint8Array(8));
  }
}

// ------------------------------------------------------------ LiteVNA

const LITEVNA_ADDR_VBAT_MILLIVOLTS = 0x5c;
const LITEVNA_ADDR_SCREENSHOT = 0xee;
const LITEVNA_SUPPORTED_PIXEL_FORMAT = 16;
export const LITEVNA_EXPECTED_HW_VERSION = Version.build(2, 2, 0);
export const LITEVNA_EXPECTED_FW_VERSION = Version.build(2, 2, 0);

export class LiteVNA64 extends NanoVNA_V2 {
  static deviceName = 'LiteVNA-64';
  static validDatapoints = [
    51, 101, 201, 401, 801, 1024, 1601, 3201, 4501, 6401, 12801, 25601,
  ];
  static screenWidth = 480;
  static screenHeight = 320;
  static sweepPointsMax = 65535;
  static sweepMaxFreqHz = 6300e6;

  constructor(transport, options) {
    super(transport, options);
    this.datapoints = 201;
  }

  async initFeatures() {
    this.features.add('Customizable data points');
    this.features.add('Screenshots');
    // TODO: more than one data point per frequency
    this.features.add('Multi data points');
    this.features.add('Set Average');
    this.features.add('Set TX power partial');
    // Only the ADF4350 power can be set, that is from 140 MHz up.
    // See https://groups.io/g/liteVNA/message/318 for more details.
    this.txPowerRanges = [
      [
        [140e6, this.sweepMaxFreqHz],
        [3, 2, 1, 0].map((v) => ADF4350_TXPOWER_DESC_MAP[v]),
      ],
    ];
    this.boardRevision = await this.readBoardRevision();
    this.hardwareRevision = this.boardRevision.toString();
  }

  async readFwVersion() {
    return this.readVersionRegisters(ADDR_FW_MAJOR, ADDR_FW_MINOR, { asRevision: false });
  }

  async readBoardRevision() {
    return this.readVersionRegisters(ADDR_DEVICE_VARIANT, ADDR_HARDWARE_REVISION, {
      asRevision: false,
    });
  }

  async getFeatures() {
    const result = new Set(this.features);
    result.add(`Vbat: ${await this.readVbat()}V`);
    return result;
  }

  async readVbat() {
    return this.transport.enqueue(async () => {
      this.transport.drain();
      await this.transport.write(new Uint8Array([CMD_READ2, LITEVNA_ADDR_VBAT_MILLIVOLTS]));
      const resp = await this.transport.readBytes(2, 4000);
      return ((resp[0] | (resp[1] << 8)) / 1000.0).toFixed(3);
    });
  }

  async readValues(value) {
    const result = await super.readValues(value);
    await this.exitUsbMode();
    return result;
  }

  /** The device drops its sweep settings when it goes idle. */
  async setSweep(start, stop) {
    this.sweepStartHz = start;
    this.sweepStepHz = (stop - start) / (this.datapoints - 1);
    await this.updateSweep();
  }

  async exitUsbMode() {
    await this.transport.enqueue(async () => {
      await this.transport.write(packWrite(CMD_WRITE, ADDR_RAW_SAMPLES_MODE, 2, 1));
      await sleep(WRITE_SLEEP_MS);
    });
  }

  async disconnect() {
    await this.exitUsbMode();
  }

  async captureScreen() {
    return this.transport.enqueue(async () => {
      this.transport.drain();
      await this.transport.write(packWrite(CMD_WRITE, LITEVNA_ADDR_SCREENSHOT, 0, 1));
      await sleep(WRITE_SLEEP_MS);

      // header: width and height as uint16, then the pixel depth
      const header = await this.transport.readBytes(5, 8000);
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      const width = view.getUint16(0, true);
      const height = view.getUint16(2, true);
      const pixelSize = view.getUint8(4);

      if (pixelSize !== LITEVNA_SUPPORTED_PIXEL_FORMAT) {
        throw new DeviceError(`Unsupported ${pixelSize} bit screenshot pixel format`);
      }
      const raw = await this.transport.readBytes(width * height * (pixelSize / 8), 15000);
      return rgb565ToImage(raw, width, height, 'big');
    });
  }
}
