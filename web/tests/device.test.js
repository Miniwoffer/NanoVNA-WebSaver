/*
 *  NanoVNA-WebSaver -- tests for the Web Serial transport and drivers,
 *  driven against simulated devices.
 *
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *  Licensed under the GNU General Public License v3 or later.
 */

import { assert, describe, it } from './harness.js';
import { FakePort, V1Simulator, V2Simulator } from './fakeport.js';
import { SerialTransport } from '../js/device/transport.js';
import { VNA, rgb565ToImage } from '../js/device/vna.js';
import { NanoVNA, NanoVNA_H4, SV4401A, TinySA } from '../js/device/nanovna.js';
import { NanoVNA_V2, LiteVNA64 } from '../js/device/nanovna_v2.js';
import { detectVersion, identify, describePort, NAME2DEVICE } from '../js/device/detect.js';

const HELP_FULL =
  'commands: version reset freq dac saveconfig clearconfig data dump' +
  ' frequencies port stat gain power sample scan sweep test touchcal' +
  ' touchtest pause resume cal save recall trace marker edelay capture' +
  ' bandwidth transform threshold help info color sn:';

async function connect(simulator, DeviceClass = NanoVNA, info = {}) {
  const port = new FakePort(simulator, info);
  const transport = new SerialTransport(port);
  await transport.connect();
  const device = new DeviceClass(transport);
  return { port, transport, device };
}

describe('serial transport', () => {
  it('reads lines out of a byte stream', async () => {
    const sim = new V1Simulator({ responses: { version: '1.2.3' } });
    const { transport } = await connect(sim);
    await transport.write('version\r');
    const text = await transport.readLine('ch>', 2000);
    assert.ok(text.includes('1.2.3'), text);
    await transport.disconnect();
  });

  it('reads exact byte counts, binary safe', async () => {
    const sim = new V1Simulator();
    const { port, transport } = await connect(sim);
    // bytes above 127 must survive: a screen capture is raw pixels
    port.push(new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0xab]));
    const bytes = await transport.readBytes(5, 2000);
    assert.deepEqual([...bytes], [0x00, 0xff, 0x80, 0x7f, 0xab]);
    await transport.disconnect();
  });

  it('serialises queued commands', async () => {
    const sim = new V1Simulator({ responses: { a: '1', b: '2', c: '3' } });
    const { transport } = await connect(sim);
    const order = [];
    const run = (name) =>
      transport.enqueue(async () => {
        transport.drain();
        await transport.write(`${name}\r`);
        await transport.readLine('ch>', 2000);
        order.push(name);
      });
    await Promise.all([run('a'), run('b'), run('c')]);
    assert.deepEqual(order, ['a', 'b', 'c']);
    await transport.disconnect();
  });

  it('keeps the queue alive after a failed command', async () => {
    const sim = new V1Simulator({ responses: { ok: 'fine' } });
    const { transport } = await connect(sim);
    const failed = transport
      .enqueue(async () => {
        throw new Error('boom');
      })
      .catch((e) => e.message);
    assert.equal(await failed, 'boom');
    const after = await transport.enqueue(async () => {
      transport.drain();
      await transport.write('ok\r');
      return transport.readLine('ch>', 2000);
    });
    assert.ok(after.includes('fine'));
    await transport.disconnect();
  });

  it('times out when the device says nothing', async () => {
    const sim = new V1Simulator();
    const { transport } = await connect(sim);
    let threw = false;
    try {
      await transport.readBytes(10, 60);
    } catch (error) {
      threw = /Timed out/.test(error.message);
    }
    assert.ok(threw, 'reports a timeout');
    await transport.disconnect();
  });

  it('closes cleanly', async () => {
    const sim = new V1Simulator();
    const { port, transport } = await connect(sim);
    await transport.disconnect();
    assert.equal(port.closed, true);
    assert.equal(transport.open, false);
  });
});

