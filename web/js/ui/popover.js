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

// The one floating panel this application needs: a menu or an editor
// hanging off the control that opened it. Used for the topbar menus and
// for a chart panel's settings.
//
// Visibility is a class, never the `hidden` attribute: a rule as ordinary
// as `.popover { display: flex }` outranks the user agent's
// `[hidden] { display: none }`, and a popover that cannot actually hide
// is worse than none at all.

import { el } from './dom.js';

/** The popover currently on screen, if any. Only ever one. */
let openPopover = null;

const GAP = 6;
const MARGIN = 8;

/** Close whichever popover is open. */
export function closePopover() {
  if (openPopover) openPopover.close();
}

function place(node, anchorEl, align) {
  const anchor = anchorEl.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = node;
  const viewportW = document.documentElement.clientWidth;
  const viewportH = document.documentElement.clientHeight;

  let left = align === 'right' ? anchor.right - width : anchor.left;
  left = Math.max(MARGIN, Math.min(left, viewportW - width - MARGIN));

  // below the anchor, or above it when there is no room below
  let top = anchor.bottom + GAP;
  if (top + height > viewportH - MARGIN && anchor.top - GAP - height > MARGIN) {
    top = anchor.top - GAP - height;
  }
  top = Math.max(MARGIN, Math.min(top, viewportH - height - MARGIN));

  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

/**
 * Attach a popover to the control that opens it.
 *
 * @param {HTMLElement} anchorEl the button the popover hangs from
 * @param {() => Node|Node[]} render builds the body, called on every
 *   open so the contents always reflect current state
 * @param {{align?: 'left'|'right', className?: string,
 *          onOpen?: () => void, onClose?: () => void}} options
 * @returns {{open: Function, close: Function, toggle: Function,
 *            refresh: Function, get isOpen: boolean, node: HTMLElement}}
 */
export function popover(anchorEl, render, options = {}) {
  const { align = 'left', className = '', onOpen, onClose } = options;
  const node = el(`div.popover${className ? `.${className}` : ''}`);
  let open = false;

  const onDocumentPointerDown = (event) => {
    if (node.contains(event.target) || anchorEl.contains(event.target)) return;
    handle.close();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      handle.close();
      anchorEl.focus?.();
    }
  };
  const reposition = () => {
    if (open) place(node, anchorEl, align);
  };

  const handle = {
    node,
    get isOpen() {
      return open;
    },

    /** Rebuild the body in place; a no-op while closed. */
    refresh() {
      if (!open) return;
      node.replaceChildren(...[render()].flat().filter(Boolean));
      place(node, anchorEl, align);
    },

    open() {
      if (open) return;
      closePopover(); // only one at a time
      node.replaceChildren(...[render()].flat().filter(Boolean));
      document.body.append(node);
      open = true;
      openPopover = handle;
      anchorEl.setAttribute?.('aria-expanded', 'true');
      node.classList.add('open');
      place(node, anchorEl, align);
      // pointerdown, not click, so it also closes on a drag started elsewhere
      document.addEventListener('pointerdown', onDocumentPointerDown, true);
      document.addEventListener('keydown', onKeyDown);
      window.addEventListener('resize', reposition);
      window.addEventListener('scroll', reposition, true);
      onOpen?.();
    },

    close() {
      if (!open) return;
      open = false;
      if (openPopover === handle) openPopover = null;
      node.classList.remove('open');
      node.remove();
      anchorEl.setAttribute?.('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      onClose?.();
    },

    toggle() {
      if (open) handle.close();
      else handle.open();
    },
  };

  anchorEl.setAttribute?.('aria-expanded', 'false');
  anchorEl.addEventListener('click', (event) => {
    event.stopPropagation();
    handle.toggle();
  });

  return handle;
}
