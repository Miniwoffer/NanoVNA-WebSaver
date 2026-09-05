This is just a lazy vibe coded web port of the amazing [nanovna-saver](https://github.com/NanoVNA-Saver/nanovna-saver) project!
I wanted something running in the browser while playing with my NanoVNA-H4!

Try it out at: https://miniwoffer.github.io/NanoVNA-WebSaver/

# NanoVNA-WebSaver

Read, display, analyse and export Touchstone data from a NanoVNA, in the
browser. The device is reached over the [Web Serial API][webserial], and
the RF maths, calibration, analyses and charts are all client side: there
is no backend, no build step, no dependencies and nothing to install.

It began as a rewrite of the [NanoVNA-Saver][upstream] desktop
application, and carries its feature set across — the same device
support, the same segmented sweeps, the same SOLT calibration and file
formats, the same analyses.

* Copyright 2019, 2020 Rune B. Broberg
* Copyright 2020ff NanoVNA-Saver Authors

Licensed under the GNU General Public License v3 or later; see
`licenses/LICENSE.txt`.

[upstream]: https://github.com/NanoVNA-Saver/nanovna-saver

## Running it

The application is a static site. It needs to be *served* rather than
opened from the file system, because ES modules and the Web Serial API
both require an origin, and Web Serial additionally requires a secure
context — which `http://localhost` counts as.

```sh
make web-serve          # then open http://localhost:8000
```

or, without the Makefile:

```sh
cd web && python3 -m http.server 8000 --bind 127.0.0.1
```

Deploying it anywhere that serves static files over https works too;
`web/` is the document root and has no build step.

### Browser support

Talking to a device needs the Web Serial API, which is available in
Chrome, Edge and Opera on the desktop. Firefox and Safari do not
implement it; there the application still opens, and loading, analysing
and exporting Touchstone files all work — only the live connection is
unavailable. The application says so rather than failing silently.

## Using it

The window is a topbar of menus, a grid of chart panels, the marker
readouts floating over them, and the frequency range bar along the
bottom.

1. Press **Connect** in the top right and pick the serial port in the
   browser's chooser. The device is identified and its driver selected
   automatically, exactly as the desktop application does it. Once
   connected the button becomes the instrument's name, with its settings
   and **Calibrate…** behind it.
2. Set the range in the **Sweep** menu, or drag the range bar along the
   bottom, then press **Sweep**, **Continuous** or **Averaged**. A
   running continuous sweep follows the range as you change it.
3. Drag on a chart to zoom into a span. Drag a marker, or click a chart,
   to move the nearest marker. Use the range bar to get back out again:
   drag its middle to move the sweep, its ends to set start and stop, or
   roll the wheel over it to change the span.
4. The chart grid is a Grafana-style dashboard: drag a panel by its
   header to reorder it, drag its bottom-right corner to resize it across
   columns and rows, and use its **⚙** button to add, remove or rearrange
   the chart types it overlays and to lock an axis to a fixed range
   instead of autoscaling. **+ Add panel** adds a new one.
5. The marker cards on the right expand to show their readouts, and each
   marker picks its own — impedance on one, VSWR on another.
6. **Recording** captures a run of sweeps with the time between them,
   and plays it back over the charts afterwards.

Settings, the sweep, the markers and the chart layout — including each
panel's size, position, combined chart types and axis limits — are
remembered in the browser's local storage.

## What is supported

The feature set follows the desktop application.

**Devices.** NanoVNA, ‑H, ‑H4, ‑F, ‑F_V2, ‑F_V3, SV4401A, SV6301A,
JNCRadio VNA 3G, AVNA and tinySA / tinySA Ultra over the v1 text
protocol; NanoVNA V2 (S‑A‑A‑2) and LiteVNA‑64 over the V2 binary register
protocol. Device screen capture is supported where the firmware offers
it.

**Sweeping.** Segmented sweeps for more than one segment of points,
logarithmic spacing, single, continuous and averaged modes, and dropping
extrema from an average.

**Calibration.** One and two port SOLT, with ideal standards or a
calibration kit defined by its polynomial coefficients and electrical
delays. Calibrations load and save in the same `.cal` format the desktop
application uses.

**Charts.** 26 chart types: return loss, VSWR, phase, |S11|, |Z|, R+jX,
Q, group delay, series C and L, real/imaginary, permeability, µ'/µ'', the
Smith chart, S21 gain, phase, polar, |Z| and R+jX in shunt and series
form, the combined S11/S21 log magnitude chart, and TDR. Reference traces
and amateur band overlays draw on all of them.

**Chart grid.** A Grafana-style dashboard: panels can span multiple grid
columns and rows, be dragged into a new order, and combine any number of
chart types in one panel. Frequency-axis chart types (return loss, VSWR,
phase, gain, R+jX, and so on) overlay as multiple traces on shared or
independent left/right Y axes with a legend; Smith, Polar and TDR each
draw as their own mini-chart alongside the others in the same panel. Any
axis can be locked to a fixed range (handy for keeping VSWR from
autoscaling out to a decade) or left on autoscale.

**Markers.** Any number of markers, floating over the right of the
charts as collapsible cards. Each picks its own readouts from the full
table — impedance, admittance, series and parallel equivalents, VSWR,
return loss, Q, group delay and the S21 readouts.

**Recording.** A run of sweeps captured with the time between them, with
playback over the charts at real time or faster, and export and import
as a JSON file.

**Analysis.** Peak search, simple peak search, VSWR, resonance, EFHW,
magnetic loop tuning, and high pass, low pass, band pass and band stop
filter characterisation.

**Files.** Touchstone `s1p` and `s2p` import and export, for the sweep
and for the reference trace, in the `RI`, `MA` and `dB` formats.

## Layout

```
web/
  index.html          the shell
  css/app.css
  js/
    main.js           entry point
    app/              state, sweep runner, markers, bands, recorder
    charts/           the chart engine and the chart catalogue
    device/           Web Serial transport, drivers, device detection
    rf/               RF maths, Touchstone, calibration, analyses, TDR
    ui/               DOM helpers and every piece of interface: the
                      topbar menus, the chart grid and its drags, the
                      marker overlay, the range bar, the calibration
                      wizard
  tests/              the test suite, run under node
```

The `rf/`, `app/` and `device/` modules are ports of the corresponding
Python in the upstream desktop application, and the tests check them
against reference vectors generated from it.

## Tests

```sh
make web-test           # or: node web/tests/run.js <suite...>
```

The suite runs under plain node with no dependencies. It covers the RF
maths, the SI formatting, Touchstone parsing and writing, the sweep
model, the calibration solver, the analyses, the FFT and window
functions, TDR, the serial transport and every device driver — the
drivers against simulated devices that speak the real protocols.

`web/tests/reference.json` holds vectors generated by the desktop
implementation and by numpy and scipy, and `web/tests/data/` the
Touchstone and calibration fixtures from its test suite, so the port is
checked against the original rather than against itself.

## Known differences from the desktop application

- `calculate_rolloff` in the Python indexes with `-1` when a cutoff point
  was not found, which silently reads the last sweep point. Here that
  case reports no roll-off, and the display shows `-`.
- The desktop stores its settings in `QSettings`; the browser stores them
  in local storage, per origin.
- Sweeps run on the page's main task rather than a worker thread. The
  runner yields between segments and between averages, so the interface
  stays responsive during long sweeps.

[webserial]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