describe('v1 text protocol driver', () => {
  const responses = {
    help: HELP_FULL,
    version: '1.0.45',
    'bandwidth': 'bandwidth {100|1000|4000}',
    'sn': 'a1b2c3d4',
    'info': 'Board: NanoVNA-H\nBuild Time: Jan 1 2024',
  };

  it('reads its version and features', async () => {
    const sim = new V1Simulator({ responses });
    const { device, transport } = await connect(sim, NanoVNA);
    await device.initialise();
    assert.equal(device.version.toString(), '1.0.45');
    assert.ok(device.features.has('Screenshots'));
    assert.ok(device.features.has('Bandwidth'));
    assert.ok(device.features.has('SN'));
    assert.equal(device.serialNumber, 'a1b2c3d4');
    // the highest bandwidth is chosen for a fast first sweep
    assert.equal(device.bandwidth, 4000);
    await transport.disconnect();
  });

  it('uses the scan mask command on new firmware', async () => {
    const sim = new V1Simulator({ responses });
    const { device, transport } = await connect(sim, NanoVNA);
    await device.initialise();
    assert.equal(device.sweepMethod, 'scan_mask');

    await device.setSweep(1000000, 2000000);
    const freqs = await device.readFrequencies();
    assert.equal(freqs.length, 101);
    assert.equal(freqs[0], 1000000);
    assert.equal(freqs[freqs.length - 1], 2000000);

    const s11 = await device.readValues('data 0');
    const s21 = await device.readValues('data 1');
    assert.equal(s11.length, 101);
    assert.equal(s21.length, 101);
    // the masked scan returns both channels in one read
    assert.close(s11[10].re, 0.01, 1e-9);
    assert.close(s21[10].re, 0.005, 1e-9);
    assert.ok(sim.commands.some((c) => c.includes('0b110')), 'used the data mask');
    await transport.disconnect();
  });

  it('falls back to the sweep command on old firmware', async () => {
    const sim = new V1Simulator({ responses: { ...responses, version: '0.1.0' } });
    const { device, transport } = await connect(sim, NanoVNA);
    await device.initialise();
    assert.equal(device.sweepMethod, 'sweep');
    await device.setSweep(1000000, 2000000);
    assert.ok(sim.commands.includes('sweep 1000000 2000000 101'));
    const values = await device.readValues('data 0');
    assert.equal(values.length, 101);
    await transport.disconnect();
  });

  it('uses the scan command on an SV4401A', async () => {
    const sim = new V1Simulator({ responses, points: 501 });
    const { device, transport } = await connect(sim, SV4401A);
    await device.initialise();
    assert.equal(device.sweepMethod, 'scan');
    assert.equal(device.datapoints, 501);
    await device.setSweep(1000000, 2000000);
    assert.ok(sim.commands.includes('scan 1000000 2000000 501'));
    await transport.disconnect();
  });

  it('offers the data points its model supports', async () => {
    assert.deepEqual(NanoVNA_H4.validDatapoints, [101, 11, 51, 201, 401]);
    assert.deepEqual(SV4401A.validDatapoints, [501, 101, 1001]);
    assert.equal(SV4401A.sweepMaxFreqHz, 4.4e9);
  });

  it('reads a tinySA as a single level trace', async () => {
    const levels = Array.from({ length: 290 }, (_, i) => `${-100 + i / 10}`).join('\r\n');
    const sim = new V1Simulator({
      responses: { ...responses, 'data 0': levels, version: 'tinySA_v1.1-46-g8e93e0f' },
      points: 290,
    });
    const { device, transport } = await connect(sim, TinySA);
    await device.initialise();
    const values = await device.readValues('data 0');
    assert.equal(values.length, 290);
    // a level of -100 dBm becomes a magnitude of 10 ** (-100/20)
    assert.close(values[0].re, 10 ** (-100 / 20), 1e-12);
    assert.equal(values[0].im, 0);
    // both channels report the same trace
    assert.deepEqual(await device.readValues('data 1'), values);
    await transport.disconnect();
  });

  it('reports no bandwidth control when the firmware lacks it', async () => {
    const sim = new V1Simulator({
      responses: { help: 'commands: version data frequencies sweep', version: '0.1.0' },
    });
    const { device, transport } = await connect(sim, NanoVNA);
    await device.initialise();
    assert.equal(device.features.has('Bandwidth'), false);
    assert.equal(device.features.has('Screenshots'), false);
    await transport.disconnect();
  });
});

