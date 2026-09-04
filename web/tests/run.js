/*
 *  NanoVNA-WebSaver -- run the browser core's tests under node.
 *
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *  Licensed under the GNU General Public License v3 or later.
 */

import { run } from './harness.js';

const modules = process.argv.slice(2);
const suites = modules.length ? modules : ['./core.test.js'];

for (const suite of suites) {
  await import(suite.startsWith('.') ? suite : `./${suite}`);
}

process.exit((await run()) ? 0 : 1);
