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

// A labelled button in the topbar that drops a popover of controls.
// Every one of the application's settings groups is one of these.

import { el } from './dom.js';
import { caretIcon } from './icons.js';
import { popover } from './popover.js';

/**
 * @param {{label: string, render: () => Node|Node[], icon?: SVGElement,
 *          align?: 'left'|'right', title?: string, className?: string}} options
 *   `render` is called on every open, so a menu always shows current
 *   state without having to subscribe to anything.
 * @returns {{node: HTMLElement, menu: object, setLabel: Function,
 *            setIcon: Function}}
 */
export function menuButton({
  label,
  render,
  icon = null,
  align = 'left',
  title = '',
  className = '',
}) {
  const labelNode = el('span.menu-label', {}, label);
  const node = el('button.menu-button', { type: 'button', title });
  if (className) node.classList.add(className);
  if (icon) node.append(icon);
  node.append(labelNode, caretIcon());

  const menu = popover(node, render, { align, className: 'menu-popover' });

  return {
    node,
    menu,
    setLabel(text) {
      labelNode.textContent = text;
      // an open menu may be showing state that just changed under it
      menu.refresh();
    },
    setIcon(next) {
      const current = node.querySelector('svg');
      if (current) current.replaceWith(next);
      else node.prepend(next);
    },
  };
}

/** A row of controls inside a menu popover. */
export function menuRow(...children) {
  return el('div.menu-row', {}, ...children);
}

/** A small heading separating groups of controls inside a menu. */
export function menuHeading(text) {
  return el('div.menu-heading', {}, text);
}