describe('v2 binary protocol driver', () => {
  it('reads its versions from registers', async () => {
    const sim = new V2Simulator({ fwMajor: 1, fwMinor: 2, variant: 2, hwRevision: 4 });
    const { device, transport } = await connect(sim, NanoVNA_V2);
    await device.initialise();
    assert.equal(device.version.toString(), '1.0.2');
    assert.equal(device.boardRevision.toString(), '2.0.4');
    // board 2.0.4 and later reach 4.4 GHz
    assert.equal(device.sweepMaxFreqHz, 4400e6);
    assert.ok(device.features.has('Set TX power partial'));
    assert.equal(device.features.has('S21 hack'), false);
    await transport.disconnect();
  });

  it('applies the S21 hack on old firmware', async () => {
    const sim = new V2Simulator({ fwMajor: 1, fwMinor: 1, variant: 2, hwRevision: 0 });
    const { device, transport } = await connect(sim, NanoVNA_V2);
    await device.initialise();
    assert.ok(device.features.has('S21 hack'), 'flagged on firmware 1.0.1');
    assert.equal(device.sweepMaxFreqHz, 3000e6);
    assert.ok(device.validDatapoints.includes(1021));
    await transport.disconnect();
  });

  it('reads a sweep out of the FIFO', async () => {
    const sim = new V2Simulator();
    const { device, transport } = await connect(sim, NanoVNA_V2);
    await device.initialise();
    device.datapoints = 101;
    await device.setSweep(1000000, 2000000);

    const s11 = await device.readValues('data 0');
    const s21 = await device.readValues('data 1');
    assert.equal(s11.length, 101);
    assert.equal(s21.length, 101);
    // the simulator returns refl/fwd = 500/1000 and thru/fwd = 250/1000
    assert.close(s11[0].re, 0.5, 1e-12);
    assert.close(s21[0].re, 0.25, 1e-12);
    // channel 1 comes from the same read, not a second one
    assert.equal(sim.fifoReads, 1);
    await transport.disconnect();
  });

  it('splits a long sweep into several FIFO reads', async () => {
    const sim = new V2Simulator();
    const { device, transport } = await connect(sim, NanoVNA_V2);
    await device.initialise();
    device.datapoints = 501;
    await device.setSweep(1000000, 2000000);
    const values = await device.readValues('data 0');
    assert.equal(values.length, 501);
    // at most 255 entries come back per read, so 255 + 246
    assert.equal(sim.fifoReads, 2);
    await transport.disconnect();
  });

  it('computes its own frequency list', async () => {
    const sim = new V2Simulator();
    const { device, transport } = await connect(sim, NanoVNA_V2);
    await device.initialise();
    device.datapoints = 101;
    await device.setSweep(1000000, 2000000);
    const freqs = await device.readFrequencies();
    assert.equal(freqs.length, 101);
    assert.equal(freqs[0], 1000000);
    assert.equal(freqs[100], 2000000);
    await transport.disconnect();
  });

  it('refuses to talk to a device in DFU mode', async () => {
    const sim = new V2Simulator({ fwMajor: 0xff, fwMinor: 0 });
    const { device, transport } = await connect(sim, NanoVNA_V2);
    let threw = false;
    try {
      await device.initialise();
    } catch (error) {
      threw = /DFU/.test(error.message);
    }
    assert.ok(threw, 'reports DFU mode');
    await transport.disconnect();
  });

  it('reads a LiteVNA battery voltage', async () => {
    const sim = new V2Simulator({ fwMajor: 2, fwMinor: 2, variant: 2, hwRevision: 2 });
    const { device, transport } = await connect(sim, LiteVNA64);
    await device.initialise();
    assert.equal(device.datapoints, 201);
    assert.ok(device.features.has('Screenshots'));
    assert.equal(await device.readVbat(), '4.072');
    await transport.disconnect();
  });
});

