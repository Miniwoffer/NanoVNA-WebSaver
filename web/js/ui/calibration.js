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

// Calibration, in two modes.
//
// "Basic" walks through one standard per step, in the order the NanoVNA
// documentation gives, and is what most people want: connect this, press
// that, move on. "Advanced" is the full board -- every standard on one
// screen, the calibration kit's coefficients, notes, and loading and
// saving .cal files -- for people who know which knob they came for.

import {
  button,
  checkbox,
  downloadText,
  el,
  field,
  numberInput,
  pickFile,
  readFileAsText,
} from './dom.js';
import { modal } from './modal.js';
import { STANDARDS } from '../rf/calibration.js';
import { formatFrequencySweep } from '../util/format.js';

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

/**
 * The guided sequence, in the order the NanoVNA documentation gives.
 *
 * `port2` marks the steps that only matter for a two port calibration,
 * which are skipped when the user says they are calibrating one port.
 */
const WIZARD_STEPS = [
  {
    standard: 'short',
    title: 'Short',
    instruction: 'Connect the SHORT standard to port 1 (CH0).',
  },
  {
    standard: 'open',
    title: 'Open',
    instruction: 'Connect the OPEN standard to port 1 (CH0).',
  },
  {
    standard: 'load',
    title: 'Load',
    instruction: 'Connect the LOAD standard to port 1 (CH0).',
  },
  {
    standard: 'isolation',
    title: 'Isolation',
    instruction:
      'Connect the LOAD standard to port 1 (CH0) and port 2 (CH1). ' +
      'With only one load, connect it to port 1 and leave port 2 open.',
    port2: true,
  },
  {
    standard: 'through',
    title: 'Through',
    instruction:
      'Connect your cables to port 1 (CH0) and port 2 (CH1) and join them ' +
      'with a through connector.',
    port2: true,
  },
  {
    standard: 'thrurefl',
    title: 'Through reflection',
    instruction:
      'Leave the through connection in place. This reading measures what the ' +
      'cables reflect as well as what they pass.',
    port2: true,
  },
];

