require('dotenv').config();
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const XLSX = require('xlsx');

const ExcelAdapter = require('./adapters/ExcelAdapter');
const CsvAdapter = require('./adapters/CsvAdapter');
const BaseAdapter = require('./adapters/BaseAdapter');
const Importer = require('./core/Importer');
const OpenProjectClient = require('./api/OpenProjectClient');

const baseAdapter = new BaseAdapter();

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

  if (field === 'openproject_id') {
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

async function runPipeline({ filePath, mapping, projectId }, { dryRun, client }) {
  try {
    const adapter = createAdapterForPath(filePath);
    const rows = await adapter.parse(filePath);
    const { workPackages, skippedRows } = mapRowsToWorkPackages(rows, mapping);

    if (workPackages.length === 0) {
      const warnings = [];
      if (skippedRows > 0) {
        warnings.push({
          ref: 'Datei',
          rowIndex: null,
          message: `${skippedRows} Zeile(n) ohne Titel wurden beim Einlesen übersprungen.`,
        });
      }
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

    const importer = new Importer(client, { dryRun });
    const result = await importer.run(workPackages, projectId);

    const extraWarnings = [];
    if (skippedRows > 0) {
      extraWarnings.push({
        ref: 'Datei',
        rowIndex: null,
        message: `${skippedRows} Zeile(n) ohne Titel wurden beim Einlesen übersprungen.`,
      });
    }

    return {
      success: result.success,
      log: result.log,
      errors: result.errors,
      warnings: [...(result.warnings || []), ...extraWarnings],
    };
  } catch (err) {
    return {
      success: false,
      log: [],
      errors: [{ ref: 'Datei', message: err.message || String(err) }],
      warnings: [],
    };
  }
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'ui', 'preload.js'),
      contextIsolation: true,
    },
    titleBarStyle: 'default',
    title: 'openbridge',
  });

  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: open file dialog
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Supported Files', extensions: ['xlsx', 'csv', 'xml'] },
    ],
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('get-columns', async (_event, { filePath }) => {
  if (!filePath) {
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
    await saveSettingsToDisk(settings || {});
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

ipcMain.handle('dry-run', async (_event, payload) => {
  return runPipeline(payload, { dryRun: true, client: null });
});

ipcMain.handle('import-file', async (_event, payload) => {
  const data = await loadSettingsData();
  if (data.error) {
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

  const rawPid = payload && payload.projectId != null ? String(payload.projectId).trim() : '';
  if (!rawPid) {
    return {
      success: false,
      log: [],
      errors: [{ ref: 'Projekt', message: 'Bitte eine gültige OpenProject-Projekt-ID angeben.' }],
      warnings: [],
    };
  }

  try {
    const client = new OpenProjectClient(baseUrl, apiKey);
    return runPipeline(payload, { dryRun: false, client });
  } catch (err) {
    return {
      success: false,
      log: [],
      errors: [{ ref: 'API', message: err.message || String(err) }],
      warnings: [],
    };
  }
});
