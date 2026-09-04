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

// Working out which device is on the other end of the port, ported from
// NanoVNASaver/Hardware/Hardware.py.
//
// The desktop application can read USB vendor and product ids from the
// operating system. Web Serial only offers them once the port has been
// granted, and not on every platform, so detection here leans on the
// protocol probe that the desktop version also uses.

import { Version } from '../util/version.js';
import { SerialTransport } from './transport.js';
import {
  AVNA,
  JNCRadio_VNA_3G,
  NanoVNA,
  NanoVNA_F,
  NanoVNA_F_V2,
  NanoVNA_F_V3,
  NanoVNA_H,
  NanoVNA_H4,
  SV4401A,
  SV6301A,
  TinySA,
  TinySA_Ultra,
} from './nanovna.js';
import {
  ADDR_DEVICE_VARIANT,
  ADDR_FW_MAJOR,
  ADDR_FW_MINOR,
  ADDR_HARDWARE_REVISION,
  CMD_READ,
  LITEVNA_EXPECTED_FW_VERSION,
  LITEVNA_EXPECTED_HW_VERSION,
  LiteVNA64,
  NanoVNA_V2,
} from './nanovna_v2.js';

/** USB ids the desktop application recognises. */
export const USB_DEVICE_TYPES = [
  { vendorId: 0x0483, productId: 0x5740, name: 'NanoVNA' },
  { vendorId: 0x16c0, productId: 0x0483, name: 'AVNA' },
  { vendorId: 0x04b4, productId: 0x0008, name: 'S-A-A-2' },
];

/** The filters offered to the browser's port picker. */
export const SERIAL_FILTERS = USB_DEVICE_TYPES.map(({ vendorId, productId }) => ({
  usbVendorId: vendorId,
  usbProductId: productId,
}));

export const NAME2DEVICE = {
  'S-A-A-2': NanoVNA_V2,
  AVNA,
  H4: NanoVNA_H4,
  H: NanoVNA_H,
  F_V2: NanoVNA_F_V2,
  F_V3: NanoVNA_F_V3,
  F: NanoVNA_F,
  NanoVNA,
  tinySA: TinySA,
  tinySA_Ultra: TinySA_Ultra,
  JNCRadio: JNCRadio_VNA_3G,
  SV4401A,
  SV6301A,
  LiteVNA64,
  Unknown: NanoVNA,
};

/** Firmware banner text to the driver key it selects. */
const FIRMWARE_MARKERS = [
  ['AVNA + Teensy', 'AVNA'],
  ['NanoVNA-H 4', 'H4'],
  ['NanoVNA-H', 'H'],
  ['NanoVNA-F_V2', 'F_V2'],
  ['NanoVNA-F_V3', 'F_V3'],
  ['NanoVNA-F', 'F'],
  ['NanoVNA', 'NanoVNA'],
  ['tinySA4', 'tinySA_Ultra'],
  ['tinySA', 'tinySA'],
  ['JNCRadio_VNA_3G', 'JNCRadio'],
  ['SV4401A', 'SV4401A'],
  ['SV6301A', 'SV6301A'],
];

const RETRIES = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Probe the protocol the device speaks.
 *
 * @returns {'v1'|'vh'|'v2'|'lite_vna_64'|''}
 */
export async function detectVersion(transport) {
  for (let i = 0; i < RETRIES; i += 1) {
    transport.drain();
    await transport.write('\r');
    // a workaround for the occasional mangled first reply: ask twice
    transport.drain();
    await transport.write('\r');
    await sleep(150);

    const data = new TextDecoder('ascii').decode(transport.readAvailable(128));
    if (data.startsWith('ch> ')) return 'v1';
    // the -H firmwares answer with a leading newline
    if (data.startsWith('\r\nch> ')) return 'vh';
    if (data.startsWith('\r\n?\r\nch> ')) return 'vh';
    if (data.startsWith('2')) {
      return (await isLiteVNA64(transport)) ? 'lite_vna_64' : 'v2';
    }
  }
  return '';
}

/** Read a pair of one byte version registers over the V2 protocol. */
async function readV2Version(transport, addrMajor, addrMinor) {
  transport.drain();
  await transport.write(new Uint8Array([CMD_READ, addrMajor, CMD_READ, addrMinor]));
  const resp = await transport.readBytes(2, 3000);
  return Version.build(resp[0], resp[1], 0);
}

export async function isLiteVNA64(transport) {
  try {
    const hw = await readV2Version(transport, ADDR_DEVICE_VARIANT, ADDR_HARDWARE_REVISION);
    const fw = await readV2Version(transport, ADDR_FW_MAJOR, ADDR_FW_MINOR);
    return (
      hw.compare(LITEVNA_EXPECTED_HW_VERSION) === 0 &&
      fw.compare(LITEVNA_EXPECTED_FW_VERSION) === 0
    );
  } catch {
    return false;
  }
}

/** Read the firmware banner from a device speaking the text protocol. */
export async function readInfo(transport) {
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    transport.drain();
    await transport.write('info\r');
    try {
      const text = await transport.readLine('ch>', 3000);
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && line !== 'info')
        .join('\n');
    } catch {
      // try again; a device that has just been opened can be slow
    }
  }
  return '';
}

/**
 * Decide which driver a port needs.
 *
 * @returns {string} a key of {@link NAME2DEVICE}
 */
export async function identify(transport) {
  const version = await detectVersion(transport);
  if (version === 'v2') return 'S-A-A-2';
  if (version === 'lite_vna_64') return 'LiteVNA64';
  if (!version) return '';

  const info = await readInfo(transport);
  for (const [marker, name] of FIRMWARE_MARKERS) {
    if (info.includes(marker)) return name;
  }
  return 'Unknown';
}

/**
 * Open a granted port and return the driver that speaks to it.
 *
 * @param {SerialPort} port from navigator.serial
 */
export async function connectDevice(port, { onDisconnect, onError } = {}) {
  const transport = new SerialTransport(port, { onDisconnect, onError });
  await transport.connect();
  try {
    const key = await identify(transport);
    if (!key) {
      throw new Error(
        'No VNA answered on that port. Check that the device is switched on' +
          ' and not already open in another program.',
      );
    }
    const DeviceClass = NAME2DEVICE[key];
    const device = new DeviceClass(transport, { comment: key });
    await device.initialise();
    return device;
  } catch (error) {
    await transport.disconnect().catch(() => {});
    throw error;
  }
}

/** Ask the browser to let the user pick a port. */
export async function requestPort() {
  try {
    return await navigator.serial.requestPort({ filters: SERIAL_FILTERS });
  } catch {
    // the picker was dismissed, or no matching device was offered; fall
    // back to letting the user choose from every serial port
    try {
      return await navigator.serial.requestPort({});
    } catch {
      return null;
    }
  }
}

/** Ports the user has already granted this origin. */
export async function grantedPorts() {
  if (typeof navigator === 'undefined' || !navigator.serial) return [];
  return navigator.serial.getPorts();
}

/** A readable label for a port, from whatever the browser will tell us. */
export function describePort(port) {
  const info = typeof port.getInfo === 'function' ? port.getInfo() : {};
  const known = USB_DEVICE_TYPES.find(
    (t) => t.vendorId === info.usbVendorId && t.productId === info.usbProductId,
  );
  if (known) return known.name;
  if (info.usbVendorId !== undefined) {
    const vid = info.usbVendorId.toString(16).padStart(4, '0');
    const pid = (info.usbProductId ?? 0).toString(16).padStart(4, '0');
    return `USB ${vid}:${pid}`;
  }
  return 'Serial port';
}
