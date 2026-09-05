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

// The marker readouts, as a column of cards floating over the right edge
// of the charts. Collapsed they show a frequency; expanded, whichever
// readouts that particular marker has been asked for.
//
// The chrome -- add, remove, and the readout picker -- stays out of the
// way until the pointer is over the overlay, so at rest this is numbers
// on top of traces and nothing else.

import { checkbox, el, textInput } from './dom.js';
import { popover } from './popover.js';
import { READOUT_TYPES } from '../app/markers.js';
import { parseFrequency } from '../util/format.js';

export function markerOverlay(state) {
  const list = el('div.marker-cards');
  const node = el('aside.marker-overlay', {}, list);

  function readoutRows(marker) {
    const readouts = state.markerReadouts(marker.index);
    if (!readouts) return [el('div.marker-empty', {}, 'No data')];
    const rows = marker.readouts
      .map((id) => {
        const type = READOUT_TYPES.find((t) => t.id === id);
        const value = readouts.values[id];
        if (!type || value === undefined || value === null) return null;
        return el(
          'div.marker-readout',
          {},
          el('span.marker-readout-label', {}, type.name),
          el('span.marker-readout-value', {}, value),
        );
      })
      .filter(Boolean);
    return rows.length ? rows : [el('div.marker-empty', {}, 'Nothing selected')];
  }

  /** The per-marker picker of which readouts to show. */
  function readoutPicker(marker, anchor) {
    return popover(
      anchor,
      () =>
        READOUT_TYPES.map((type) =>
          checkbox(type.description, marker.readouts.includes(type.id), (event) => {
            const chosen = new Set(marker.readouts);
            if (event.target.checked) chosen.add(type.id);
            else chosen.delete(type.id);
            // keep the catalogue's order rather than click order
            state.updateMarker(marker.index, {
              readouts: READOUT_TYPES.filter((t) => chosen.has(t.id)).map((t) => t.id),
            });
          }),
        ),
      { align: 'right', className: 'readout-picker-popover' },
    );
  }

  function card(marker) {
    const readouts = state.markerReadouts(marker.index);
    const frequency = readouts ? readouts.values.actualfreq : '';

    const pickerButton = el('button.marker-action', {
      type: 'button',
      textContent: '☰',
      title: 'Choose which readouts this marker shows',
    });
    readoutPicker(marker, pickerButton);

    const toggle = el('button.marker-toggle', {
      type: 'button',
      textContent: marker.expanded ? '▾' : '▸',
      title: marker.expanded ? 'Collapse' : 'Expand',
      on: {
        click: () => state.updateMarker(marker.index, { expanded: !marker.expanded }),
      },
    });

    const name = textInput(marker.name, (event) =>
      state.updateMarker(marker.index, { name: event.target.value }), { class: 'marker-name' });

    const freqInput = textInput(frequency, (event) => {
      const freq = parseFrequency(event.target.value);
      if (freq >= 0) state.setMarkerFrequency(marker.index, freq);
      else render();
    }, { class: 'marker-freq', title: 'Marker frequency' });

    const head = el(
      'div.marker-head',
      {},
      toggle,
      el('span.marker-swatch', { style: { background: marker.color } }),
      name,
      el(
        'span.marker-actions',
        {},
        pickerButton,
        el('button.marker-action', {
          type: 'button',
          textContent: '×',
          title: 'Remove this marker',
          on: { click: () => state.removeMarker(marker.index) },
        }),
      ),
    );

    return el(
      'div.marker-card',
      { class: marker.enabled ? '' : 'disabled', style: { borderLeftColor: marker.color } },
      head,
      freqInput,
      marker.expanded ? el('div.marker-readouts', {}, ...readoutRows(marker)) : null,
    );
  }

  function render() {
    const cards = state.markers.map(card);
    cards.push(
      el('button.marker-add', {
        type: 'button',
        textContent: '+',
        title: 'Add a marker',
        on: { click: () => state.addMarker() },
      }),
    );
    list.replaceChildren(...cards);
  }

  state.on('markers', render);
  state.on('data', render);
  state.on('settings', render);
  render();
  return node;
}
