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

// The device control in the top right: "Connect" until a NanoVNA is
// attached, then the instrument's own name with its settings behind it.

import { button, checkbox, el, field, select } from './dom.js';
import { menuButton, menuHeading, menuRow } from './menu.js';
import { usbIcon } from './icons.js';
import { calibrationDialog } from './calibration.js';
import { serialSupported, serialUnsupportedReason } from '../device/transport.js';

/** Report a failure to the user without stopping the application. */
function guard(state, action) {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      state.setStatus(error.message);
      state.emit('error', error.message);
    }
  };
}

export function deviceMenu(state) {
  let ports = [];
  const calibration = calibrationDialog(state);

  const control = menuButton({
    label: 'Connect',
    icon: usbIcon(),
    align: 'right',
    className: 'menu-device',
    title: 'Device',
    render: () => body(),
  });

  const connectTo = (port) =>
    guard(state, async () => {
      await state.connect(port);
      control.menu.close();
    })();

  const addDevice = guard(state, async () => {
    const port = await state.requestNewPort();
    if (!port) return;
    await state.connect(port);
    control.menu.close();
  });

  /** What to show while nothing is connected: how to get connected. */
  function disconnectedBody() {
    const rows = [];
    if (!serialSupported()) {
      rows.push(el('p.warning', {}, serialUnsupportedReason()));
      return rows;
    }
    rows.push(menuRow(button('Add device…', addDevice, { variant: 'primary' })));
    if (ports.length) {
      rows.push(menuHeading('Ports already granted'));
      for (const entry of ports) {
        rows.push(menuRow(button(entry.label, () => connectTo(entry.port))));
      }
    } else {
      rows.push(
        el('p.muted', {}, 'The browser asks which serial port to share, once per device.'),
      );
    }
    // reachable without a device: a stored .cal can be loaded and read
    // back at any time from the advanced tab
    rows.push(menuHeading('Calibration'));
    rows.push(
      menuRow(
        button('Calibrate…', () => {
          control.menu.close();
          calibration.open();
        }),
      ),
    );
    return rows;
  }

  /** What to show once a device is talking: what it is, and its settings. */
  function connectedBody(device) {
    const rows = [menuHeading('Device')];
    const info = [
      ['Model', device.name],
      ['Firmware', String(device.version)],
      ['Hardware', String(device.hardwareRevision)],
      ['Serial number', device.serialNumber],
      ['Features', [...device.features].sort().join(', ') || 'none reported'],
    ];
    rows.push(
      el(
        'dl.info-list',
        {},
        ...info.flatMap(([label, value]) => [el('dt', {}, label), el('dd', {}, String(value))]),
      ),
    );

    rows.push(menuHeading('Settings'));
    if (device.validDatapoints.length > 1) {
      rows.push(
        field(
          'Data points',
          select(
            device.validDatapoints.map((v) => [v, String(v)]),
            device.datapoints,
            (event) => {
              device.datapoints = Number(event.target.value);
              state.sweep.setPoints(device.datapoints);
              state.emit('sweep', state.sweep);
              state.emit('device', device);
            },
          ),
        ),
      );
    }

    if (device.features.has('Bandwidth')) {
      const bandwidthSelect = el('select.input', {
        on: {
          change: guard(state, async (event) => {
            await device.setBandwidth(Number(event.target.value));
            state.setStatus(`Bandwidth set to ${device.bandwidth} Hz`);
          }),
        },
      });
      bandwidthSelect.append(
        el('option', { value: String(device.bandwidth), textContent: `${device.bandwidth} Hz` }),
      );
      device
        .getBandwidths()
        .then((values) => {
          bandwidthSelect.replaceChildren();
          for (const value of values) {
            bandwidthSelect.append(
              el('option', {
                value: String(value),
                textContent: `${value} Hz`,
                selected: value === device.bandwidth,
              }),
            );
          }
          bandwidthSelect.value = String(device.bandwidth);
        })
        .catch(() => {});
      rows.push(field('Bandwidth', bandwidthSelect));
    }

    rows.push(
      checkbox('Validate incoming data', device.validateInput, (event) => {
        device.validateInput = event.target.checked;
      }),
    );

    rows.push(menuHeading('Calibration'));
    rows.push(
      menuRow(
        button('Calibrate…', () => {
          control.menu.close();
          calibration.open();
        }, { variant: 'primary', title: 'Measure the calibration standards' }),
        el(
          'span.muted',
          {},
          state.calibration.isCalculated ? 'applied' : 'not applied',
        ),
      ),
    );

    const actions = [];
    if (device.features.has('Screenshots')) {
      actions.push(
        button(
          'Capture screen',
          guard(state, async () => {
            state.setStatus('Capturing the device screen…');
            const image = await device.captureScreen();
            if (!image) throw new Error('The device did not return a screenshot');
            state.emit('screenshot', image);
            state.setStatus('Screen captured');
            control.menu.close();
          }),
        ),
      );
    }
    actions.push(
      button(
        'Disconnect',
        guard(state, async () => {
          await state.disconnect();
          control.menu.close();
        }),
        { variant: 'danger' },
      ),
    );
    rows.push(menuRow(...actions));
    return rows;
  }

  function body() {
    return state.device ? connectedBody(state.device) : disconnectedBody();
  }

  const refreshPorts = async () => {
    try {
      ports = await state.listPorts();
    } catch {
      ports = [];
    }
    control.menu.refresh();
  };

  state.on('device', (device) => {
    control.setLabel(device ? device.name : 'Connect');
    control.node.classList.toggle('connected', !!device);
    refreshPorts();
  });

  refreshPorts();
  return control;
}
