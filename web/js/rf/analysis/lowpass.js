/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  Licensed under the GNU General Public License v3 or later; see
 *  <https://www.gnu.org/licenses/>.
 */

// Cutoff and roll-off of a low pass filter.

import { edgeFilter } from './filters.js';

export const lowpassAnalysis = {
  key: 'lowpass',
  name: 'Lowpass filter',
  description: 'Cutoff and roll-off of a low pass filter.',
  run: (ctx) => edgeFilter(ctx, 'right', 'Lowpass filter analysis'),
  options: [],
  needsS21: true,
  needsMarker: true,
};
