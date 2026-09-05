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

// The sidebar panels: the same controls the desktop application keeps in
// its docks and dialogs.

import {
  button,
  checkbox,
  clear,
  downloadText,
  el,
  field,
  numberInput,
  panel,
  pickFile,
  readFileAsText,
  select,
  textInput,
} from './dom.js';
import { formatFrequencySweep, parseFrequency } from '../util/format.js';
import { SweepMode } from '../rf/sweep.js';
import { STANDARDS } from '../rf/calibration.js';
import { READOUT_TYPES } from '../app/markers.js';
import { ANALYSES, AnalysisError, Context, runAnalysis } from '../rf/analysis/index.js';
import { CABLE_PARAMETERS, FORMATS as TDR_FORMATS, WINDOWS as TDR_WINDOWS } from '../rf/tdr.js';
import { BAND_REGIONS } from '../app/bands.js';

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

// -------------------------------------------------------------- sweep

export function sweepPanel(state) {
  /** Apply a sweep change, putting the fields back if it is rejected. */
  const apply = (changes) => {
    try {
      state.updateSweep(changes);
    } catch (error) {
      state.setStatus(error.message);
      render();
    }
  };

  const startInput = textInput('', () => {});
  const endInput = textInput('', () => {});
  const centerInput = textInput('', () => {});
  const spanInput = textInput('', () => {});
  const segmentsInput = numberInput(1, () => {}, { min: 1, max: 1000, step: 1 });
  const averagesInput = numberInput(3, () => {}, { min: 1, max: 100, step: 1 });
  const truncatesInput = numberInput(0, () => {}, { min: 0, max: 99, step: 1 });
  const nameInput = textInput('', (event) => apply({ name: event.target.value }));
  const logarithmic = checkbox('Logarithmic sweep', false, (event) =>
    apply({ logarithmic: event.target.checked }));
  const pointsLabel = el('span.muted');
  const progress = el('progress.progress', { max: 100, value: 0 });

  const applyRange = () => {
    const start = parseFrequency(startInput.value);
    const end = parseFrequency(endInput.value);
    if (start < 0 || end < 0) {
      state.setStatus('Could not read that frequency');
      render();
      return;
    }
    apply({ start, end });
  };

  const applyCenterSpan = () => {
    const center = parseFrequency(centerInput.value);
    const span = parseFrequency(spanInput.value);
    if (center < 0 || span < 0) {
      state.setStatus('Could not read that frequency');
      render();
      return;
    }
    apply({
      start: Math.max(1, Math.round(center - span / 2)),
      end: Math.round(center + span / 2),
    });
  };

  startInput.addEventListener('change', applyRange);
  endInput.addEventListener('change', applyRange);
  centerInput.addEventListener('change', applyCenterSpan);
  spanInput.addEventListener('change', applyCenterSpan);
  segmentsInput.addEventListener('change', () =>
    apply({ segments: Number(segmentsInput.value) }));
  averagesInput.addEventListener('change', () =>
    apply({ averages: Number(averagesInput.value) }));
  truncatesInput.addEventListener('change', () =>
    apply({ truncates: Number(truncatesInput.value) }));

  const startButton = button(
    'Sweep',
    guard(state, () => state.startSweep(SweepMode.SINGLE)),
    { variant: 'primary' },
  );
  const continuousButton = button(
    'Continuous',
    guard(state, () => state.startSweep(SweepMode.CONTINOUS)),
  );
  const averageButton = button(
    'Averaged',
    guard(state, () => state.startSweep(SweepMode.AVERAGE)),
  );
  const stopButton = button('Stop', () => state.stopSweep());

  const node = panel(
    'Sweep',
    el('div.grid2', {},
      field('Start', startInput),
      field('Stop', endInput),
      field('Center', centerInput),
      field('Span', spanInput)),
    el('div.grid2', {},
      field('Segments', segmentsInput),
      field('Points', pointsLabel)),
    logarithmic,
    el('div.grid2', {},
      field('Averages', averagesInput),
      field('Drop extrema', truncatesInput)),
    field('Sweep name', nameInput),
    el('div.row', {}, startButton, continuousButton, averageButton, stopButton),
    progress,
  );

  function render() {
    const sweep = state.sweep;
    startInput.value = formatFrequencySweep(sweep.start);
    endInput.value = formatFrequencySweep(sweep.end);
    centerInput.value = formatFrequencySweep(Math.round((sweep.start + sweep.end) / 2));
    spanInput.value = formatFrequencySweep(sweep.span);
    segmentsInput.value = sweep.segments;
    averagesInput.value = sweep.properties.averages[0];
    truncatesInput.value = sweep.properties.averages[1];
    nameInput.value = sweep.properties.name;
    logarithmic.querySelector('input').checked = sweep.properties.logarithmic;
    pointsLabel.textContent = `${sweep.points} x ${sweep.segments} = ${sweep.totalPoints}`;
  }

  state.on('sweep', render);
  state.on('sweepState', ({ running, percentage }) => {
    progress.value = percentage;
    startButton.disabled = running;
    continuousButton.disabled = running;
    averageButton.disabled = running;
    stopButton.disabled = !running;
  });
  state.on('device', () => {
    const connected = state.connected;
    startButton.disabled = !connected;
    continuousButton.disabled = !connected;
    averageButton.disabled = !connected;
  });

  render();
  stopButton.disabled = true;
  startButton.disabled = true;
  continuousButton.disabled = true;
  averageButton.disabled = true;
  return node;
}