export function calibrationDialog(state) {
  /** 'basic' or 'advanced' */
  let mode = 'basic';
  let twoPort = false;
  let step = 0;

  const dialog = modal({
    title: 'Calibration',
    render: () => [tabs(), mode === 'basic' ? basicBody() : advancedBody()],
  });

  const refresh = () => dialog.refresh();
  state.on('calibration', refresh);
  state.on('data', refresh);

  function tabs() {
    const tab = (key, label) =>
      el('button.tab', {
        type: 'button',
        textContent: label,
        class: mode === key ? 'active' : '',
        on: {
          click: () => {
            mode = key;
            refresh();
          },
        },
      });
    return el('div.tabs', {}, tab('basic', 'Basic'), tab('advanced', 'Advanced'));
  }

  /** The status line both modes show. */
  function statusList() {
    const cal = state.calibration;
    const lines = [
      ['Source', cal.source],
      ['Points', String(cal.size())],
      [
        'Range',
        cal.size()
          ? `${formatFrequencySweep(cal.dataset.freqMin())} to ${formatFrequencySweep(cal.dataset.freqMax())}`
          : '-',
      ],
      ['One port', cal.isValid1Port() ? 'complete' : 'incomplete'],
      ['Two port', cal.isValid2Port() ? 'complete' : 'incomplete'],
      ['Applied', cal.isCalculated ? 'yes' : 'no'],
    ];
    return el(
      'dl.info-list',
      {},
      ...lines.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]),
    );
  }

  // ------------------------------------------------------------- basic

  const activeSteps = () => WIZARD_STEPS.filter((s) => twoPort || !s.port2);

  function basicBody() {
    const steps = activeSteps();
    if (step >= steps.length) return finishBody(steps);

    const here = steps[step];
    const measured = state.calibration.dataSize(here.standard);
    const rows = [];

    rows.push(
      el(
        'div.wizard-progress',
        {},
        ...steps.map((s, i) =>
          el('span.wizard-pip', {
            class: i === step ? 'current' : state.calibration.dataSize(s.standard) ? 'done' : '',
            textContent: s.title,
          }),
        ),
      ),
    );

    if (step === 0) {
      rows.push(
        el(
          'div.wizard-setup',
          {},
          checkbox('Calibrate both ports (S21 as well as S11)', twoPort, (event) => {
            twoPort = event.target.checked;
            refresh();
          }),
          el(
            'p.muted',
            {},
            'Set the sweep range you intend to measure before you start: a ' +
              'calibration only holds for the range it was taken over.',
          ),
        ),
      );
    }

    rows.push(el('h3.wizard-title', {}, `Step ${step + 1} of ${steps.length}: ${here.title}`));
    rows.push(el('p.wizard-instruction', {}, here.instruction));
    rows.push(
      el(
        'p.muted',
        {},
        'Take the reading once the trace has settled. Each one sweeps the ' +
          'current range and stores the result.',
      ),
    );
    rows.push(
      el(
        'p.wizard-status',
        {},
        measured ? `Measured: ${measured} points.` : 'Not measured yet.',
      ),
    );

    const measure = button(
      measured ? 'Measure again' : 'Measure',
      guard(state, async () => {
        state.setStatus(`Measuring ${here.title.toLowerCase()}…`);
        await state.captureStandard(here.standard);
        refresh();
      }),
      { variant: 'primary' },
    );

    rows.push(
      el(
        'div.wizard-actions',
        {},
        button('Back', () => {
          step = Math.max(0, step - 1);
          refresh();
        }, { disabled: step === 0 }),
        measure,
        button('Next', () => {
          step += 1;
          refresh();
        }, { disabled: !measured }),
      ),
    );
    return rows;
  }

  function finishBody(steps) {
    const cal = state.calibration;
    const ready = twoPort ? cal.isValid2Port() : cal.isValid1Port();
    return [
      el('h3.wizard-title', {}, 'Finish'),
      statusList(),
      el(
        'p',
        {},
        ready
          ? 'Every standard has been measured. Applying calculates the error ' +
            'correction and starts correcting the sweep.'
          : 'Some standards are still missing; step back and measure them.',
      ),
      el(
        'div.wizard-actions',
        {},
        button('Back', () => {
          step = steps.length - 1;
          refresh();
        }),
        button(
          'Apply calibration',
          guard(state, () => {
            state.applyCalibration();
            state.setStatus('Calibration applied');
            dialog.close();
          }),
          { variant: 'primary', disabled: !ready },
        ),
        button('Start again', () => {
          state.resetCalibration();
          step = 0;
          refresh();
        }, { variant: 'danger' }),
      ),
    ];
  }

  // ---------------------------------------------------------- advanced

  // the calibration kit definition, in the units the desktop dialog uses
  const KIT_FIELDS = [
    ['shortL0', 'Short L0 (e-12)', 1e-12],
    ['shortL1', 'Short L1 (e-24)', 1e-24],
    ['shortL2', 'Short L2 (e-33)', 1e-33],
    ['shortL3', 'Short L3 (e-42)', 1e-42],
    ['shortLength', 'Short delay (ps)', 1e-12],
    ['openC0', 'Open C0 (e-15)', 1e-15],
    ['openC1', 'Open C1 (e-27)', 1e-27],
    ['openC2', 'Open C2 (e-36)', 1e-36],
    ['openC3', 'Open C3 (e-45)', 1e-45],
    ['openLength', 'Open delay (ps)', 1e-12],
    ['loadR', 'Load R (Ω)', 1],
    ['loadL', 'Load L (e-12)', 1e-12],
    ['loadC', 'Load C (e-15)', 1e-15],
    ['loadLength', 'Load delay (ps)', 1e-12],
    ['throughLength', 'Through delay (ps)', 1e-12],
  ];

  function advancedBody() {
    const cal = state.calibration;
    const notes = el('textarea.input', {
      rows: 2,
      placeholder: 'Notes saved with the calibration',
      value: cal.notes.join('\n'),
      on: {
        change: (event) => {
          cal.notes = event.target.value.split('\n');
        },
      },
    });

    const kit = el('div.grid2', { hidden: cal.calElement.throughIsIdeal });
    for (const [key, label, scale] of KIT_FIELDS) {
      kit.append(
        field(
          label,
          numberInput(cal.calElement[key] / scale, (event) => {
            cal.calElement[key] = Number(event.target.value) * scale;
          }, { step: 'any' }),
        ),
      );
    }

    const standards = el(
      'div.cal-standards',
      {},
      ...STANDARDS.map((name) => {
        const count = cal.dataSize(name);
        return el(
          'div.cal-standard',
          {},
          el('span.cal-name', {}, name),
          el('span.cal-count', {}, count ? `${count} points` : 'not measured'),
          button('Save', guard(state, () => state.captureStandard(name)), {
            title: `Store the current sweep as ${name}`,
          }),
          button('Clear', () => state.clearStandard(name)),
        );
      }),
    );

    return [
      statusList(),
      standards,
      checkbox('Ideal calibration standards', cal.calElement.throughIsIdeal, (event) => {
        const value = event.target.checked ? 'IDEAL' : 'COEFF';
        const element = cal.calElement;
        element.shortState = value;
        element.openState = value;
        element.loadState = value;
        element.throughIsIdeal = event.target.checked;
        kit.hidden = event.target.checked;
      }),
      kit,
      field('Notes', notes),
      el(
        'div.wizard-actions',
        {},
        button('Apply', guard(state, () => {
          state.applyCalibration();
          dialog.close();
        }), { variant: 'primary' }),
        button('Reset', () => state.resetCalibration()),
        button('Load .cal', guard(state, async () => {
          const file = await pickFile('.cal,text/plain');
          if (!file) return;
          state.loadCalibration(await readFileAsText(file), file.name);
          state.setStatus(`Loaded calibration ${file.name}`);
        })),
        button('Save .cal', guard(state, () => {
          downloadText('calibration.cal', state.saveCalibration());
        })),
      ),
    ];
  }

  return {
    open() {
      step = 0;
      dialog.open();
    },
    close: () => dialog.close(),
    get isOpen() {
      return dialog.isOpen;
    },
  };
}
