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

// The NanoVNA family and its derivatives, ported from the drivers in
// NanoVNASaver/Hardware. They all speak the v1 text protocol; what
// differs is the sweep command, the screen size and pixel order, and
// how many points the firmware will take.

import { Version } from '../util/version.js';
import { VNA } from './vna.js';

export class NanoVNA extends VNA {
  static deviceName = 'NanoVNA';
  static screenWidth = 320;
  static screenHeight = 240;
  static sweepMaxFreqHz = 300e6;

  constructor(transport, options) {
    super(transport, options);
    this.sweepMethod = 'sweep';
    this.start = 0;
    this.stop = 0;
    this._sweepdata = [];
  }

  async initialise() {
    await super.initialise();
    [this.start, this.stop] = await this.runningFrequencies();
  }

  async runningFrequencies() {
    try {
      const frequencies = await super.readFrequencies();
      if (frequencies.length) {
        return [frequencies[0], frequencies[frequencies.length - 1]];
      }
    } catch {
      // fall back to the generic answer below
    }
    return super.runningFrequencies();
  }

  async initFeatures() {
    await super.initFeatures();
    if (this.version.atLeast('0.7.1')) {
      this.features.add('Scan mask command');
      this.sweepMethod = 'scan_mask';
    } else if (this.version.atLeast('0.2.0')) {
      this.features.add('Scan command');
      this.sweepMethod = 'scan';
    }
  }

  async setSweep(start, stop) {
    this.start = start;
    this.stop = stop;
    if (this.sweepMethod === 'sweep') {
      await this.execCommand(`sweep ${start} ${stop} ${this.datapoints}`);
    } else if (this.sweepMethod === 'scan') {
      await this.execCommand(`scan ${start} ${stop} ${this.datapoints}`);
    }
    // scan_mask sends its command with the data request instead
  }

  async resetSweep(start, stop) {
    await this.execCommand(`sweep ${start} ${stop} ${this.datapoints}`);
    await this.execCommand('resume');
  }

  async readFrequencies() {
    if (this.sweepMethod !== 'scan_mask') return super.readFrequencies();
    const lines = await this.execCommand(
      `scan ${this.start} ${this.stop} ${this.datapoints} 0b001`,
    );
    return lines.map((line) => parseInt(line, 10));
  }

  async readValues(value) {
    if (this.sweepMethod !== 'scan_mask') return super.readValues(value);

    // The hardware returns both channels at once, so grab them when
    // channel 0 is asked for and serve channel 1 from the same read.
    if (value === 'data 0') {
      const lines = await this.execCommand(
        `scan ${this.start} ${this.stop} ${this.datapoints} 0b110`,
      );
      this._sweepdata = lines.map((line) => {
        const d = line.split(/\s+/).map(Number);
        return [
          { re: d[0], im: d[1] },
          { re: d[2], im: d[3] },
        ];
      });
    }
    const index = value === 'data 1' ? 1 : 0;
    return this._sweepdata.map((pair) => pair[index]);
  }
}

export class NanoVNA_H extends NanoVNA {
  static deviceName = 'NanoVNA-H';
  static sweepMaxFreqHz = 1500e6;
}

export class NanoVNA_H4 extends NanoVNA_H {
  static deviceName = 'NanoVNA-H4';
  static screenWidth = 480;
  static screenHeight = 320;
  static validDatapoints = [101, 11, 51, 201, 401];
  static sweepPointsMax = 401;
  static sweepMaxFreqHz = 1500e6;

  async initFeatures() {
    await super.initFeatures();
    this.sweepMethod = this.features.has('Scan mask command') ? 'scan_mask' : 'scan';
  }
}

export class NanoVNA_F extends NanoVNA {
  static deviceName = 'NanoVNA-F';
  static screenWidth = 800;
  static screenHeight = 480;
  static screenshotByteOrder = 'little';
  static sweepMaxFreqHz = 1500e6;
}

