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

// Drag-to-reorder for chart-grid panels: dragging a panel's header handle
// swaps DOM nodes live (cheap -- no chart instance is touched mid-drag)
// and only asks the caller to persist the new order once, on drop.
//
// The move and release listeners live on `window` rather than on the
// handle, deliberately. Pointer capture cannot be relied on here: this
// drag reorders the DOM, and moving an element releases the capture its
// subtree holds, so the first successful reorder would silently end the
// drag -- leaving the card stuck in its half-transparent dragging state
// and never committing the new order.

/**
 * @param {HTMLElement} handleEl the drag handle inside the panel's header
 * @param {HTMLElement} cardEl the panel's outer `.chart-card`
 * @param {{container: HTMLElement, onDrop: () => void}} options
 *   `onDrop` is called once the pointer is released, after the DOM has
 *   already been reordered; the caller reads the new order back out of
 *   `container.children`.
 */
export function attachPanelDrag(handleEl, cardEl, { container, onDrop }) {
  let pointerId = null;

  const cardsExcept = () =>
    [...container.children].filter((node) => node !== cardEl && node.classList.contains('chart-card'));

  const onMove = (event) => {
    if (event.pointerId !== pointerId) return;
    const target = cardsExcept().find((node) => {
      const rect = node.getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    });
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    container.insertBefore(cardEl, before ? target : target.nextSibling);
  };

  const finish = (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    cardEl.classList.remove('dragging');
    onDrop();
  };

  handleEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointerId !== null) return;
    pointerId = event.pointerId;
    cardEl.classList.add('dragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    event.preventDefault();
  });
}
