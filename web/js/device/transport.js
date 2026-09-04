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

// The serial link to the device.
//
// The desktop application talks to a NanoVNA over pyserial; in the
// browser that becomes the Web Serial API. The device speaks two very
// different dialects -- lines of ASCII on the v1 firmwares, packed
// binary structures on the V2 ones -- and screen captures are raw
// pixels either way, so this buffers *bytes* and decodes text out of
// them rather than decoding everything as text up front.

const DEFAULT_BAUD_RATE = 115200;
const READ_BUFFER_SIZE = 262144;

export class TransportError extends Error {}

/** Web Serial is only exposed in a secure context, and only by some browsers. */
export function serialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function serialUnsupportedReason() {
  if (typeof navigator === 'undefined') return 'No browser environment.';
  if (!window.isSecureContext) {
    return (
      'Web Serial needs a secure context. Open this page over https, or' +
      ' from http://localhost.'
    );
  }
  if (!('serial' in navigator)) {
    return (
      'This browser has no Web Serial API. Chrome, Edge and Opera on the' +
      ' desktop support it; Firefox and Safari do not.'
    );
  }
  return '';
}

/**
 * A byte stream to and from one serial port, with a queue that keeps
 * commands from interleaving.
 */
export class SerialTransport {
  constructor(port, { onDisconnect = () => {}, onError = () => {} } = {}) {
    this.port = port;
    this.onDisconnect = onDisconnect;
    this.onError = onError;

    /** bytes read but not yet consumed */
    this.buffer = new Uint8Array(0);
    this.reader = null;
    this.readerLoop = null;
    this.open = false;
    /** resolvers waiting for more bytes to arrive */
    this.waiters = [];
    /** tail of the command queue, so commands run one at a time */
    this.queue = Promise.resolve();
    this.decoder = new TextDecoder('ascii');
    this.encoder = new TextEncoder();
  }

  async connect({ baudRate = DEFAULT_BAUD_RATE } = {}) {
    await this.port.open({ baudRate, bufferSize: READ_BUFFER_SIZE });
    this.open = true;
    this.#startReader();
  }

  async disconnect() {
    this.open = false;
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // the port may already be gone
      }
      try {
        this.reader.releaseLock();
      } catch {
        // released along with the stream
      }
      this.reader = null;
    }
    if (this.readerLoop) {
      await this.readerLoop.catch(() => {});
      this.readerLoop = null;
    }
    try {
      await this.port.close();
    } catch {
      // closing an already closed port is not an error worth raising
    }
    this.#wakeWaiters();
    this.onDisconnect();
  }

  #startReader() {
    this.reader = this.port.readable.getReader();
    this.readerLoop = (async () => {
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && value.length) this.#append(value);
        }
      } catch (error) {
        if (this.open) {
          this.open = false;
          this.onError(error);
        }
      } finally {
        this.#wakeWaiters();
      }
    })();
  }

  #append(chunk) {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
    this.#wakeWaiters();
  }

  #wakeWaiters() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Resolve once more bytes arrive, or the port closes. */
  #waitForData(timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const done = () => {
        if (timer !== null) clearTimeout(timer);
        resolve();
      };
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== done);
          reject(new TransportError(`Timed out after ${timeoutMs} ms waiting for the device`));
        }, timeoutMs);
      }
      this.waiters.push(done);
    });
  }

  /** Throw away everything already received. */
  drain() {
    this.buffer = new Uint8Array(0);
  }

  async write(data) {
    const bytes = typeof data === 'string' ? this.encoder.encode(data) : data;
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  /** Read exactly `n` bytes. */
  async readBytes(n, timeoutMs = 5000) {
    while (this.buffer.length < n) {
      if (!this.open) throw new TransportError('The device disconnected');
      await this.#waitForData(timeoutMs);
    }
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }

  /** Read whatever has arrived, up to `n` bytes, without waiting. */
  readAvailable(n = Infinity) {
    const count = Math.min(n, this.buffer.length);
    const out = this.buffer.slice(0, count);
    this.buffer = this.buffer.subarray(count);
    return out;
  }

  /** Index of a byte pattern in the buffer, or -1. */
  #indexOf(needle, from = 0) {
    const hay = this.buffer;
    outer: for (let i = from; i + needle.length <= hay.length; i += 1) {
      for (let j = 0; j < needle.length; j += 1) {
        if (hay[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  /** Wait until `text` appears in the buffer and return its offset. */
  async waitUntil(text, timeoutMs = 5000) {
    const needle = this.encoder.encode(text);
    for (;;) {
      const index = this.#indexOf(needle);
      if (index >= 0) return index;
      if (!this.open) throw new TransportError('The device disconnected');
      await this.#waitForData(timeoutMs);
    }
  }

  /** Read up to and including `eol`, returning the text before it. */
  async readLine(eol = '\n', timeoutMs = 5000) {
    const index = await this.waitUntil(eol, timeoutMs);
    const bytes = await this.readBytes(index + eol.length, timeoutMs);
    return this.decoder.decode(bytes.subarray(0, index));
  }

  /** Queue an operation so that commands never interleave on the wire. */
  enqueue(operation) {
    const run = this.queue.then(
      () => operation(),
      () => operation(),
    );
    // keep the chain alive even when one command fails
    this.queue = run.catch(() => {});
    return run;
  }
}
