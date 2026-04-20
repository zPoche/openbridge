# 🌉 openbridge

> Import Gantt project plans (Excel, CSV, MS Project & more) into OpenProject — with preview, validation and one click.

## Features

- 📂 Import `.xlsx`, `.csv`, MS Project exports and more
- 🔍 Dry-Run: preview what would be imported before anything is sent
- 🗂️ Smart column mapping with saved profiles
- 🌳 Automatic parent/child hierarchy handling (multi-pass import)
- ✅ Validation before import (missing required fields, date conflicts, duration logic)
- 🔄 Create new work packages **or** update existing ones
- 🖥️ Electron desktop app — double-click and go, no setup needed

## Stack

- **Backend:** Node.js
- **UI:** Electron + HTML/CSS/JS
- **Excel parsing:** `xlsx`
- **API:** OpenProject REST API

## Project Structure

```
openbridge/
├── src/
│   ├── adapters/          # Input format adapters (Excel, CSV, MSProject, ...)
│   │   ├── ExcelAdapter.js
│   │   ├── CsvAdapter.js
│   │   └── BaseAdapter.js
│   ├── core/              # Core logic
│   │   ├── Importer.js    # Orchestrates import passes
│   │   ├── Mapper.js      # Maps internal model to OpenProject API
│   │   ├── Validator.js   # Validates work packages before import
│   │   └── IdRegistry.js  # Tracks local_id → openproject_id
│   ├── api/               # OpenProject API client
│   │   └── OpenProjectClient.js
│   ├── ui/                # Electron frontend
│   │   ├── index.html
│   │   ├── app.js
│   │   └── style.css
│   └── main.js            # Electron entry point
├── profiles/              # Saved column mapping profiles
├── .env.example
├── package.json
└── README.md
```

## Internal Data Model

All adapters convert their input into a unified intermediate format:

```json
{
  "local_id": "WF-01",
  "parent_local_id": null,
  "openproject_id": null,
  "title": "Phase 1 - Rohbau",
  "type": "Phase",
  "status": "Offen",
  "start_date": "2026-09-11",
  "end_date": "2026-10-08",
  "duration": null,
  "description": "",
  "assignee": null,
  "predecessors": []
}
```

> `duration` is only set when **no start/end date** is present. OpenProject derives duration from start+end automatically.

## Import Flow

```
1. Load file
2. Detect / select adapter
3. Map columns (manual or saved profile)
4. Validate (required fields, date logic, parent refs)
5. Dry-Run preview
6. User confirms
7. Pass 1: Create top-level work packages (no parent)
8. Pass 2: Create children (with real OpenProject parent IDs)
9. Pass 3 (optional): Patch dates / extra fields
10. Show import log
```

## Setup (Development)

```bash
npm install
npm run dev
```

## Build Electron App

```bash
npm run build
# → dist/openbridge-setup.exe
```

## Configuration

OpenProject URL and API key are stored in the app via **Settings** (gear icon in the header). They are persisted to `settings.json` under the Electron user data directory.

For local development you can still use a `.env` file if you wire it elsewhere, but the packaged UI flow expects the in-app settings.

## Security / Abhängigkeiten

**Stand Upgrade (siehe `UPGRADE_NOTES.md`):** `electron` ist auf **41.2.1** und `electron-builder` auf **26.8.1** angehoben; der Renderer bleibt mit `contextIsolation: true`, `nodeIntegration: false` und schmalem `contextBridge`-API (`preload.js`) abgeschottet.

Ein `npm audit` kann weiterhin insbesondere **xlsx (SheetJS)** melden (**Prototype Pollution**, **ReDoS**). Für das öffentliche npm-Paket `xlsx` gibt es häufig **keinen regulären npm-Fix**; das Advisory bleibt damit ein **bekanntes Restrisiko**, solange SheetJS im Projekt bleibt. Langfristige Optionen wären z. B. ein anderer Parser oder ein reduzierter Import-Pfad (z. B. nur CSV).

openbridge wird derzeit als **internes Tool** eingesetzt, das **nur vertrauenswürdige Dateien** importiert. Damit ist das praktische Risiko aus den genannten Themen deutlich geringer als bei einer breit verteilten Consumer-App.

Relevante Advisory-/Dokumentationslinks:

- [GHSA-4r6h-8v6p-xvw6 – Prototype Pollution in SheetJS Community Edition](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)
- [GHSA-5pgg-2g8v-p4x9 – SheetJS Regular Expression Denial of Service (ReDoS)](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)
- [Electron – Sicherheit & Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)

## Roadmap

- [x] Project structure
- [ ] ExcelAdapter
- [ ] CsvAdapter
- [ ] Column mapping UI
- [ ] Validator
- [ ] Dry-Run preview
- [ ] Importer (multi-pass)
- [ ] OpenProject API client
- [ ] Electron UI
- [ ] MSProject XML adapter
- [ ] Saved mapping profiles
- [ ] Auto-updater

## License

MIT
