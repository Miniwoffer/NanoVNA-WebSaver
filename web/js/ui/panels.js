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

import { menuButton } from './menu.js';
import {
  button,
  checkbox,
  clear,
  downloadText,
  el,
  field,
  numberInput,
  pickFile,
  readFileAsText,
  select,
} from './dom.js';
import { formatFrequencySweep } from '../util/format.js';
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

// -------------------------------------------------------------- files

export function filesMenu(state) {
  const contents = [
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
  ];
  return menuButton({
    label: 'Files',
    title: 'Load and save Touchstone data',
    render: () => contents,
  });
}

function safeName(name) {
  const cleaned = name.replace(/[^\w\-. ]+/g, '').trim();
  return cleaned || 'sweep';
}

// ------------------------------------------------------------ display

export function displayMenu(state, chartGrid) {
  const contents = [
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
  ];

  return menuButton({
    label: 'Display',
    title: 'Theme, columns and trace options',
    render: () => contents,
  });
}

// ----------------------------------------------------------- analysis

export function analysisMenu(state) {
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

  const contents = [
    field('Analysis', chooser),
    optionsBox,
    el('div.row', {}, button('Run', run, { variant: 'primary' }),
       button('Clear', () => {
         clear(results);
         state.setAnalysisResult(null);
       })),
    results,
  ];

  renderOptions();
  return menuButton({
    label: 'Analysis',
    title: 'Run an analysis over the sweep',
    render: () => contents,
  });
}

// ---------------------------------------------------------------- TDR

export function tdrMenu(state) {
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

  const contents = [
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
  ];

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
  return menuButton({
    label: 'Time domain',
    title: 'Time domain reflectometry',
    render: () => contents,
  });
}