export class NanoVNA_F_V2 extends NanoVNA {
  static deviceName = 'NanoVNA-F_V2';
  static screenWidth = 800;
  static screenHeight = 480;
  static screenshotByteOrder = 'little';
  static validDatapoints = [101, 11, 51, 201, 301];
  static sweepPointsMin = 11;
  static sweepPointsMax = 301;
  static sweepMaxFreqHz = 3e9;

  async initialise() {
    await super.initialise();
    this.version = await this.readFirmwareVersion();
    // 301 points from 0.5.0, 201 from 0.2.0, 101 before that
    if (this.version.atLeast('0.5.0')) {
      // the class defaults already allow 301
    } else if (this.version.atLeast('0.2.0')) {
      this.validDatapoints = [101, 11, 51, 201];
      this.sweepPointsMax = 201;
    } else {
      this.validDatapoints = [101, 11, 51];
      this.sweepPointsMax = 101;
    }
    if (!this.validDatapoints.includes(this.datapoints)) {
      [this.datapoints] = this.validDatapoints;
    }
  }

  async initFeatures() {
    await super.initFeatures();
    const result = (await this.execCommand('help')).join(' ').toLowerCase().split(/\s+/);
    if (result.includes('sn:')) {
      this.features.add('SN');
      this.serialNumber = await this.getSerialNumber();
    }
  }

  /** The F_V2 and F_V3 answer "version" with a bare number such as 0.5.8. */
  async readFirmwareVersion() {
    const result = await this.execCommand('version');
    return Version.parse(result[0] ?? '0.0.0');
  }
}

export class NanoVNA_F_V3 extends NanoVNA {
  static deviceName = 'NanoVNA-F_V3';
  static screenWidth = 800;
  static screenHeight = 480;
  static screenshotByteOrder = 'little';
  static validDatapoints = [101, 11, 51, 201, 301, 401, 501, 601, 701, 801];
  static sweepPointsMin = 11;
  static sweepPointsMax = 801;
  static sweepMaxFreqHz = 6.3e9;

  async initFeatures() {
    await super.initFeatures();
    const result = (await this.execCommand('help')).join(' ').toLowerCase().split(/\s+/);
    if (result.includes('sn:')) {
      this.features.add('SN');
      this.serialNumber = await this.getSerialNumber();
    }
  }

  async getSerialNumber() {
    const help = (await this.execCommand('help')).join(' ').split(/\s+/);
    return (await this.execCommand(help.includes('SN:') ? 'SN' : 'sn')).join(' ');
  }
}

/** The SV4401A, SV6301A and JNCRadio all scan rather than sweep. */
class ScanningNanoVNA extends NanoVNA {
  async initFeatures() {
    await super.initFeatures();
    this.features.delete('Scan mask command');
    this.features.add('Scan command');
    this.sweepMethod = 'scan';
  }

  async setSweep(start, stop) {
    this.start = start;
    this.stop = stop;
    await this.execCommand(`scan ${start} ${stop} ${this.datapoints}`);
  }
}

export class SV4401A extends ScanningNanoVNA {
  static deviceName = 'SV4401A';
  static screenWidth = 1024;
  static screenHeight = 600;
  static screenshotByteOrder = 'little';
  static validDatapoints = [501, 101, 1001];
  static sweepPointsMin = 101;
  static sweepPointsMax = 1001;
  static sweepMaxFreqHz = 4.4e9;
}

export class SV6301A extends ScanningNanoVNA {
  static deviceName = 'SV6301A';
  static screenWidth = 1024;
  static screenHeight = 600;
  static screenshotByteOrder = 'little';
  static validDatapoints = [501, 101, 1001];
  static sweepPointsMin = 101;
  static sweepPointsMax = 1001;
  static sweepMaxFreqHz = 6.3e9;
}

export class JNCRadio_VNA_3G extends ScanningNanoVNA {
  static deviceName = 'JNCRadio_VNA_3G';
  static screenWidth = 800;
  static screenHeight = 480;
  static screenshotByteOrder = 'little';
  static validDatapoints = [501, 11, 101, 1001];
  static sweepPointsMin = 11;
  static sweepPointsMax = 1001;
  static sweepMaxFreqHz = 3e9;
}

export class AVNA extends VNA {
  static deviceName = 'AVNA';
  static sweepMaxFreqHz = 40e3;

