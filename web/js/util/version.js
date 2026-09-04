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

// A port of NanoVNASaver/utils/version.py.

const RXP = /^\D*(\d+)\.(\d+)\.?(\d+)?(.*)$/s;

/** A four component version, MAJOR.MINOR.REVISION-NOTE. */
export class Version {
  constructor(major = 0, minor = 0, revision = 0, note = '') {
    this.major = major;
    this.minor = minor;
    this.revision = revision;
    this.note = note;
  }

  static parse(vstring = '0.0.0') {
    const match = RXP.exec(String(vstring));
    if (!match) return new Version(0, 0, 0, '');
    return new Version(
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3] ?? '0', 10),
      match[4] ?? '',
    );
  }

  static build(major, minor, revision = 0, note = '') {
    return new Version(major, minor, revision, note);
  }

  /** Negative, zero or positive, as this version sorts against another. */
  compare(other) {
    if (this.major !== other.major) return this.major - other.major;
    if (this.minor !== other.minor) return this.minor - other.minor;
    return this.revision - other.revision;
  }

  atLeast(other) {
    return this.compare(typeof other === 'string' ? Version.parse(other) : other) >= 0;
  }

  atMost(other) {
    return this.compare(typeof other === 'string' ? Version.parse(other) : other) <= 0;
  }

  toString() {
    return `${this.major}.${this.minor}.${this.revision}${this.note}`;
  }
}
