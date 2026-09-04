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

// Drag-to-resize for chart-grid panels: dragging the handle at a panel's
// bottom-right corner grows/shrinks how many grid columns/rows it spans.
// The card's own current size at drag-start calibrates one column's and
// one row's pixel size, so this works regardless of how the grid actually
// laid things out.

import { MAX_ROW_SPAN, clampSpan } from '../charts/registry.js';

/**
 * @param {HTMLElement} handleEl the resize handle at the card's corner
 * @param {HTMLElement} cardEl the panel's outer `.chart-card`, whose
 *   `dataset.colSpan`/`dataset.rowSpan` reflect its current span
 * @param {{columns: number, onCommit: (colSpan: number, rowSpan: number) => void}} options
 */
export function attachPanelResize(handleEl, cardEl, { columns, onCommit }) {
  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startColSpan = 1;
  let startRowSpan = 1;
  let colWidth = 1;
  let rowHeight = 1;
  let colSpan = 1;
  let rowSpan = 1;

  handleEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    pointerId = event.pointerId;
    handleEl.setPointerCapture?.(pointerId);
    const cardRect = cardEl.getBoundingClientRect();
    startColSpan = colSpan = Number(cardEl.dataset.colSpan) || 1;
    startRowSpan = rowSpan = Number(cardEl.dataset.rowSpan) || 1;
    colWidth = cardRect.width / startColSpan;
    rowHeight = cardRect.height / startRowSpan;
    startX = event.clientX;
    startY = event.clientY;
    cardEl.classList.add('resizing');
    event.preventDefault();
    event.stopPropagation();
  });

  handleEl.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    colSpan = clampSpan(startColSpan + Math.round(dx / colWidth), columns);
    rowSpan = clampSpan(startRowSpan + Math.round(dy / rowHeight), MAX_ROW_SPAN);
    cardEl.style.gridColumn = `span ${colSpan}`;
    cardEl.style.gridRow = `span ${rowSpan}`;
  });

  const finish = (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    cardEl.classList.remove('resizing');
    if (colSpan !== startColSpan || rowSpan !== startRowSpan) {
      cardEl.dataset.colSpan = String(colSpan);
      cardEl.dataset.rowSpan = String(rowSpan);
      onCommit(colSpan, rowSpan);
    }
  };

  handleEl.addEventListener('pointerup', finish);
  handleEl.addEventListener('pointercancel', finish);
}
