# 🌉 openbridge

> Import Gantt project plans from **`.xlsx`**, **`.xls`**, and **`.csv`** into OpenProject — with preview, validation and one click.

## Features

- 📂 Import `.xlsx`, `.xls`, and `.csv`
- 🔍 Dry-Run: preview what would be imported before anything is sent
- 🗂️ Column mapping UI for manual field mapping during import
- 🌳 Automatic parent/child hierarchy handling (multi-pass import)
- ✅ Validation before import (missing required fields, date conflicts, duration logic)
- 🔄 Create new work packages **or** update existing ones
- 🖥️ Electron desktop app — double-click and go, no setup needed

## Stack

- **Backend:** Node.js (≥ 18 recommended; matches current Electron toolchain)
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

**Build environment:** `electron-builder` runs `npm list` internally to collect production dependencies. That step needs a working **`npm` on your PATH** (a normal Node.js install is enough). In minimal setups (e.g. editor-bundled or portable Node **without** npm), the build can fail during that phase — that is an environment issue, not an application bug.

## Configuration

OpenProject URL and API key are stored in the app via **Settings** (gear icon in the header). They are persisted to `settings.json` under the Electron user data directory.

For local development you can still use a `.env` file if you wire it elsewhere, but the packaged UI flow expects the in-app settings.

A **`.env.example`** file is included as a reference for optional variables; it is **not required** for normal operation.

## Security / Abhängigkeiten

**Electron & Build-Toolchain:** The stack is pinned to **`electron@41.2.1`** and **`electron-builder@26.8.1`**. That upgrade is **done** (not planned). It also pulls in current transitive tooling (including **`tar` / `node-tar`** used by the packaging pipeline), which addresses typical **`npm audit`** findings tied to older electron-builder / tar versions.

**Renderer hardening:** The UI runs with **`contextIsolation: true`**, **`nodeIntegration: false`**, and a narrow **`contextBridge`** surface in `preload.js` (no broad exposure of Node or Electron APIs to the page).

**`xlsx` (SheetJS):** `npm audit` may still report **Prototype Pollution** and **ReDoS** for the public `xlsx` package; there is often **no regular npm advisory fix** for the community edition. That remains a **known residual risk** while SheetJS stays in the dependency tree. Longer-term mitigations could include another parser or a reduced import path (e.g. CSV-only).

openbridge is used as an **internal tool** that imports **trusted files only**, which lowers practical exposure compared with a wide consumer deployment.

Relevant links:

- [GHSA-4r6h-8v6p-xvw6 – Prototype Pollution in SheetJS Community Edition](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)
- [GHSA-5pgg-2g8v-p4x9 – SheetJS Regular Expression Denial of Service (ReDoS)](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)
- [Electron – Security & Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)

## Roadmap

- [x] Project structure
- [x] ExcelAdapter (`.xlsx`, `.xls`)
- [x] CsvAdapter
- [x] Column mapping UI
- [x] Validator
- [x] Dry-Run preview
- [x] Importer (multi-pass)
- [x] OpenProject API client
- [x] Electron UI
- [ ] MSProject XML adapter
- [ ] Saved mapping profiles
- [ ] Auto-updater

## License

MIT
