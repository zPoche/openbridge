# openbridge

Import von Projektplänen aus **`.xlsx`**, **`.xls`** und **`.csv`** nach **OpenProject** — mit Spalten-Mapping, Validierung, Dry-Run und Mehrpass-Import (Eltern/Kinder, Updates).

## Features

- Import **`.xlsx`**, **`.xls`**, **`.csv`**
- **Dry-Run:** Vorschau, bevor etwas an die API geht
- **Spalten-Mapping** im Assistenten (pro Datei; keine gespeicherten Profil-Dateien in der App)
- **Hierarchie:** mehrstufiger Import (oberste Pakete → Kinder mit aufgelösten Parent-IDs)
- **Validierung** (Pflichtfelder, Datumslogik, Parent-Hinweise)
- **Neu anlegen oder aktualisieren** (`openproject_id` gesetzt → Update-Pass)
- Nach **erfolgreichem echtem Import:** **CSV-Export** der verarbeiteten Arbeitspakete (Semikolon, UTF-8 mit BOM), Spalten u. a. `openproject_id`, `parent_openproject_id`, `predecessor_openproject_ids` — **ohne** `local_id`
- **Einstellungen:** OpenProject-URL, API-Key, Projektliste; **App-Version** (z. B. **1.0.0** aus `package.json`)
- **Desktop:** Electron-App; **Windows:** NSIS-Installer aus `npm run build` (siehe unten)

## Stack

- **Runtime:** Node.js (≥ 18 empfohlen; orientiert am Electron-Toolchain)
- **UI:** Electron + HTML/CSS/JS
- **Tabellen:** `xlsx` (Excel), `csv-parse` (CSV)
- **API:** OpenProject REST API v3 (`axios`)

## Projektstruktur (Auszug)

```
openbridge/
├── src/
│   ├── adapters/          # ExcelAdapter, CsvAdapter, BaseAdapter
│   ├── core/              # Importer, Validator, IdRegistry
│   ├── api/               # OpenProjectClient
│   ├── ui/                # Renderer (index.html, app.js, style.css, preload.js)
│   └── main.js            # Electron Main-Prozess
├── .env.example
├── package.json
└── README.md
```

## Datenmodell (vereinfacht)

Adapter liefern u. a. `local_id`, `parent_local_id`, `parent_openproject_id`, `openproject_id`, `title`, `type`, Daten, `predecessors` (intern). Der Export nach Import enthält nur noch **OpenProject-IDs** (siehe CSV-Export oben).

## Ablauf in der App

```
1. Datei wählen
2. Spalten zuordnen
3. Validieren (Dry-Run) → Vorschau
4. Import ausführen
5. Optional: CSV der importierten Pakete exportieren / Log exportieren
6. Einstellungen (Zahnrad)
```

## Entwicklung

```bash
npm install
npm run dev
```

## Windows-Build (NSIS)

```bash
npm run build
```

**Ergebnis (Standardkonfiguration):**

| Artefakt | Pfad |
|----------|------|
| **Installer (NSIS, x64)** | `release/openbridge Setup 1.0.0.exe` (Version aus `package.json`) |
| **Entpackte App (Test ohne Installer)** | `release/win-unpacked/openbridge.exe` |
| **Blockmap** (Update-Mechanik; ohne eigenen Auto-Updater oft unnötig) | `release/openbridge Setup 1.0.0.exe.blockmap` |

Es wird **keine** zusätzliche portable `.exe` erzeugt — nur NSIS-Installer und `win-unpacked`.

**Build-Umgebung:** `electron-builder` nutzt intern u. a. `npm list`. Dafür muss **`npm` auf dem PATH** liegen (normale Node-Installation).

**Hinweise:**

- Wenn der Build mit *„Datei wird von einem anderen Prozess verwendet“* (`app.asar`) fehlschlägt: laufende **openbridge**-Instanz beenden, ggf. Explorer/Virenscanner vom Ordner `release/` bzw. früher `dist/` fernhalten, Ordner manuell löschen und erneut bauen.
- **Code Signing:** Im Repository ist **kein** Signaturzertifikat konfiguriert. Lokal kann Windows trotzdem `signtool` anzeigen; in **GitHub Actions** ist `CSC_IDENTITY_AUTO_DISCOVERY=false` gesetzt (Workflow `.github/workflows/release.yml`). Für ausgelieferte Builds: Zertifikat + Signing separat planen.

## Konfiguration

URL und API-Key werden in der App unter **Einstellungen** gespeichert (`settings.json` im Electron-`userData`-Ordner). `.env` / `.env.example` sind optional und nicht für den normalen UI-Flow nötig.

## Sicherheit / Abhängigkeiten

- **Electron `41.2.1`**, **electron-builder `26.8.1`** (siehe `package.json`).
- **Renderer:** `contextIsolation: true`, `nodeIntegration: false`, schmale Bridge in `preload.js`.
- **`xlsx` (SheetJS):** `npm audit` kann **Prototype Pollution** / **ReDoS** melden; für das Community-Paket fehlt oft ein regulärer Fix — **bekanntes Restrisiko**. openbridge ist als **internes Tool** für **vertrauenswürdige Dateien** gedacht.

Links u. a.:

- [GHSA-4r6h-8v6p-xvw6 – SheetJS Community Edition](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)
- [GHSA-5pgg-2g8v-p4x9 – SheetJS ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)
- [Electron – Sicherheit](https://www.electronjs.org/docs/latest/tutorial/security)

## Roadmap (Auswahl)

- [x] Kern-Flows (Import, Dry-Run, Mapping, Validator, Multi-Pass, OP-Client, UI)
- [x] CSV-Export importierter Arbeitspakete
- [ ] MS Project / XML-Adapter (nicht implementiert)
- [ ] Gespeicherte Mapping-Profile (nicht implementiert)
- [ ] Auto-Updater

## License

MIT
