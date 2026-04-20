const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const MAIN_LOG = path.join(os.tmpdir(), 'openbridge-electron-main.log');

function mainLog(...args) {
  const body = args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  const line = `[openbridge] ${body}`;
  const stamp = `${new Date().toISOString()} ${line}\n`;
  try {
    process.stderr.write(`${line}\n`);
  } catch (_) {
    /* ignore */
  }
  try {
    fsSync.appendFileSync(MAIN_LOG, stamp);
  } catch (_) {
    /* ignore */
  }
}

process.on('uncaughtException', (err) => {
  mainLog('uncaughtException', err && err.stack ? err.stack : String(err));
});
process.on('unhandledRejection', (reason) => {
  let text;
  if (reason instanceof Error) text = reason.stack || reason.message;
  else {
    try {
      text = JSON.stringify(reason);
    } catch {
      text = String(reason);
    }
  }
  mainLog('unhandledRejection', text);
});

mainLog('main module: registering handlers, then loading dotenv/electron');
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog } = require('electron');

if (process.env.ELECTRON_RUN_AS_NODE) {
  mainLog('WARNING: ELECTRON_RUN_AS_NODE is set; GUI may not start as expected.');
}
if (process.env.OPENBRIDGE_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  mainLog('disableHardwareAcceleration (OPENBRIDGE_DISABLE_GPU=1)');
}

const fs = require('fs').promises;

const XLSX = require('xlsx');

const ExcelAdapter = require('./adapters/ExcelAdapter');
const CsvAdapter = require('./adapters/CsvAdapter');
const BaseAdapter = require('./adapters/BaseAdapter');
const Importer = require('./core/Importer');
const OpenProjectClient = require('./api/OpenProjectClient');

const baseAdapter = new BaseAdapter();

const pkgJson = require(path.join(__dirname, '..', 'package.json'));
const appVersion = typeof pkgJson.version === 'string' ? pkgJson.version : '1.0.0';

/** Letzter erfolgreicher echter Import: finale AP-Zeilen nur mit OpenProject-IDs (für CSV-Export). */
let lastImportPackages = [];

/** Hauptfenster (Taskleisten-Fortschritt, sauber zurücksetzen). */
let mainWindow = null;

function ipcPlainObject(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

function updateTaskbarProgress(data) {
  const w = mainWindow;
  if (!w || w.isDestroyed()) return;
  try {
    const ph = data && data.phase;
    if (ph === 'finished' || ph === 'error') {
      w.setProgressBar(-1);
      return;
    }
    const cur = data && data.current;
    const tot = data && data.total;
    if (tot != null && Number(tot) > 0 && cur != null && Number.isFinite(Number(cur))) {
      const v = Math.min(1, Math.max(0, Number(cur) / Number(tot)));
      w.setProgressBar(v);
    }
  } catch (e) {
    mainLog('setProgressBar failed', e && e.message ? e.message : String(e));
  }
}

function createAdapterForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') return new CsvAdapter();
  if (ext === '.xlsx' || ext === '.xls') return new ExcelAdapter();
  throw new Error(`Nicht unterstützter Dateityp: ${ext || '(unbekannt)'}`);
}

