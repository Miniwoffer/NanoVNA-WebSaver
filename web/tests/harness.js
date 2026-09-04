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

// A test harness small enough to need no dependencies: the whole point
// of this application is that it runs with nothing installed.

const suites = [];
let current = null;

export function describe(name, body) {
  current = { name, tests: [] };
  suites.push(current);
  body();
  current = null;
}

export function it(name, body) {
  if (!current) throw new Error('it() outside of describe()');
  current.tests.push({ name, body });
}

export class AssertionError extends Error {}

function fail(message) {
  throw new AssertionError(message);
}

export const assert = {
  ok(value, message = '') {
    if (!value) fail(`expected a truthy value${message ? `: ${message}` : ''}`);
  },

  equal(actual, expected, message = '') {
    if (actual !== expected) {
      fail(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${
        message ? ` (${message})` : ''
      }`);
    }
  },

  close(actual, expected, tolerance = 1e-9, message = '') {
    if (Number.isNaN(actual) && Number.isNaN(expected)) return;
    if (!(Math.abs(actual - expected) <= tolerance)) {
      fail(
        `expected ${expected} +/- ${tolerance}, got ${actual}${
          message ? ` (${message})` : ''
        }`,
      );
    }
  },

  deepEqual(actual, expected, message = '') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) fail(`expected ${b}, got ${a}${message ? ` (${message})` : ''}`);
  },

  throws(body, message = '') {
    try {
      body();
    } catch {
      return;
    }
    fail(`expected a throw${message ? `: ${message}` : ''}`);
  },
};

export async function run() {
  let passed = 0;
  const failures = [];

  for (const suite of suites) {
    for (const test of suite.tests) {
      try {
        await test.body();
        passed += 1;
      } catch (error) {
        failures.push({ suite: suite.name, test: test.name, error });
      }
    }
  }

  for (const failure of failures) {
    console.error(`FAIL ${failure.suite} > ${failure.test}`);
    console.error(`     ${failure.error.message}`);
    if (!(failure.error instanceof AssertionError)) {
      console.error(failure.error.stack);
    }
  }

  const total = passed + failures.length;
  console.log(`\n${passed}/${total} passed`);
  return failures.length === 0;
}