// ------------------------------------------------------------ markers

export function markerPanel(state) {
  const list = el('div.markers');
  const readoutPicker = el('details.readout-picker');

  const render = () => {
    clear(list);
    state.markers.forEach((marker, index) => {
      const readouts = state.markerReadouts(index);
      const freqInput = textInput(
        readouts ? readouts.values.actualfreq : '',
        (event) => {
          const freq = parseFrequency(event.target.value);
          if (freq >= 0) state.setMarkerFrequency(index, freq);
          else render();
        },
      );

      const rows = state.settings.readouts
        .map((id) => {
          const type = READOUT_TYPES.find((t) => t.id === id);
          const value = readouts ? readouts.values[id] : null;
          if (!type || value === undefined || value === null) return null;
          return el('div.readout', {},
            el('span.readout-label', {}, type.name),
            el('span.readout-value', {}, value));
        })
        .filter(Boolean);

      list.append(
        el(
          'div.marker',
          { style: { borderLeftColor: marker.color } },
          el('div.marker-head', {},
            el('input', {
              type: 'color',
              value: marker.color,
              title: 'Marker colour',
              on: { input: (e) => state.updateMarker(index, { color: e.target.value }) },
            }),
            textInput(marker.name, (e) => state.updateMarker(index, { name: e.target.value }),
                      { class: 'marker-name' }),
            checkbox('', marker.enabled, (e) =>
              state.updateMarker(index, { enabled: e.target.checked })),
            button('x', () => state.removeMarker(index), { title: 'Remove this marker' }),
          ),
          field('Frequency', freqInput),
          el('div.readouts', {}, ...rows),
        ),
      );
    });
    list.append(el('div.row', {}, button('Add marker', () => state.addMarker())));
  };

  const renderPicker = () => {
    clear(readoutPicker);
    readoutPicker.append(el('summary', {}, 'Readouts shown'));
    for (const type of READOUT_TYPES) {
      readoutPicker.append(
        checkbox(type.description, state.settings.readouts.includes(type.id), (event) => {
          const readouts = new Set(state.settings.readouts);
          if (event.target.checked) readouts.add(type.id);
          else readouts.delete(type.id);
          // keep the canonical order rather than click order
          state.updateSettings({
            readouts: READOUT_TYPES.filter((t) => readouts.has(t.id)).map((t) => t.id),
          });
          render();
        }),
      );
    }
  };

  const node = panel('Markers', list, readoutPicker);
  state.on('markers', render);
  state.on('data', render);
  state.on('settings', render);
  render();
  renderPicker();
  return node;
}

