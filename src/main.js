require('dotenv').config();
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
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

function formatExcelSerial(value) {
  try {
    const date = XLSX.SSF.parse_date_code(value);
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function normalizeDateField(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw instanceof Date) return raw.toISOString().split('T')[0];
  if (typeof raw === 'number') {
    const iso = formatExcelSerial(raw);
    if (iso) return iso;
  }
  const s = String(raw).trim();
  return s || null;
}

function cellValue(row, mapping, field) {
  const col = mapping[field];
  if (col === undefined || col === null) return null;
  if (typeof col !== 'string' || col.trim() === '') return null;
  const key = col.trim();
  if (!Object.prototype.hasOwnProperty.call(row, key)) return null;
  const v = row[key];
  if (v === undefined || v === null || v === '') return null;

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

ipcMain.handle('dry-run', async (_event, payload) => {
  return runPipeline(payload, { dryRun: true, client: null });
});

ipcMain.handle('import-file', async (_event, payload) => {
  const baseUrl = process.env.OPENPROJECT_URL;
  const apiKey = process.env.OPENPROJECT_API_KEY;
  if (!baseUrl || !apiKey) {
    return {
      success: false,
      log: [],
      errors: [
        {
          ref: 'Konfiguration',
          message:
            'OPENPROJECT_URL und OPENPROJECT_API_KEY müssen in der Umgebung oder .env gesetzt sein.',
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
