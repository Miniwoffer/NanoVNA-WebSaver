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

// A big centred panel for the one task that needs the whole screen:
// walking through a calibration.
//
// Built on the native <dialog>, which brings the backdrop, the Escape
// key, focus containment and the top layer with it -- all things that
// would otherwise be a few hundred lines of their own.

import { el } from './dom.js';

/**
 * @param {{title: string, render: () => Node|Node[],
 *          onClose?: () => void}} options
 *   `render` is called on every open, so the contents always reflect
 *   current state.
 * @returns {{open: Function, close: Function, refresh: Function,
 *            get isOpen: boolean, node: HTMLDialogElement}}
 */
export function modal({ title, render, onClose }) {
  const heading = el('h2.modal-title', {}, title);
  const body = el('div.modal-body');
  const closeButton = el('button.chart-action', {
    type: 'button',
    textContent: '×',
    title: 'Close',
  });
  const node = el(
    'dialog.modal',
    {},
    el('div.modal-head', {}, heading, closeButton),
    body,
  );

  const handle = {
    node,
    get isOpen() {
      return node.open;
    },
    setTitle(text) {
      heading.textContent = text;
    },
    refresh() {
      if (!node.open) return;
      body.replaceChildren(...[render()].flat(Infinity).filter(Boolean));
    },
    open() {
      if (node.open) return;
      if (!node.isConnected) document.body.append(node);
      body.replaceChildren(...[render()].flat(Infinity).filter(Boolean));
      node.showModal();
    },
    close() {
      if (node.open) node.close();
    },
  };

  closeButton.addEventListener('click', () => handle.close());
  // a click on the backdrop lands on the dialog itself, not its contents
  node.addEventListener('click', (event) => {
    if (event.target === node) handle.close();
  });
  node.addEventListener('close', () => {
    body.replaceChildren();
    onClose?.();
  });

  return handle;
}
