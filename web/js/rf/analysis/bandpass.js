/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  Licensed under the GNU General Public License v3 or later; see
 *  <https://www.gnu.org/licenses/>.
 */

// Center, bandwidth, Q and roll-off of a band pass filter.

import { bandFilter } from './filters.js';

export const bandpassAnalysis = {
  key: 'bandpass',
  name: 'Band pass filter',
  description: 'Center, bandwidth, Q and roll-off of a band pass filter.',
  run: (ctx) => bandFilter(ctx, 'bandpass', 'Band pass filter analysis'),
  options: [],
  needsS21: true,
  needsMarker: true,
};
