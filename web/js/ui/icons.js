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

// The handful of inline SVG icons the interface uses. They are built
// here rather than with dom.js's `el`, which calls createElement and so
// cannot make SVG elements; and inline rather than as files, because the
// application ships as plain static files with no build step and an icon
// that needs a second request is an icon that flickers.
//
// Everything is drawn on a 24x24 grid and inherits the surrounding text
// colour, so one icon works on every background the themes offer.

const NS = 'http://www.w3.org/2000/svg';

function svg(children, { size = 16, fill = 'none' } = {}) {
  const node = document.createElementNS(NS, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('width', String(size));
  node.setAttribute('height', String(size));
  node.setAttribute('fill', fill);
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '2');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('aria-hidden', 'true');
  node.classList.add('icon');
  for (const child of children) node.append(child);
  return node;
}

function path(d, attrs = {}) {
  const node = document.createElementNS(NS, 'path');
  node.setAttribute('d', d);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function circle(cx, cy, r, attrs = {}) {
  const node = document.createElementNS(NS, 'circle');
  node.setAttribute('cx', String(cx));
  node.setAttribute('cy', String(cy));
  node.setAttribute('r', String(r));
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/** The USB trident, for the device control. */
export function usbIcon(size = 16) {
  return svg(
    [
      // the stem, from the plug at the bottom to the arrow at the top
      path('M12 20V5'),
      // the arrow head
      path('M9.5 7.5 12 3l2.5 4.5Z', { fill: 'currentColor' }),
      // the square branch
      path('M12 14 7.5 11V8.5'),
      path('M6 6h3v2.5H6Z', { fill: 'currentColor' }),
      // the round branch
      path('M12 17l4.5-3v-2'),
      circle(16.5, 10.5, 1.6, { fill: 'currentColor' }),
      // the plug
      circle(12, 21, 1.6, { fill: 'currentColor' }),
    ],
    { size },
  );
}

/** A small chevron marking a control that opens a menu. */
export function caretIcon(size = 12) {
  return svg([path('m6 9 6 6 6-6')], { size });
}
