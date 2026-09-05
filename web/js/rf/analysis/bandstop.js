/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  Licensed under the GNU General Public License v3 or later; see
 *  <https://www.gnu.org/licenses/>.
 */

// Center, bandwidth, Q and roll-off of a band stop filter.

import { bandFilter } from './filters.js';

export const bandstopAnalysis = {
  key: 'bandstop',
  name: 'Band stop filter',
  description: 'Center, bandwidth, Q and roll-off of a band stop filter.',
  run: (ctx) => bandFilter(ctx, 'bandstop', 'Band stop filter analysis'),
  options: [],
  needsS21: true,
};
