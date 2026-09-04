/*
 *  NanoVNA-WebSaver -- a stand-in for a Web Serial port that speaks the
 *  device protocols, so the drivers can be tested without hardware.
 *
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *  Licensed under the GNU General Public License v3 or later.
 */

const encoder = new TextEncoder();

/** Implements just enough of the SerialPort interface for the transport. */
export class FakePort {
  constructor(simulator, info = {}) {
    this.simulator = simulator;
    this.info = info;
    this.opened = false;
    this.closed = false;
    this.written = [];

    this.pending = [];
    this.waiter = null;
    this.cancelled = false;

    simulator.attach(this);

    const port = this;
    this.readable = {
      getReader() {
        return {
          async read() {
            if (port.pending.length) return { value: port.pending.shift(), done: false };
            if (port.cancelled) return { value: undefined, done: true };
            await new Promise((resolve) => {
              port.waiter = resolve;
            });
            if (port.pending.length) return { value: port.pending.shift(), done: false };
            return { value: undefined, done: true };
          },
          async cancel() {
            port.cancelled = true;
            if (port.waiter) {
              const wake = port.waiter;
              port.waiter = null;
              wake();
            }
          },
          releaseLock() {},
        };
      },
    };

    this.writable = {
      getWriter() {
        return {
          async write(bytes) {
            port.written.push(bytes);
            await port.simulator.onWrite(bytes);
          },
          releaseLock() {},
        };
      },
    };
  }

  getInfo() {
    return this.info;
  }

  async open() {
    this.opened = true;
  }

  async close() {
    this.closed = true;
    this.opened = false;
  }

  /** Called by the simulator to hand bytes back to the driver. */
  push(data) {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    this.pending.push(bytes);
    if (this.waiter) {
      const wake = this.waiter;
      this.waiter = null;
      wake();
    }
  }
}

/**
 * A NanoVNA speaking the v1 text protocol.
 *
 * `responses` maps a command to the text printed before the prompt.
 */
export class V1Simulator {
  constructor({ responses = {}, points = 101, prompt = 'ch> ', echo = true } = {}) {
    this.responses = responses;
    this.points = points;
    this.prompt = prompt;
    this.echo = echo;
    this.port = null;
    this.commands = [];
    this.decoder = new TextDecoder('ascii');
    this.partial = '';
    /** the last sweep range the driver asked for */
    this.sweep = null;
  }

  attach(port) {
    this.port = port;
  }

  async onWrite(bytes) {
    this.partial += this.decoder.decode(bytes);
    let index;
    // commands are terminated by a carriage return
    while ((index = this.partial.indexOf('\r')) >= 0) {
      const command = this.partial.slice(0, index);
      this.partial = this.partial.slice(index + 1);
      this.#handle(command);
    }
  }

  #handle(command) {
    this.commands.push(command);
    if (command === '') {
      // the bare CR used to probe for the prompt
      this.port.push(this.prompt);
      return;
    }

    let body = this.#responseFor(command);
    let out = this.echo ? `${command}\r\n` : '';
    if (body) out += `${body}\r\n`;
    out += this.prompt;
    this.port.push(out);
  }

  #responseFor(command) {
    if (Object.prototype.hasOwnProperty.call(this.responses, command)) {
      const value = this.responses[command];
      return typeof value === 'function' ? value(command) : value;
    }
    const [verb] = command.split(' ');
    if (verb === 'sweep' || verb === 'scan') {
      const parts = command.split(/\s+/);
      this.sweep = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
      // a masked scan prints its data
      if (parts[4] === '0b001') return this.#frequencyLines();
      if (parts[4] === '0b110') return this.#maskedDataLines();
      return '';
    }
    if (command === 'frequencies') return this.#frequencyLines();
    if (command === 'data 0' || command === 'data 1') return this.#dataLines(command);
    return '';
  }

  frequencies() {
    const [start, stop, count] = this.sweep ?? [1000000, 2000000, this.points];
    const step = (stop - start) / (count - 1);
    return Array.from({ length: count }, (_, i) => Math.round(start + i * step));
  }

  #frequencyLines() {
    return this.frequencies().join('\r\n');
  }

  #dataLines(command) {
    const scale = command === 'data 0' ? 1 : 0.5;
    return this.frequencies()
      .map((f, i) => `${(scale * (i / 1000)).toFixed(6)} ${(scale * -0.25).toFixed(6)}`)
      .join('\r\n');
  }

  #maskedDataLines() {
    return this.frequencies()
      .map((f, i) => `${(i / 1000).toFixed(6)} -0.250000 ${(i / 2000).toFixed(6)} -0.125000`)
      .join('\r\n');
  }
}

/** A NanoVNA V2 speaking the binary register protocol. */
export class V2Simulator {
  constructor({ fwMajor = 1, fwMinor = 2, variant = 2, hwRevision = 4, points = 101 } = {}) {
    this.fwMajor = fwMajor;
    this.fwMinor = fwMinor;
    this.variant = variant;
    this.hwRevision = hwRevision;
    this.points = points;
    this.port = null;
    this.registers = new Map();
    this.fifoReads = 0;
    this.buffer = new Uint8Array(0);
  }

  attach(port) {
    this.port = port;
  }

  async onWrite(bytes) {
    const merged = new Uint8Array(this.buffer.length + bytes.length);
    merged.set(this.buffer);
    merged.set(bytes, this.buffer.length);
    this.buffer = merged;
    this.#consume();
  }

  #consume() {
    let i = 0;
    const b = this.buffer;
    while (i < b.length) {
      const cmd = b[i];
      if (cmd === 0x00) {
        i += 1; // NOP
      } else if (cmd === 0x10) {
        // READ one byte register
        if (i + 2 > b.length) break;
        this.port.push(new Uint8Array([this.#readRegister(b[i + 1])]));
        i += 2;
      } else if (cmd === 0x11) {
        // READ2
        if (i + 2 > b.length) break;
        this.port.push(new Uint8Array([0xe8, 0x0f])); // 4072 mV
        i += 2;
      } else if (cmd === 0x18) {
        // READFIFO addr, count
        if (i + 3 > b.length) break;
        this.#pushFifo(b[i + 2]);
        i += 3;
      } else if (cmd >= 0x20 && cmd <= 0x23) {
        const size = 2 ** (cmd - 0x20);
        if (i + 2 + size > b.length) break;
        i += 2 + size;
      } else {
        i += 1;
      }
    }
    this.buffer = b.subarray(i);
  }

  #readRegister(addr) {
    if (addr === 0xf3) return this.fwMajor;
    if (addr === 0xf4) return this.fwMinor;
    if (addr === 0xf0) return this.variant;
    if (addr === 0xf2) return this.hwRevision;
    return 0;
  }

  #pushFifo(count) {
    this.fifoReads += 1;
    const out = new Uint8Array(count * 32);
    const view = new DataView(out.buffer);
    for (let i = 0; i < count; i += 1) {
      const base = i * 32;
      // fwd = 1000 + 0j, refl = 500 + 0j, thru = 250 + 0j
      view.setInt32(base, 1000, true);
      view.setInt32(base + 4, 0, true);
      view.setInt32(base + 8, 500, true);
      view.setInt32(base + 12, 0, true);
      view.setInt32(base + 16, 250, true);
      view.setInt32(base + 20, 0, true);
      view.setInt16(base + 24, i, true);
    }
    this.port.push(out);
  }
}
