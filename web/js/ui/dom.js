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

// Small helpers for building the interface. Text always goes in through
// textContent, so a device or a file can never inject markup.

/**
 * Build an element.
 *
 * @param {string} tag optionally with .classes, as in 'div.panel.wide'
 * @param {object} attrs properties, plus `dataset`, `style` and `on`
 * @param {...(Node|string)} children
 */
export function el(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name);
  if (classes.length) node.className = classes.join(' ');

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'on') {
      for (const [event, handler] of Object.entries(value)) {
        node.addEventListener(event, handler);
      }
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style') {
      Object.assign(node.style, value);
    } else if (key === 'class') {
      node.className = node.className ? `${node.className} ${value}` : value;
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clear = (node) => {
  while (node.firstChild) node.firstChild.remove();
  return node;
};

/** A labelled form row. */
export function field(label, control, hint) {
  return el(
    'label.field',
    {},
    el('span.field-label', {}, label),
    control,
    hint ? el('span.field-hint', {}, hint) : null,
  );
}

export function button(label, onClick, options = {}) {
  return el('button.btn', {
    type: 'button',
    textContent: label,
    title: options.title ?? '',
    disabled: !!options.disabled,
    class: options.variant ? `btn-${options.variant}` : '',
    on: { click: onClick },
  });
}

export function select(options, value, onChange, attrs = {}) {
  const node = el('select.input', { ...attrs, on: { change: onChange } });
  for (const option of options) {
    const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option];
    node.append(
      el('option', { value: optionValue, textContent: optionLabel,
                     selected: String(optionValue) === String(value) }),
    );
  }
  node.value = value;
  return node;
}

export function textInput(value, onChange, attrs = {}) {
  return el('input.input', {
    type: 'text',
    value: value ?? '',
    ...attrs,
    on: { change: onChange },
  });
}

export function numberInput(value, onChange, attrs = {}) {
  return el('input.input', {
    type: 'number',
    value: value ?? 0,
    ...attrs,
    on: { change: onChange },
  });
}

export function checkbox(label, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked, on: { change: onChange } });
  return el('label.check', {}, input, el('span', {}, label));
}

/** Read a file the user picked, as text. */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsText(file);
  });
}

/** Offer text to the user as a download. */
export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  // give the browser a moment to start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Offer a canvas as a PNG download. */
export function downloadCanvas(filename, canvas) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, 'image/png');
}

/** Prompt the user to choose a file, resolving to it or null. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve(input.files && input.files[0] ? input.files[0] : null);
      input.remove();
    });
    // a cancelled picker fires no event in most browsers, so the promise
    // simply never settles; the element is cleaned up either way
    document.body.append(input);
    input.click();
  });
}
