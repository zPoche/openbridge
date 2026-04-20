// openbridge UI — IPC ausschließlich über window.bridge

const TARGET_FIELDS = [
  { id: 'title', label: 'Thema (title)' },
  { id: 'start_date', label: 'Startdatum (start_date)' },
  { id: 'end_date', label: 'Enddatum (end_date)' },
  { id: 'parent_local_id', label: 'Eltern-ID lokal (parent_local_id)' },
  { id: 'local_id', label: 'Lokale ID (local_id)' },
  { id: 'openproject_id', label: 'OpenProject-ID (openproject_id)' },
  { id: 'type', label: 'Typ (type)' },
  { id: 'description', label: 'Beschreibung (description)' },
];

const UNASSIGNED_VALUE = '';
const LABEL_LOAD_PROJECTS = 'Projekte abrufen';

let currentFilePath = null;
let currentColumns = [];
let currentMapping = {};
let currentRowCount = 0;
/** @type {null | { success: boolean, log: any[], errors: any[], warnings: any[] }} */
let lastDryRunResult = null;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attrEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function getEl(id) {
  return document.getElementById(id);
}

function clearSettingsError() {
  const el = getEl('settings-error');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

function showSettingsError(message) {
  const el = getEl('settings-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function isSettingsModalOpen() {
  const root = getEl('modal-settings');
  return !!(root && !root.classList.contains('hidden'));
}

function clearProjectsStatusVisual() {
  const st = getEl('projects-status');
  if (!st) return;
  st.textContent = '';
  st.classList.remove('error', 'success', 'neutral');
}

function setSectionHidden(id, hidden) {
  const el = getEl(id);
  if (!el) return;
  if (hidden) el.classList.add('hidden');
  else el.classList.remove('hidden');
}

function showValidationMessage(message, isError) {
  const el = getEl('validation-errors');
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.classList.add('hidden');
    el.classList.remove('error');
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
  if (isError) el.classList.add('error');
  else el.classList.remove('error');
}

function collectMappingFromDom() {
  const mapping = {};
  for (const { id } of TARGET_FIELDS) {
    const sel = document.querySelector(`select.mapping-select[data-field="${id}"]`);
    const val = sel && sel.value ? sel.value : '';
    mapping[id] = val;
  }
  currentMapping = mapping;
  return mapping;
}

function renderMappingTable() {
  const wrap = getEl('mapping-table');
  if (!wrap) return;

  const rows = TARGET_FIELDS.map(({ id, label }) => {
    const previous = currentMapping[id] || '';
    const options = [
      `<option value="${UNASSIGNED_VALUE}"${previous === '' ? ' selected' : ''}>— nicht zuordnen —</option>`,
    ];
    for (const col of currentColumns) {
      const selected = col === previous ? ' selected' : '';
      options.push(
        `<option value="${attrEscape(col)}"${selected}>${escapeHtml(col)}</option>`,
      );
    }
    return `<tr><th><label for="map-${id}">${escapeHtml(label)}</label></th><td><select id="map-${id}" class="mapping-select" data-field="${id}">${options.join('')}</select></td></tr>`;
  }).join('');

  wrap.innerHTML = `<table class="mapping-grid"><tbody>${rows}</tbody></table>`;
}

function parseSkippedFromWarnings(warnings) {
  for (const w of warnings || []) {
    const m = String(w.message || '').match(/(\d+)\s+Zeile\(n\) ohne Titel/);
    if (m) return Number.parseInt(m[1], 10) || 0;
  }
  return 0;
}

function summarizeDryRunLog(log) {
  let creates = 0;
  let updates = 0;
  let faults = 0;
  for (const e of log || []) {
    if (e.action === 'CREATE (dry-run)') creates += 1;
    else if (e.action === 'UPDATE (dry-run)') updates += 1;
    else if (e.action === 'ERROR') faults += 1;
  }
  return { creates, updates, faults };
}

function parentFromPayload(payload) {
  const href = payload && payload._links && payload._links.parent && payload._links.parent.href;
  if (!href) return '—';
  const m = String(href).match(/work_packages\/(\d+)/);
  return m ? m[1] : String(href);
}

function rowWarnings(warnings, sourceRow, title) {
  return (warnings || []).filter((w) => {
    if (w.rowIndex != null && sourceRow != null && Number(w.rowIndex) === Number(sourceRow)) return true;
    if (title && w.ref && String(w.ref) === String(title)) return true;
    return false;
  });
}

function actionLabelDryRun(action) {
  if (action === 'CREATE (dry-run)') return 'Erstellen';
  if (action === 'UPDATE (dry-run)') return 'Aktualisieren';
  if (action === 'ERROR') return 'Fehler';
  if (action === 'WARN') return 'Hinweis';
  return action || '—';
}

function renderPreview(result) {
  const summaryEl = getEl('preview-summary');
  const tableWrap = getEl('preview-table');
  const btnImport = getEl('btn-import');
  if (!summaryEl || !tableWrap || !btnImport) return;

  const z = parseSkippedFromWarnings(result.warnings);
  let x = 0;
  let y = 0;
  let f = 0;

  if (!result.success) {
    f = (result.errors || []).length;
    summaryEl.textContent = `${x} Erstellen, ${y} Aktualisieren, ${z} Übersprungen, ${f} Fehler`;

    const errRows = (result.errors || []).map((err, idx) => {
      const msg = escapeHtml(err.message || '');
      const ref = escapeHtml(err.ref || '');
      const rowIdx = err.rowIndex != null ? escapeHtml(String(err.rowIndex)) : String(idx + 1);
      return `<tr class="row-error"><td>${rowIdx}</td><td>${ref}</td><td>Fehler</td><td>—</td><td>—</td><td>—</td><td>${msg}</td></tr>`;
    });

    tableWrap.innerHTML = `<table class="data-table"><thead><tr><th>#</th><th>Titel</th><th>Aktion</th><th>Start</th><th>Ende</th><th>Parent</th><th>Fehler/Warnung</th></tr></thead><tbody>${errRows.join('') || '<tr><td colspan="7">Keine Details.</td></tr>'}</tbody></table>`;
    btnImport.disabled = true;
    return;
  }

  const counts = summarizeDryRunLog(result.log);
  x = counts.creates;
  y = counts.updates;
  f = counts.faults + (result.errors || []).length;
  summaryEl.textContent = `${x} Erstellen, ${y} Aktualisieren, ${z} Übersprungen, ${f} Fehler`;

  const body = (result.log || []).map((entry) => {
    const payload = entry.payload || {};
    const start = escapeHtml(payload.startDate || '—');
    const end = escapeHtml(payload.dueDate || '—');
    const parent = escapeHtml(parentFromPayload(payload));
    const title = escapeHtml(entry.title || '—');
    const idx = entry.sourceRow != null ? escapeHtml(String(entry.sourceRow)) : '—';
    const act = escapeHtml(actionLabelDryRun(entry.action));
    const warns = rowWarnings(result.warnings, entry.sourceRow, entry.title);
    const warnText = warns.map((w) => w.message).join(' / ');
    const extraMsg = entry.error || entry.message || '';
    const cellMsg = escapeHtml([warnText, extraMsg].filter(Boolean).join(' ') || '—');

    let cls = '';
    if (entry.action === 'ERROR' || entry.error) cls = 'row-error';
    else if (entry.action === 'WARN') cls = 'row-warn';
    else if (warns.length) cls = 'row-warn';

    return `<tr class="${cls}"><td>${idx}</td><td>${title}</td><td>${act}</td><td>${start}</td><td>${end}</td><td>${parent}</td><td>${cellMsg}</td></tr>`;
  }).join('');

  tableWrap.innerHTML = `<table class="data-table"><thead><tr><th>#</th><th>Titel</th><th>Aktion</th><th>Start</th><th>Ende</th><th>Parent</th><th>Fehler/Warnung</th></tr></thead><tbody>${body || '<tr><td colspan="7">Keine Vorschau-Einträge.</td></tr>'}</tbody></table>`;

  btnImport.disabled = (result.errors && result.errors.length > 0) || f > 0;
}

function renderImportLog(result) {
  const wrap = getEl('import-log');
  if (!wrap) return;

  if (!result.success && (!result.log || !result.log.length)) {
    const errs = (result.errors || []).map((e) => `<div class="log-entry bad">${escapeHtml(e.ref || '')}: ${escapeHtml(e.message || '')}</div>`).join('');
    wrap.innerHTML = errs || '<div class="log-entry bad">Import fehlgeschlagen.</div>';
    return;
  }

  const lines = (result.log || []).map((entry) => {
    const parts = [`<strong>${escapeHtml(entry.action || '')}</strong>`];
    if (entry.title) parts.push(`— ${escapeHtml(entry.title)}`);
    if (entry.id != null) parts.push(`(ID ${escapeHtml(String(entry.id))})`);
    if (entry.error) parts.push(`: ${escapeHtml(entry.error)}`);
    if (entry.debug) {
      parts.push(` — ${escapeHtml(JSON.stringify(entry.debug))}`);
    }
    const isErr = entry.action === 'ERROR' || !!entry.error;
    const cls = isErr ? 'log-entry bad' : 'log-entry ok';
    return `<div class="${cls}">${parts.join(' ')}</div>`;
  });

  const errBanner = !result.success && (result.errors || []).length
    ? (result.errors || []).map((e) => `<div class="log-entry bad">${escapeHtml(e.message || '')}</div>`).join('')
    : '';

  wrap.innerHTML = errBanner + lines.join('');
}

async function withBusy(button, busyText, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function getProjectId() {
  const sel = getEl('project-id');
  return sel && sel.value ? String(sel.value).trim() : '';
}

function resetProjectSelect() {
  const sel = getEl('project-id');
  if (sel) {
    sel.innerHTML = '<option value="">— Projekt wählen —</option>';
    sel.value = '';
  }
  clearProjectsStatusVisual();
}

function openSettingsModal() {
  clearSettingsError();
  const root = getEl('modal-settings');
  if (!root) return;
  root.classList.remove('hidden');
  root.setAttribute('aria-hidden', 'false');
  const urlInput = getEl('settings-url');
  if (urlInput && typeof urlInput.focus === 'function') {
    urlInput.focus();
  }
}

function closeSettingsModal() {
  clearSettingsError();
  const root = getEl('modal-settings');
  if (!root) return;
  root.classList.add('hidden');
  root.setAttribute('aria-hidden', 'true');
  const gear = getEl('btn-settings');
  if (gear && typeof gear.focus === 'function') {
    gear.focus();
  }
}

async function initSettingsFields() {
  const urlEl = getEl('settings-url');
  const keyEl = getEl('settings-apikey');
  try {
    const data = await window.bridge.loadSettings();
    if (data && data.error) {
      if (typeof console !== 'undefined' && console.error) {
        console.error(data.error);
      }
      if (urlEl) urlEl.value = '';
      if (keyEl) keyEl.value = '';
      return;
    }
    if (urlEl) urlEl.value = data.url || '';
    if (keyEl) keyEl.value = data.apiKey || '';
  } catch (err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error(err);
    }
    if (urlEl) urlEl.value = '';
    if (keyEl) keyEl.value = '';
  }
}

async function onSaveSettings() {
  const urlEl = getEl('settings-url');
  const keyEl = getEl('settings-apikey');
  const url = urlEl && urlEl.value ? String(urlEl.value).trim() : '';
  const apiKey = keyEl && keyEl.value ? String(keyEl.value) : '';
  clearSettingsError();
  try {
    const result = await window.bridge.saveSettings({ url, apiKey });
    if (result && result.error) {
      showSettingsError(`Speichern fehlgeschlagen: ${result.error}`);
      return;
    }
    closeSettingsModal();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    showSettingsError(`Speichern fehlgeschlagen: ${msg}`);
  }
}

async function onLoadProjects() {
  const btn = getEl('btn-load-projects');
  const status = getEl('projects-status');
  const sel = getEl('project-id');
  if (!btn || !sel) return;

  clearProjectsStatusVisual();
  btn.disabled = true;
  btn.textContent = 'Lädt…';

  try {
    const result = await window.bridge.getProjects();
    if (result && result.error) {
      if (status) {
        status.textContent = `Fehler beim Laden der Projekte: ${result.error}`;
        status.classList.remove('success', 'neutral');
        status.classList.add('error');
      }
      return;
    }

    if (!Array.isArray(result)) {
      if (status) {
        status.textContent = 'Fehler beim Laden der Projekte: Unerwartete Antwort vom Server.';
        status.classList.remove('success', 'neutral');
        status.classList.add('error');
      }
      return;
    }

    const current = sel.value;
    const opts = ['<option value="">— Projekt wählen —</option>'];
    for (const p of result) {
      const id = p.id != null ? String(p.id) : '';
      const name = p.name != null ? String(p.name) : '';
      const selected = id === current ? ' selected' : '';
      opts.push(`<option value="${attrEscape(id)}"${selected}>${escapeHtml(name || id)}</option>`);
    }
    sel.innerHTML = opts.join('');
    if (current && [...sel.options].some((o) => o.value === current)) {
      sel.value = current;
    }

    if (status) {
      status.classList.remove('error', 'success', 'neutral');
      if (result.length === 0) {
        status.textContent = 'Keine Projekte gefunden';
        status.classList.add('neutral');
      } else if (result.length === 500) {
        status.textContent = 'Projekte geladen (max. 500 angezeigt – ggf. Pagination nötig)';
        status.classList.add('neutral');
      } else {
        status.textContent = 'Projekte geladen';
        status.classList.add('success');
      }
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (status) {
      status.textContent = `Fehler beim Laden der Projekte: ${msg}`;
      status.classList.remove('success', 'neutral');
      status.classList.add('error');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = LABEL_LOAD_PROJECTS;
  }
}

function resetWizard() {
  currentFilePath = null;
  currentColumns = [];
  currentMapping = {};
  currentRowCount = 0;
  lastDryRunResult = null;

  const sel = getEl('selected-file');
  if (sel) sel.textContent = '';
  resetProjectSelect();
  const map = getEl('mapping-table');
  if (map) map.innerHTML = '';
  const prevSum = getEl('preview-summary');
  if (prevSum) prevSum.textContent = '';
  const prevTbl = getEl('preview-table');
  if (prevTbl) prevTbl.innerHTML = '';
  const log = getEl('import-log');
  if (log) log.innerHTML = '';

  showValidationMessage('', false);

  setSectionHidden('step-mapping', true);
  setSectionHidden('step-preview', true);
  setSectionHidden('step-log', true);

  const btnImport = getEl('btn-import');
  if (btnImport) btnImport.disabled = true;

  const loadBtn = getEl('btn-load-projects');
  if (loadBtn) {
    loadBtn.disabled = false;
    loadBtn.textContent = LABEL_LOAD_PROJECTS;
  }
}

async function onSelectFile() {
  const btn = getEl('btn-select-file');
  if (!btn) return;

  await withBusy(btn, 'Lädt…', async () => {
    showValidationMessage('', false);
    try {
      const filePath = await window.bridge.openFile();
      if (!filePath) return;

      const colResult = await window.bridge.getColumns({ filePath });
      if (colResult.error) {
        const sf = getEl('selected-file');
        if (sf) sf.textContent = '';
        showValidationMessage(`Spalten konnten nicht gelesen werden: ${colResult.error}`, true);
        setSectionHidden('step-mapping', true);
        return;
      }

      currentFilePath = filePath;
      currentColumns = colResult.columns || [];
      currentRowCount = colResult.rowCount || 0;
      currentMapping = {};
      lastDryRunResult = null;

      const selected = getEl('selected-file');
      if (selected) {
        selected.textContent = `Ausgewählt: ${filePath} (${currentRowCount} Zeilen)`;
      }
      renderMappingTable();
      setSectionHidden('step-mapping', false);
      setSectionHidden('step-preview', true);
      setSectionHidden('step-log', true);
      const btnImport = getEl('btn-import');
      if (btnImport) btnImport.disabled = true;
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      showValidationMessage(`Datei konnte nicht gelesen werden: ${msg}`, true);
      const sf = getEl('selected-file');
      if (sf) sf.textContent = '';
      setSectionHidden('step-mapping', true);
    }
  });
}

async function onValidate() {
  const btn = getEl('btn-validate');
  if (!btn || !currentFilePath) return;

  await withBusy(btn, 'Lädt…', async () => {
    showValidationMessage('', false);
    collectMappingFromDom();

    const projectId = getProjectId();
    let result;
    try {
      result = await window.bridge.dryRun({
        filePath: currentFilePath,
        mapping: currentMapping,
        projectId,
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      showValidationMessage(`Validierung fehlgeschlagen: ${msg}`, true);
      lastDryRunResult = null;
      return;
    }

    lastDryRunResult = result;
    setSectionHidden('step-preview', false);
    setSectionHidden('step-log', true);
    renderPreview(result);

    if (!result.success) {
      showValidationMessage('Validierung fehlgeschlagen. Details siehe Tabelle.', true);
    } else if ((result.warnings || []).length > 0) {
      showValidationMessage('Hinweise vorhanden (siehe Spalte „Fehler/Warnung“ bzw. farbige Zeilen).', false);
    }
  });
}

async function onImport() {
  const btn = getEl('btn-import');
  if (!btn || !currentFilePath) return;

  if (!lastDryRunResult || lastDryRunResult.success !== true) {
    showValidationMessage('Bitte zuerst Validierung erfolgreich durchführen.', true);
    return;
  }

  await withBusy(btn, 'Lädt…', async () => {
    showValidationMessage('', false);
    collectMappingFromDom();
    const projectId = getProjectId();

    try {
      const result = await window.bridge.importFile({
        filePath: currentFilePath,
        mapping: currentMapping,
        projectId,
      });

      setSectionHidden('step-log', false);
      renderImportLog(result);

      if (!result.success) {
        showValidationMessage('Import mit Fehlern beendet. Siehe Log.', true);
      } else {
        lastDryRunResult = null;
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      showValidationMessage(`Import fehlgeschlagen: ${msg}`, true);
    }
  });
}

function onNewImport() {
  resetWizard();
}

const btnSelect = getEl('btn-select-file');
const btnValidate = getEl('btn-validate');
const btnImport = getEl('btn-import');
const btnNew = getEl('btn-new-import');
if (btnSelect) btnSelect.addEventListener('click', onSelectFile);
if (btnValidate) btnValidate.addEventListener('click', onValidate);
if (btnImport) btnImport.addEventListener('click', onImport);
if (btnNew) btnNew.addEventListener('click', onNewImport);

const btnSettings = getEl('btn-settings');
const btnSettingsClose = getEl('btn-settings-close');
const btnSettingsSave = getEl('btn-settings-save');
const modalBackdrop = getEl('modal-settings-backdrop');
const btnLoadProjects = getEl('btn-load-projects');

if (btnSettings) btnSettings.addEventListener('click', openSettingsModal);
if (btnSettingsClose) btnSettingsClose.addEventListener('click', closeSettingsModal);
if (modalBackdrop) modalBackdrop.addEventListener('click', closeSettingsModal);
if (btnSettingsSave) {
  btnSettingsSave.addEventListener('click', async () => {
    await onSaveSettings();
  });
}
if (btnLoadProjects) btnLoadProjects.addEventListener('click', onLoadProjects);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isSettingsModalOpen()) {
    e.preventDefault();
    closeSettingsModal();
  }
});

initSettingsFields();