function formatExcelSerialWithXlsx(value) {
  try {
    const date = XLSX.SSF.parse_date_code(value);
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

/**
 * Excel-Serienzahl (Tage seit 1899-12-30) → YYYY-MM-DD (UTC-Mitternachtsapproximation).
 */
function excelSerialToYmd(serial) {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial);
  const excelEpochUtc = Date.UTC(1899, 11, 30);
  const ms = excelEpochUtc + whole * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeNumberToDate(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const fromXlsx = formatExcelSerialWithXlsx(raw);
  if (fromXlsx) return fromXlsx;

  if (Number.isInteger(raw) && raw >= 1500 && raw <= 2200) {
    return null;
  }

  const whole = Math.floor(raw);
  if (whole >= 1 && whole < 10000000) {
    return excelSerialToYmd(raw);
  }

  return null;
}

/**
 * Trimmt und erkennt YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY → YYYY-MM-DD.
 */
function parseDateStringToYmd(str) {
  const t = String(str).trim();
  if (!t) return null;

  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const ymd = `${m[1]}-${m[2]}-${m[3]}`;
    const check = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z`).getTime();
    return Number.isNaN(check) ? null : ymd;
  }

  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    const yyyy = m[3];
    const check = new Date(`${yyyy}-${mm}-${dd}T12:00:00.000Z`).getTime();
    return Number.isNaN(check) ? null : `${yyyy}-${mm}-${dd}`;
  }

  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    const yyyy = m[3];
    const check = new Date(`${yyyy}-${mm}-${dd}T12:00:00.000Z`).getTime();
    return Number.isNaN(check) ? null : `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function normalizeDateField(raw) {
  if (raw === undefined || raw === null || raw === '') return null;

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return raw.toISOString().slice(0, 10);
  }

  if (typeof raw === 'number') {
    return normalizeNumberToDate(raw);
  }

  return parseDateStringToYmd(raw);
}

function rawCellValue(row, mapping, field) {
  const col = mapping[field];
  if (col === undefined || col === null) return null;
  if (typeof col !== 'string' || col.trim() === '') return null;
  const key = col.trim();
  if (!Object.prototype.hasOwnProperty.call(row, key)) return null;
  const v = row[key];
  if (v === undefined || v === null || v === '') return null;
  return v;
}

function cellValue(row, mapping, field) {
  const v = rawCellValue(row, mapping, field);
  if (v === null || v === undefined) return null;

  if (field === 'start_date' || field === 'end_date') return normalizeDateField(v);

  if (field === 'openproject_id' || field === 'parent_openproject_id') {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const cleaned = String(v).replace(/^#/, '').trim();
    const n = Number.parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : null;
  }

  if (field === 'duration') {
    const n = Number(String(v).replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
  }

  if (field === 'title' || field === 'description' || field === 'type' || field === 'local_id' || field === 'parent_local_id') {
    return String(v).trim();
  }

  return v;
}

function attachDateDebug(wp, row, mapping) {
  const rawStart = rawCellValue(row, mapping, 'start_date');
  const rawEnd = rawCellValue(row, mapping, 'end_date');
  wp._debugDate = {
    rawStart: rawStart === undefined ? null : rawStart,
    rawEnd: rawEnd === undefined ? null : rawEnd,
    normStart: wp.start_date,
    normEnd: wp.end_date,
  };
}

function mapRowsToWorkPackages(rows, mapping) {
  let skippedRows = 0;
  const workPackages = [];
  let sourceIndex = 0;

  for (const row of rows) {
    sourceIndex += 1;
    const titleVal = cellValue(row, mapping, 'title');
    if (!titleVal) {
      skippedRows += 1;
      continue;
    }

    const typeVal = cellValue(row, mapping, 'type');

    const wp = baseAdapter.buildWorkPackage({
      title: titleVal,
      start_date: cellValue(row, mapping, 'start_date'),
      end_date: cellValue(row, mapping, 'end_date'),
      duration: cellValue(row, mapping, 'duration'),
      parent_local_id: cellValue(row, mapping, 'parent_local_id'),
      parent_openproject_id: cellValue(row, mapping, 'parent_openproject_id'),
      local_id: cellValue(row, mapping, 'local_id'),
      openproject_id: cellValue(row, mapping, 'openproject_id'),
      type: typeVal,
      description: cellValue(row, mapping, 'description') || '',
    });
    wp._sourceRow = sourceIndex;
    attachDateDebug(wp, row, mapping);
    workPackages.push(wp);
  }

  return { workPackages, skippedRows };
}

async function yieldEventLoop() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function runPipeline(payloadIn = {}, { dryRun, client, onProgress }) {
  const notify = (p) => {
    if (typeof onProgress === 'function') {
      try {
        onProgress(p);
      } catch (_) {
        /* ignore */
      }
    }
  };

  const filePath = payloadIn.filePath;
  const mappingRaw = payloadIn.mapping;
  const projectId = payloadIn.projectId;

  if (!filePath || typeof filePath !== 'string' || !String(filePath).trim()) {
    notify({ phase: 'error', current: 0, total: 0, message: 'Kein Dateipfad.' });
    return {
      success: false,
      log: [],
      errors: [{ ref: 'Datei', message: 'Kein Dateipfad.' }],
      warnings: [],
    };
  }
  const ext = path.extname(String(filePath).trim()).toLowerCase();
  if (ext !== '.csv' && ext !== '.xlsx' && ext !== '.xls') {
    notify({ phase: 'error', current: 0, total: 0, message: 'Dateityp wird nicht unterstützt.' });
    return {
      success: false,
      log: [],
      errors: [
        {
          ref: 'Datei',
          message: `Dateityp wird nicht unterstützt (${ext || 'unbekannt'}). Erlaubt: .csv, .xlsx, .xls`,
        },
      ],
      warnings: [],
    };
  }

  const mapping =
    mappingRaw && typeof mappingRaw === 'object' && !Array.isArray(mappingRaw) ? mappingRaw : {};

  try {
    notify({ phase: 'reading-file', current: 0, total: null });
    const adapter = createAdapterForPath(filePath);
    const rows = await adapter.parse(filePath);
    notify({ phase: 'reading-file', current: rows.length, total: rows.length });
    await yieldEventLoop();

    const { workPackages, skippedRows } = mapRowsToWorkPackages(rows, mapping);
    await yieldEventLoop();

    if (workPackages.length === 0) {
      const warnings = [];
      if (skippedRows > 0) {
        warnings.push({
          ref: 'Datei',
          rowIndex: null,
          message: `${skippedRows} Zeile(n) ohne Titel wurden beim Einlesen übersprungen.`,
        });
      }
      notify({
        phase: 'error',
        current: 0,
        total: 0,
        message:
          'Keine importierbaren Zeilen. Bitte die Spalte „Thema (title)“ zuordnen oder prüfen, ob die Datei gültige Daten enthält.',
      });
      if (!dryRun) lastImportPackages = [];
      return {
        success: false,
        log: [],
        errors: [
          {
            ref: 'Mapping',
            message:
              'Keine importierbaren Zeilen. Bitte die Spalte „Thema (title)“ zuordnen oder prüfen, ob die Datei gültige Daten enthält.',
          },
        ],
        warnings,
      };
    }

    const importer = new Importer(client, { dryRun, onProgress: notify });
    const result = await importer.run(workPackages, projectId);

    const validationOnlyFailure =
      !result.success &&
      (!result.log || result.log.length === 0) &&
      result.errors &&
      result.errors.length > 0;
    if (!validationOnlyFailure) {
      const finishedMsg = dryRun
        ? (result.success ? 'Dry-Run abgeschlossen' : 'Dry-Run beendet (mit Fehlern)')
        : result.success
          ? 'Import abgeschlossen'
          : 'Import beendet (mit Fehlern)';
      notify({ phase: 'finished', current: 1, total: 1, message: finishedMsg });
    }

    const extraWarnings = [];
    if (skippedRows > 0) {
      extraWarnings.push({
        ref: 'Datei',
        rowIndex: null,
        message: `${skippedRows} Zeile(n) ohne Titel wurden beim Einlesen übersprungen.`,
      });
    }

    if (!dryRun) {
      if (result.success && Array.isArray(result.finalPackages)) {
        lastImportPackages = result.finalPackages;
      } else {
        lastImportPackages = [];
      }
    }

    return {
      success: result.success,
      log: result.log,
      errors: result.errors,
      warnings: [...(result.warnings || []), ...extraWarnings],
      finalPackages: dryRun ? undefined : result.finalPackages,
    };
  } catch (err) {
    notify({ phase: 'error', current: 0, total: 0, message: err.message || String(err) });
    if (!dryRun) lastImportPackages = [];
    return {
      success: false,
      log: [],
      errors: [{ ref: 'Datei', message: err.message || String(err) }],
      warnings: [],
    };
  }
}

/** CSV-Feld escaping; Trennzeichen im Export der Arbeitspakete ist Semikolon (;). */
function escapeCsvFieldSemi(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function workPackagesToCsvSemicolon(packages) {
  const sep = ';';
  const cols = [
    'openproject_id',
    'parent_openproject_id',
    'predecessor_openproject_ids',
    'title',
    'type',
    'status',
    'start_date',
    'end_date',
    'duration',
    'description',
    'assignee',
  ];
  const header = cols.join(sep);
  const lines = [header];
  for (const p of packages) {
    const pred = (p.predecessor_openproject_ids || []).join('|');
    const row = [
      p.openproject_id,
      p.parent_openproject_id == null ? '' : String(p.parent_openproject_id),
      pred,
      p.title,
      p.type,
      p.status,
      p.start_date,
      p.end_date,
      p.duration,
      p.description,
      p.assignee,
    ].map((c) => escapeCsvFieldSemi(c));
    lines.push(row.join(sep));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

function escapeCsvField(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function resultToCsvRows(result) {
  const rows = [];
  for (const e of result.log || []) {
    rows.push({
      action: e.action || '',
      title: e.title || '',
      id: e.id != null ? String(e.id) : '',
      source_row: e.sourceRow != null ? String(e.sourceRow) : '',
      parent_local_id: e.parent_local_id != null ? String(e.parent_local_id) : '',
      start_date: '',
      end_date: '',
      error: e.error || '',
      message: e.message || '',
    });
  }
  for (const err of result.errors || []) {
    rows.push({
      action: 'CONFIG_ERROR',
      title: err.ref || '',
      id: '',
      source_row: err.rowIndex != null ? String(err.rowIndex) : '',
      parent_local_id: '',
      start_date: '',
      end_date: '',
      error: err.message || '',
      message: '',
    });
  }
  return rows;
}

function buildCsvFromRows(flatRows) {
  if (!flatRows.length) {
    return '\uFEFFaction,title,id,source_row,parent_local_id,start_date,end_date,error,message\n';
  }
  const keys = Object.keys(flatRows[0]);
  const header = keys.join(',');
  const lines = flatRows.map((r) => keys.map((k) => escapeCsvField(r[k])).join(','));
  return `\uFEFF${header}\n${lines.join('\n')}\n`;
}

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function loadSettingsData() {
  try {
    const raw = await fs.readFile(settingsFilePath(), 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return { error: `Lesen der Einstellungen fehlgeschlagen: Ungültiges JSON (${e.message})` };
    }
    return {
      url: typeof data.url === 'string' ? data.url : '',
      apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { url: '', apiKey: '' };
    }
    return { error: `Lesen der Einstellungen fehlgeschlagen: ${err.message}` };
  }
}

async function saveSettingsToDisk(settings) {
  const dir = app.getPath('userData');
  await fs.mkdir(dir, { recursive: true });
  const payload = {
    url: settings && typeof settings.url === 'string' ? settings.url : '',
    apiKey: settings && typeof settings.apiKey === 'string' ? settings.apiKey : '',
  };
  await fs.writeFile(settingsFilePath(), JSON.stringify(payload, null, 2), 'utf8');
}

function loadRendererHtml(win, htmlFilePath) {
  if (htmlFilePath.includes('#')) {
    const href = pathToFileURL(htmlFilePath).href;
    mainLog('loadURL (path contains #):', href);
    return win.loadURL(href);
  }
  mainLog('loadFile (local HTML, no # in path):', htmlFilePath);
  return win.loadFile(htmlFilePath);
}

function createWindow() {
  mainLog('createWindow start');
  const preloadPath = path.join(__dirname, 'ui', 'preload.js');
  let htmlPath = path.join(__dirname, 'ui', 'index.html');
  if (process.env.OPENBRIDGE_MINIMAL_UI === '1') {
    htmlPath = path.join(__dirname, 'ui', 'minimal.html');
    mainLog('OPENBRIDGE_MINIMAL_UI=1 →', htmlPath);
  }
  mainLog('preload path:', preloadPath, 'exists:', fsSync.existsSync(preloadPath));
  mainLog('html path:', htmlPath, 'exists:', fsSync.existsSync(htmlPath));
  mainLog('diag log file:', MAIN_LOG);

  let win;
  try {
    win = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
      titleBarStyle: 'default',
      title: 'openbridge',
    });
  } catch (err) {
    mainLog('new BrowserWindow threw:', err && err.stack ? err.stack : String(err));
    throw err;
  }

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    mainLog('did-fail-load', { errorCode, errorDescription, validatedURL });
  });
  win.webContents.on('did-finish-load', () => {
    mainLog('did-finish-load', win.webContents.getURL());
    if (process.env.OPENBRIDGE_DEVTOOLS === '1') {
      mainLog('OPENBRIDGE_DEVTOOLS=1 → openDevTools');
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    mainLog('render-process-gone', details);
  });
  win.webContents.on('unresponsive', () => {
    mainLog('webContents unresponsive');
  });
  if (process.env.OPENBRIDGE_LOG_RENDERER_CONSOLE === '1') {
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      mainLog('renderer-console', { level, message, line, sourceId });
    });
  }
  win.webContents.on('child-process-gone', (_event, details) => {
    mainLog('child-process-gone', details);
  });
  win.once('ready-to-show', () => {
    mainLog('ready-to-show');
  });
  mainWindow = win;
  win.on('closed', () => {
    mainLog('window closed');
    try {
      win.setProgressBar(-1);
    } catch (_) {
      /* Fenster kann hier schon teilweise abgebaut sein */
    }
    if (mainWindow === win) mainWindow = null;
  });

  loadRendererHtml(win, htmlPath).catch((err) => {
    mainLog('loadRendererHtml rejected:', err && err.stack ? err.stack : String(err));
  });
}

app
  .whenReady()
  .then(() => {
    mainLog('app ready');
    mainLog('versions:', { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node });
    mainLog('userData:', app.getPath('userData'));
    mainLog('hint: if startup is flaky, try a fresh userData folder once (rename old openbridge data under userData).');
    createWindow();
  })
  .catch((err) => {
    mainLog('startup failed:', err && err.stack ? err.stack : String(err));
  });

app.on('before-quit', () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
  } catch (_) {
    /* ignore */
  }
  mainLog('before-quit');
});
app.on('will-quit', () => {
  mainLog('will-quit');
});

app.on('window-all-closed', () => {
  mainLog('window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});

// IPC: open file dialog
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Tabellen', extensions: ['xlsx', 'xls', 'csv'] }],
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) return null;
  return result.filePaths[0] || null;
});

ipcMain.handle('get-columns', async (_event, payload) => {
  const { filePath } = ipcPlainObject(payload);
  if (!filePath || typeof filePath !== 'string' || !String(filePath).trim()) {
    return { columns: [], rowCount: 0, error: 'Kein Dateipfad übergeben.' };
  }
  try {
    const adapter = createAdapterForPath(filePath);
    const rows = await adapter.parse(filePath);
    const rowCount = rows.length;
    if (!rowCount) {
      return { columns: [], rowCount: 0, error: null };
    }
    const columns = Object.keys(rows[0]);
    return { columns, rowCount, error: null };
  } catch (err) {
    return { columns: [], rowCount: 0, error: err.message || String(err) };
  }
});

ipcMain.handle('load-settings', async () => {
  const data = await loadSettingsData();
  if (data.error) return { error: data.error };
  return { url: data.url, apiKey: data.apiKey };
});

ipcMain.handle('save-settings', async (_event, settings) => {
  try {
    await saveSettingsToDisk(ipcPlainObject(settings));
    return { success: true };
  } catch (err) {
    return { error: `Speichern der Einstellungen fehlgeschlagen: ${err.message}` };
  }
});

ipcMain.handle('get-projects', async () => {
  try {
    const data = await loadSettingsData();
    if (data.error) return { error: data.error };
    if (!data.url || !data.apiKey) {
      return { error: 'Bitte OpenProject URL und API-Key in den Einstellungen speichern.' };
    }
    const client = new OpenProjectClient(data.url, data.apiKey);
    return await client.getProjects();
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

function sendImportProgress(sender, data) {
  updateTaskbarProgress(data);
  try {
    if (sender && !sender.isDestroyed()) sender.send('import-progress', data);
  } catch (_) {
    /* ignore */
  }
}

ipcMain.handle('dry-run', async (event, payload) => {
  const p = ipcPlainObject(payload);
  const sender = event.sender;
  return runPipeline(p, {
    dryRun: true,
    client: null,
    onProgress: (d) => sendImportProgress(sender, d),
  });
});

ipcMain.handle('import-file', async (event, payload) => {
  const p = ipcPlainObject(payload);
  const sender = event.sender;
  const data = await loadSettingsData();
  if (data.error) {
    sendImportProgress(sender, { phase: 'error', current: 0, total: 0, message: data.error });
    return {
      success: false,
      log: [],
      errors: [{ ref: 'Konfiguration', message: data.error }],
      warnings: [],
    };
  }
  const baseUrl = data.url;
  const apiKey = data.apiKey;
  if (!baseUrl || !apiKey) {
    sendImportProgress(sender, {
      phase: 'error',
      current: 0,
      total: 0,
      message: 'OpenProject URL und API-Key fehlen.',
    });
    return {
      success: false,
      log: [],
      errors: [
        {
          ref: 'Konfiguration',
          message:
            'OpenProject URL und API-Key fehlen. Bitte über das Zahnrad (Einstellungen) speichern.',
        },
      ],
      warnings: [],
    };
  }

  const rawPid = p && p.projectId != null ? String(p.projectId).trim() : '';
  if (!rawPid) {
    sendImportProgress(sender, {
      phase: 'error',
      current: 0,
      total: 0,
      message: 'Bitte eine gültige OpenProject-Projekt-ID angeben.',
    });
    return {
      success: false,
      log: [],
      errors: [{ ref: 'Projekt', message: 'Bitte eine gültige OpenProject-Projekt-ID angeben.' }],
      warnings: [],
    };
  }

  try {
    const client = new OpenProjectClient(baseUrl, apiKey);
    return runPipeline(p, {
      dryRun: false,
      client,
      onProgress: (d) => sendImportProgress(sender, d),
    });
  } catch (err) {
    sendImportProgress(sender, { phase: 'error', current: 0, total: 0, message: err.message || String(err) });
    return {
      success: false,
      log: [],
      errors: [{ ref: 'API', message: err.message || String(err) }],
      warnings: [],
    };
  }
});

ipcMain.handle('get-app-info', () => ({ version: appVersion }));

ipcMain.handle('clear-last-import-packages', () => {
  lastImportPackages = [];
  return { ok: true };
});

ipcMain.handle('export-work-packages', async (event, rawOptions) => {
  const options = ipcPlainObject(rawOptions);
  const fmt = options.format === 'csv' || options.format == null ? 'csv' : String(options.format);
  if (fmt !== 'csv') {
    return { success: false, error: 'Nur format: csv wird unterstützt.' };
  }
  if (!Array.isArray(lastImportPackages) || lastImportPackages.length === 0) {
    return { success: false, error: 'Kein Import-Ergebnis zum Export vorhanden.' };
  }
  if (!event.sender || event.sender.isDestroyed()) {
    return { success: false, error: 'Fenster nicht verfügbar.' };
  }
  const { canceled, filePath } = await dialog.showSaveDialog(event.sender, {
    title: 'Arbeitspakete exportieren',
    defaultPath: 'openbridge-work-packages.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    const csv = workPackagesToCsvSemicolon(lastImportPackages);
    await fs.writeFile(filePath, csv, 'utf8');
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('export-result', async (event, payload) => {
  const p = ipcPlainObject(payload);
  const kind = p.kind != null ? String(p.kind) : 'export';
  const result = p.result;
  if (!result || typeof result !== 'object') {
    return { success: false, error: 'Keine Daten zum Exportieren.' };
  }
  if (!event.sender || event.sender.isDestroyed()) {
    return { success: false, error: 'Fenster nicht verfügbar.' };
  }
  const flat = resultToCsvRows(result);
  const csv = buildCsvFromRows(flat);
  const { canceled, filePath } = await dialog.showSaveDialog(event.sender, {
    title: 'Export speichern',
    defaultPath: `openbridge-${kind}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    await fs.writeFile(filePath, csv, 'utf8');
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});