// -------------------------------------------------------- calibration

export function calibrationPanel(state) {
  const status = el('div.info');
  const standardRows = el('div.cal-standards');
  const notes = el('textarea.input', { rows: 2, placeholder: 'Notes saved with the calibration' });

  notes.addEventListener('change', () => {
    state.calibration.notes = notes.value.split('\n');
  });

  const useIdeal = checkbox('Ideal calibration standards', true, (event) => {
    const mode = event.target.checked ? 'IDEAL' : 'COEFF';
    const element = state.calibration.calElement;
    element.shortState = mode;
    element.openState = mode;
    element.loadState = mode;
    element.throughIsIdeal = event.target.checked;
    kit.hidden = event.target.checked;
  });

  // the calibration kit definition, in the units the desktop dialog uses
  const kitFields = [
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

  const kit = el('div.grid2', { hidden: true });
  for (const [key, label, scale] of kitFields) {
    const input = numberInput(state.calibration.calElement[key] / scale, (event) => {
      state.calibration.calElement[key] = Number(event.target.value) * scale;
    }, { step: 'any' });
    kit.append(field(label, input));
  }

  const renderStandards = () => {
    clear(standardRows);
    for (const name of STANDARDS) {
      const count = state.calibration.dataSize(name);
      standardRows.append(
        el(
          'div.cal-standard',
          {},
          el('span.cal-name', {}, name),
          el('span.cal-count', {}, count ? `${count} points` : 'not measured'),
          button('Save', guard(state, () => state.captureStandard(name)),
                 { title: `Store the current sweep as ${name}` }),
          button('Clear', () => state.clearStandard(name)),
        ),
      );
    }
  };

  const renderStatus = () => {
    const cal = state.calibration;
    clear(status);
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
    status.append(
      el('dl.info-list', {}, ...lines.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
    );
    notes.value = cal.notes.join('\n');
    renderStandards();
  };

  const node = panel(
    'Calibration',
    status,
    standardRows,
    useIdeal,
    kit,
    field('Notes', notes),
    el(
      'div.row',
      {},
      button('Apply', guard(state, () => state.applyCalibration()), { variant: 'primary' }),
      button('Reset', () => state.resetCalibration()),
    ),
    el(
      'div.row',
      {},
      button(
        'Load .cal',
        guard(state, async () => {
          const file = await pickFile('.cal,text/plain');
          if (!file) return;
          state.loadCalibration(await readFileAsText(file), file.name);
          state.setStatus(`Loaded calibration ${file.name}`);
        }),
      ),
      button(
        'Save .cal',
        guard(state, () => {
          downloadText('calibration.cal', state.saveCalibration());
        }),
      ),
    ),
  );

  state.on('calibration', renderStatus);
  state.on('data', renderStandards);
  renderStatus();
  return node;
}

// -------------------------------------------------------------- files

export function filesPanel(state) {
  const node = panel(
    'Files',
    el(
      'div.row',
      {},
      button(
        'Load sweep',
        guard(state, async () => {
          const file = await pickFile('.s1p,.s2p,.snp,text/plain');
          if (!file) return;
          state.loadTouchstone(await readFileAsText(file), file.name, 'data');
        }),
        { variant: 'primary' },
      ),
      button(
        'Load reference',
        guard(state, async () => {
          const file = await pickFile('.s1p,.s2p,.snp,text/plain');
          if (!file) return;
          state.loadTouchstone(await readFileAsText(file), file.name, 'reference');
          state.setStatus(`Loaded reference ${file.name}`);
        }),
      ),
    ),
    el(
      'div.row',
      {},
      button(
        'Save s1p',
        guard(state, () => {
          const name = state.sweep.properties.name || 'sweep';
          downloadText(`${safeName(name)}.s1p`, state.saveTouchstone(1));
        }),
      ),
      button(
        'Save s2p',
        guard(state, () => {
          const name = state.sweep.properties.name || 'sweep';
          downloadText(`${safeName(name)}.s2p`, state.saveTouchstone(2));
        }),
      ),
    ),
    el(
      'div.row',
      {},
      button('Set reference', () => state.setReferenceFromData()),
      button('Clear reference', () => state.clearReference()),
      button('Clear sweep', () => state.clearData()),
    ),
  );
  return node;
}

function safeName(name) {
  const cleaned = name.replace(/[^\w\-. ]+/g, '').trim();
  return cleaned || 'sweep';
}

// ------------------------------------------------------------ display

export function displayPanel(state, chartGrid) {
  const node = panel(
    'Display',
    field(
      'Theme',
      select(
        [['system', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']],
        state.settings.theme,
        (event) => state.updateSettings({ theme: event.target.value }),
      ),
    ),
    el(
      'p.field-hint',
      {},
      'Add, remove, resize and rearrange panels directly in the chart grid above.',
    ),
    field(
      'Columns',
      select([1, 2, 3, 4].map((v) => [v, String(v)]), state.settings.columns, (event) => {
        state.updateSettings({ columns: Number(event.target.value) });
        // a narrower grid may have re-clamped some panels' colSpan
        chartGrid.rebuild();
      }),
    ),
    checkbox('Draw lines between points', state.settings.drawLines, (event) => {
      state.updateSettings({ drawLines: event.target.checked });
      chartGrid.applyStyle();
    }),
    field(
      'Reference impedance (Ω)',
      numberInput(state.settings.refImpedance, (event) => {
        state.updateSettings({ refImpedance: Number(event.target.value) || 50 });
      }, { min: 1, step: 'any' }),
    ),
    field(
      'S21 attenuator (dB)',
      numberInput(state.settings.s21Attenuation, (event) => {
        state.updateSettings({ s21Attenuation: Number(event.target.value) || 0 });
      }, { min: 0, step: 'any' }),
    ),
    field(
      'Port 1 offset delay (s)',
      numberInput(state.settings.offsetDelay, (event) => {
        state.updateSettings({ offsetDelay: Number(event.target.value) || 0 });
      }, { step: 'any' }),
    ),
    checkbox('Show return loss as positive', state.settings.returnlossIsPositive, (event) =>
      state.updateSettings({ returnlossIsPositive: event.target.checked })),
    checkbox('Show frequency bands', state.settings.bandsEnabled, (event) => {
      state.updateSettings({ bandsEnabled: event.target.checked });
      chartGrid.applyBands();
    }),
    field(
      'Band plan',
      select(Object.keys(BAND_REGIONS), state.settings.bandRegion, (event) => {
        state.updateSettings({ bandRegion: event.target.value });
        chartGrid.applyBands();
      }),
    ),
  );

  return node;
}

// ----------------------------------------------------------- analysis

export function analysisPanel(state) {
  const chooser = select(
    ANALYSES.map((a) => [a.key, a.name]),
    ANALYSES[0].key,
    () => {
      renderOptions();
      results.replaceChildren();
    },
  );
  const optionsBox = el('div.grid2');
  const results = el('div.analysis-results');
  const options = {};

  function renderOptions() {
    clear(optionsBox);
    const analysis = ANALYSES.find((a) => a.key === chooser.value);
    for (const option of analysis.options) {
      if (options[option.key] === undefined) options[option.key] = option.default;
      if (option.kind === 'choice') {
        optionsBox.append(
          field(
            option.label,
            select(option.choices, options[option.key], (event) => {
              options[option.key] = event.target.value;
            }),
          ),
        );
      } else {
        optionsBox.append(
          field(
            option.label,
            numberInput(options[option.key], (event) => {
              options[option.key] = Number(event.target.value);
            }, { min: option.min, max: option.max, step: option.step }),
          ),
        );
      }
    }
    if (analysis.needsMarker) {
      optionsBox.append(el('p.muted', {}, 'Place marker 1 in the passband first.'));
    }
  }

  const run = () => {
    clear(results);
    const analysis = ANALYSES.find((a) => a.key === chooser.value);
    const ctx = new Context({
      s11: state.data.s11,
      s21: state.data.s21,
      markerLocations: state.markers.map((m) => m.location),
      refImpedance: state.settings.refImpedance,
      sweep: state.sweep,
    });
    let result;
    try {
      result = runAnalysis(analysis.key, ctx, options);
    } catch (error) {
      results.append(
        el('p.warning', {},
           error instanceof AnalysisError ? error.message : `Analysis failed: ${error.message}`),
      );
      state.setAnalysisResult(null);
      return;
    }

    // an analysis may adjust its own options, as the magloop one does
    Object.assign(options, result.options);
    renderOptions();

    results.append(el('h3', {}, result.title));
    if (result.summary) results.append(el('p.muted', {}, result.summary));
    for (const section of result.sections) {
      if (section.title) results.append(el('h4', {}, section.title));
      results.append(
        el('dl.info-list', {},
           ...section.rows.flatMap((row) => [el('dt', {}, row.label), el('dd', {}, row.value)])),
      );
    }
    if (result.markers.length) {
      results.append(
        el('div.row', {}, button('Move markers here', () => {
          result.markers.forEach((freq, i) => {
            if (i < state.markers.length) state.setMarkerFrequency(i, freq);
          });
        })),
      );
    }
    if (result.suggestedSweep) {
      const { start, end } = result.suggestedSweep;
      results.append(
        el('div.row', {}, button(
          `Sweep ${formatFrequencySweep(start)} - ${formatFrequencySweep(end)}`,
          () => state.updateSweep({ start, end }),
        )),
      );
    }
    state.setAnalysisResult(result);
  };

  const node = panel(
    'Analysis',
    field('Analysis', chooser),
    optionsBox,
    el('div.row', {}, button('Run', run, { variant: 'primary' }),
       button('Clear', () => {
         clear(results);
         state.setAnalysisResult(null);
       })),
    results,
  );

  renderOptions();
  return node;
}

// ---------------------------------------------------------------- TDR

export function tdrPanel(state) {
  const result = el('div.info');

  const velocitySelect = select(
    [['custom', 'Custom'], ...CABLE_PARAMETERS.map(([name, value]) => [String(value), name])],
    String(state.settings.tdr.velocityFactor),
    (event) => {
      if (event.target.value === 'custom') return;
      const velocityFactor = Number(event.target.value);
      velocityInput.value = velocityFactor;
      state.updateSettings({ tdr: { ...state.settings.tdr, velocityFactor } });
    },
  );

  const velocityInput = numberInput(state.settings.tdr.velocityFactor, (event) => {
    const velocityFactor = Math.min(1, Math.max(0.01, Number(event.target.value) || 0.66));
    velocitySelect.value = 'custom';
    state.updateSettings({ tdr: { ...state.settings.tdr, velocityFactor } });
  }, { min: 0.01, max: 1, step: 0.01 });

  const node = panel(
    'Time domain',
    field('Cable', velocitySelect),
    field('Velocity factor', velocityInput),
    field(
      'Format',
      select(TDR_FORMATS, state.settings.tdr.format, (event) =>
        state.updateSettings({ tdr: { ...state.settings.tdr, format: event.target.value } })),
    ),
    field(
      'Window',
      select(
        Object.entries(TDR_WINDOWS).map(([key, w]) => [key, w.name]),
        state.settings.tdr.window,
        (event) =>
          state.updateSettings({ tdr: { ...state.settings.tdr, window: event.target.value } }),
      ),
    ),
    result,
  );

  const render = () => {
    clear(result);
    const tdr = state.tdrResult;
    if (!tdr) {
      result.append(el('p.muted', {}, 'Sweep from a low frequency to measure a cable.'));
      return;
    }
    result.append(
      el('dl.info-list', {},
         el('dt', {}, 'Cable length'), el('dd', {}, tdr.cableLengthText)),
    );
  };

  state.on('tdr', render);
  render();
  return node;
}
