/*
 *  NanoVNA-WebSaver -- a minimal stand-in for a <canvas> element and its
 *  2D context, so the chart classes can be drawn to and inspected under
 *  plain Node, without a browser.
 *
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *  Licensed under the GNU General Public License v3 or later.
 */

// Every drawing call is a no-op; what matters for these tests is that
// the chart classes run their real layout/scale math without throwing,
// so it can be asserted on afterwards (via chart._scale, chart.series,
// etc.) -- not that anything actually gets painted.

function fakeContext() {
  const noop = () => {};
  return {
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    rect: noop,
    clip: noop,
    arc: noop,
    fillRect: noop,
    strokeRect: noop,
    setLineDash: noop,
    setTransform: noop,
    clearRect: noop,
    fillText: noop,
    measureText: (text) => ({ width: String(text).length * 6 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
  };
}

/**
 * A fake canvas element sized `width`x`height` CSS pixels.
 *
 * `Chart#attach` and `Chart#resize` are the only things from `base.js`
 * this needs to satisfy: an event target, a 2D context, and a bounding
 * rect to size the backing store from.
 */
export function createFakeCanvas(width = 500, height = 350) {
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => fakeContext(),
    getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    setPointerCapture: () => {},
  };
}

/** `Chart#resize` reads `window.devicePixelRatio`; Node has no `window`. */
export function installWindowShim() {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = { devicePixelRatio: 1 };
  }
}