  async initFeatures() {
    await super.initFeatures();
    this.features.add('Customizable data points');
  }

  async resetSweep(start, stop) {
    await this.execCommand(`sweep ${start} ${stop} ${this.datapoints}`);
    await this.execCommand('resume');
  }
}

/**
 * A tinySA is a spectrum analyser rather than a VNA: it reports one
 * channel of levels, which the application shows on the S11 trace.
 */
export class TinySA extends VNA {
  static deviceName = 'tinySA';
  static screenWidth = 320;
  static screenHeight = 240;
  static validDatapoints = [290];
  static sweepMaxFreqHz = 950e6;

  constructor(transport, options) {
    super(transport, options);
    this.validateInput = false;
    this.start = 0;
    this.stop = 0;
    this._sweepdata = [];
  }

  async initialise() {
    await super.initialise();
    this.features = new Set(['Screenshots']);
    [this.start, this.stop] = await this.runningFrequencies();
  }

  async runningFrequencies() {
    try {
      const frequencies = await this.readFrequencies();
      if (frequencies.length) {
        return [frequencies[0], frequencies[frequencies.length - 1]];
      }
    } catch {
      // fall back to the generic answer
    }
    return super.runningFrequencies();
  }

  async setSweep(start, stop) {
    this.start = start;
    this.stop = stop;
    await this.execCommand(`sweep ${start} ${stop} ${this.datapoints}`);
    await this.execCommand('trigger auto');
  }

  async resetSweep() {
    // the tinySA keeps sweeping on its own
  }

  async readFrequencies() {
    const lines = await this.execCommand('frequencies');
    return lines.map((line) => parseInt(line, 10));
  }

  /**
   * Levels come back in dBm, one per line. Both channels report the
   * same trace, as they do on the desktop.
   */
  async readValues(value) {
    if (value === 'data 0') {
      const lines = await this.execCommand('data 0');
      this._sweepdata = lines.map((line) => {
        const level = parseFloat(line.trim());
        return Number.isFinite(level)
          ? { re: 10 ** (level / 20), im: 0.0 }
          : { re: 0.0, im: 0.0 };
      });
    }
    return this._sweepdata;
  }
}

export class TinySA_Ultra extends TinySA {
  static deviceName = 'tinySA Ultra';
  static screenWidth = 480;
  static screenHeight = 320;
  static validDatapoints = [450, 51, 101, 145, 290];
  static sweepMaxFreqHz = 5.4e9;

  async initialise() {
    await super.initialise();
    this.features = new Set(['Screenshots', 'Customizable data points']);
    this.version = await this.readFirmwareVersion();
    this.hardwareRevision = await this.readHardwareRevision();
    // the Ultra models differ in how far up they reach
    if (this.hardwareRevision.atLeast('0.5.3')) {
      this.model = 'tinySA Ultra+ ZS-407';
      this.sweepMaxFreqHz = 7.3e9;
    } else if (this.hardwareRevision.atLeast('0.4.6')) {
      this.model = 'tinySA Ultra+ ZS-406';
      this.sweepMaxFreqHz = 5.4e9;
    } else if (this.hardwareRevision.atLeast('0.4.5')) {
      this.model = 'tinySA Ultra ZS-405';
      this.sweepMaxFreqHz = 5.3e9;
    } else {
      this.sweepMaxFreqHz = 0.96e9;
    }
  }

  get name() {
    return this.model ?? super.name;
  }

  /**
   * "version" answers with two lines, for example
   *   tinySA4_v1.4-193-g6ff182b
   *   HW Version:V0.5.4 max2871
   */
  async readFirmwareVersion() {
    const result = await this.execCommand('version');
    const parts = (result[0] ?? '').split('_v')[1];
    if (!parts) return Version.parse('0.0.0');
    const [majorMinor, revision] = parts.split('-');
    return Version.parse(`${majorMinor}.${revision ?? 0}`);
  }

  async readHardwareRevision() {
    const result = await this.execCommand('version');
    return Version.parse(result[1] ?? '0.0.0');
  }
}
