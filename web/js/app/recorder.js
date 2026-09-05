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

// Recording a run of sweeps and playing it back.
//
// A recording is a list of frames, each a complete sweep and the time it
// was taken. Playing one back just pushes its frames into the
// application's data, so every chart, marker and analysis follows along
// without knowing a recording exists.

import { Datapoint } from '../rf/rftools.js';

/** The format version written into exported files. */
export const RECORDING_VERSION = 1;

const toTriples = (points) => points.map((dp) => [dp.freq, dp.re, dp.im]);

const fromTriples = (triples) =>
  (Array.isArray(triples) ? triples : [])
    .filter((t) => Array.isArray(t) && t.length >= 3 && Number.isFinite(t[0]))
    .map(([freq, re, im]) => new Datapoint(freq, Number(re) || 0, Number(im) || 0));

/** Serialise a recording to the JSON text an export writes. */
export function encodeRecording({ frames, startedAt, device = '', sweep = null }) {
  return JSON.stringify({
    version: RECORDING_VERSION,
    application: 'NanoVNA-WebSaver',
    device,
    startedAt: new Date(startedAt || Date.now()).toISOString(),
    sweep: sweep
      ? { start: sweep.start, end: sweep.end, points: sweep.points, segments: sweep.segments }
      : null,
    frames: frames.map((frame) => ({
      t: Math.round(frame.t),
      s11: toTriples(frame.s11),
      s21: toTriples(frame.s21),
    })),
  });
}

export class RecordingError extends Error {}

/**
 * Read back what {@link encodeRecording} wrote.
 *
 * Throws rather than half-loading: a file that is not a recording, or is
 * from a version this cannot read, is more useful reported than guessed
 * at. Individual malformed points inside an otherwise sound file are
 * dropped instead, since one bad row should not cost the whole run.
 */
export function decodeRecording(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RecordingError('That file is not a recording (it is not JSON).');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.frames)) {
    throw new RecordingError('That file is not a recording.');
  }
  if (Number(parsed.version) > RECORDING_VERSION) {
    throw new RecordingError(
      `That recording is version ${parsed.version}; this version reads up to ${RECORDING_VERSION}.`,
    );
  }
  const frames = parsed.frames
    .filter((frame) => frame && typeof frame === 'object')
    .map((frame, index) => ({
      t: Number.isFinite(Number(frame.t)) ? Number(frame.t) : index * 1000,
      s11: fromTriples(frame.s11),
      s21: fromTriples(frame.s21),
    }))
    .filter((frame) => frame.s11.length || frame.s21.length);
  if (!frames.length) throw new RecordingError('That recording holds no sweeps.');
  return {
    frames,
    device: typeof parsed.device === 'string' ? parsed.device : '',
    startedAt: Date.parse(parsed.startedAt) || Date.now(),
    sweep: parsed.sweep ?? null,
  };
}

export class Recorder {
  constructor() {
    /** @type {{t: number, s11: object[], s21: object[]}[]} */
    this.frames = [];
    this.recording = false;
    this.startedAt = 0;
    this.device = '';
    this.sweep = null;
    /** index of the frame showing during playback, or -1 */
    this.position = -1;
  }

  get length() {
    return this.frames.length;
  }

  /** How long the recording covers, in milliseconds. */
  get duration() {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0;
  }

  start({ device = '', sweep = null } = {}) {
    this.frames = [];
    this.position = -1;
    this.recording = true;
    this.startedAt = Date.now();
    this.device = device;
    this.sweep = sweep;
  }

  /**
   * Finish recording, timing the run from its first sweep.
   *
   * Arming happens whenever the user gets round to it, and the wait
   * before the first sweep lands is not part of the run: without this
   * the opening frame would sit at some arbitrary offset and the
   * duration would count dead air.
   */
  stop() {
    this.recording = false;
    if (!this.frames.length) return;
    const offset = this.frames[0].t;
    if (!offset) return;
    this.startedAt += offset;
    for (const frame of this.frames) frame.t -= offset;
  }

  clear() {
    this.frames = [];
    this.recording = false;
    this.position = -1;
  }

  /** Append one completed sweep. Ignored unless recording. */
  capture(data, now = Date.now()) {
    if (!this.recording) return false;
    const s11 = data?.s11 ?? [];
    const s21 = data?.s21 ?? [];
    if (!s11.length && !s21.length) return false;
    this.frames.push({ t: now - this.startedAt, s11: [...s11], s21: [...s21] });
    return true;
  }

  frame(index) {
    return this.frames[index] ?? null;
  }

  load({ frames, device = '', startedAt = Date.now(), sweep = null }) {
    this.frames = frames;
    this.recording = false;
    this.device = device;
    this.startedAt = startedAt;
    this.sweep = sweep;
    this.position = frames.length ? 0 : -1;
  }

  toJSON() {
    return encodeRecording(this);
  }
}