describe('device detection', () => {
  it('detects the v1 prompt', async () => {
    const sim = new V1Simulator({ prompt: 'ch> ' });
    const { transport } = await connect(sim);
    assert.equal(await detectVersion(transport), 'v1');
    await transport.disconnect();
  });

  it('detects the -H style prompt', async () => {
    const sim = new V1Simulator({ prompt: '\r\nch> ' });
    const { transport } = await connect(sim);
    assert.equal(await detectVersion(transport), 'vh');
    await transport.disconnect();
  });

  it('picks a driver from the firmware banner', async () => {
    const cases = [
      ['Board: NanoVNA-H 4\nVersion: 1.2', 'H4'],
      ['Board: NanoVNA-H\nVersion: 1.2', 'H'],
      ['Board: NanoVNA-F_V2', 'F_V2'],
      ['Board: NanoVNA-F_V3', 'F_V3'],
      ['Board: NanoVNA-F', 'F'],
      ['Board: SV4401A', 'SV4401A'],
      ['Board: SV6301A', 'SV6301A'],
      ['Board: JNCRadio_VNA_3G', 'JNCRadio'],
      ['tinySA4 hardware', 'tinySA_Ultra'],
      ['tinySA hardware', 'tinySA'],
      ['AVNA + Teensy', 'AVNA'],
      ['something else entirely', 'Unknown'],
    ];
    for (const [info, expected] of cases) {
      const sim = new V1Simulator({ responses: { info } });
      const { transport } = await connect(sim);
      assert.equal(await identify(transport), expected, info);
      await transport.disconnect();
    }
  });

  it('reports nothing when no device answers', async () => {
    const sim = new V1Simulator({ prompt: 'garbage' });
    const { transport } = await connect(sim);
    assert.equal(await identify(transport), '');
    await transport.disconnect();
  });

  it('maps every driver key to a class', () => {
    for (const [key, cls] of Object.entries(NAME2DEVICE)) {
      assert.ok(typeof cls === 'function', `${key} maps to a class`);
      assert.ok(cls.prototype instanceof VNA || cls === VNA, `${key} is a VNA`);
    }
  });

  it('labels a port from its usb ids', () => {
    const port = new FakePort(new V1Simulator(), { usbVendorId: 0x0483, usbProductId: 0x5740 });
    assert.equal(describePort(port), 'NanoVNA');
    const other = new FakePort(new V1Simulator(), { usbVendorId: 0x1234, usbProductId: 0x5678 });
    assert.equal(describePort(other), 'USB 1234:5678');
    const bare = new FakePort(new V1Simulator(), {});
    assert.equal(describePort(bare), 'Serial port');
  });
});

describe('screen capture decoding', () => {
  it('expands RGB565 into RGBA', () => {
    // red, green, blue, white in big endian RGB565
    const bytes = new Uint8Array([
      0xf8, 0x00, 0x07, 0xe0, 0x00, 0x1f, 0xff, 0xff,
    ]);
    const image = rgb565ToImage(bytes, 4, 1, 'big');
    assert.equal(image.width, 4);
    assert.equal(image.height, 1);
    assert.deepEqual([...image.rgba.slice(0, 4)], [255, 0, 0, 255]);
    assert.deepEqual([...image.rgba.slice(4, 8)], [0, 255, 0, 255]);
    assert.deepEqual([...image.rgba.slice(8, 12)], [0, 0, 255, 255]);
    assert.deepEqual([...image.rgba.slice(12, 16)], [255, 255, 255, 255]);
  });

  it('honours the little endian pixel order', () => {
    const bytes = new Uint8Array([0x00, 0xf8]);
    const image = rgb565ToImage(bytes, 1, 1, 'little');
    assert.deepEqual([...image.rgba], [255, 0, 0, 255]);
  });

  it('refuses truncated pixel data', () => {
    assert.throws(() => rgb565ToImage(new Uint8Array([0, 0]), 4, 1, 'big'));
  });
});
