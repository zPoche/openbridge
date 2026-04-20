# Dependency-Upgrade (Electron / electron-builder)

**Datum:** 2026-04-20

## Geänderte Versionen

| Paket            | Vorher (Lockfile)     | Nachher   |
|------------------|------------------------|-----------|
| `electron`       | `^30.0.0` (aufgelöst)  | `41.2.1`  |
| `electron-builder` | `^24.0.0` (aufgelöst) | `26.8.1` |

`package.json` pinnt beide Pakete in `devDependencies` auf die genannten Versionen; `package-lock.json` wurde per `npm install` neu aufgelöst.

## Anwendungscode (historisch zum Upgrade-Zeitpunkt)

- Seit späteren Features: `src/main.js`, `preload.js` und `src/ui/app.js` wurden u. a. um Fortschritt, Export und App-Info erweitert (siehe unten).
- `BrowserWindow` behält `contextIsolation: true`, `nodeIntegration: false` und den `preload`-Pfad wie bisher.
- Renderer nutzt weiterhin nur `window.bridge` (exponiert in `preload.js`).

## Skripte / Build

- `npm run dev` und `npm run build` sind mit installiertem **Node.js inkl. npm auf dem PATH** geprüft (electron-builder 26 ruft intern `npm list` auf; ohne erreichbares `npm` kann die Modulsammlung fehlschlagen).
- **Windows-Artefakte:** `electron-builder` schreibt nach **`release/`** (Installer `openbridge Setup <version>.exe`, dazu `win-unpacked/`). Ältere Hinweise auf nur `dist/` sind obsolet.
- **CI:** Workflow `.github/workflows/release.yml` — `windows-latest`, `npm ci`, `npm run build`, Artifact-Upload. **Push auf `main`** oder **workflow_dispatch:** nur Build + Artifact. **Tag `v*`** (z. B. `v1.0.0`): zusätzlich **GitHub Release** mit `release/openbridge Setup *.exe` (`softprops/action-gh-release`, `CSC_IDENTITY_AUTO_DISCOVERY=false`, `GITHUB_TOKEN`).
- **Release auslösen:** lokalen Stand committen, dann `git tag v1.0.0` und `git push origin v1.0.0` (Version anpassen). Der Workflow erzeugt Release-Titel `openbridge v1.0.0` (aus Tag-Namen).
- **`package.json`:** u. a. `author` gesetzt (Hinweis von electron-builder), `artifactName`, explizites **`directories.output`: `release`**.

## Bekannte Restpunkte

- **`npm audit`:** Meldungen zu **`xlsx` (SheetJS)** (Prototype Pollution / ReDoS) sind **erwartbar**; für das Community-npm-Paket wird oft **kein regulärer Fix** angeboten. Paket bleibt bewusst; Risiko-Hinweis siehe README.
- Sonstige transitive Deprecation-Warnungen von npm während der Installation sind kosmetisch.
- **OpenProject-Vorgänger / Relations:** Die CSV-Spalte `predecessor_openproject_ids` dokumentiert IDs; **Anlegen von Relations** über die API ist **noch kein Produktiv-Feature** (Follow-up: z. B. `/api/v3/relations` nach erfolgreichem Import, getrennt planen).

## R3 (Stabilität / UX, Kurzüberblick)

- Main: einheitliches Log-Präfix `[openbridge]`, weniger doppelte Ausgabe; Renderer-`console-message` nur mit `OPENBRIDGE_LOG_RENDERER_CONSOLE=1`.
- `BrowserWindow`: `sandbox: true` (weiterhin `contextIsolation` + `preload`); Taskleisten-Fortschritt über `setProgressBar`, wo sinnvoll aus Import-Phasen ableitbar.
- IPC: robustere Payloads (`get-columns`, Export-Dialoge, `save-settings`); korrigierte Fehlermeldung bei **nicht unterstütztem Dateityp**; Dateiauswahl-Filter nur `.csv` / `.xlsx` / `.xls`.
- CSV-Exporte: UTF-8 mit **BOM** (`\uFEFF`) für Excel/LibreOffice; Fehlerantworten teils mit `success: false` ergänzt.
- UI: Fortschrittstexte vereinheitlicht; nach **neuer Validierung** werden alter Import-Erfolg und WP-Export-Cache zurückgesetzt; Import-IPC-Fehler setzen `lastImportResult` konsistent.
- OpenProject-HTTP-Client: **Timeout 120 s** gegen hängende Aufrufe.

## Import-Export & App-Version (Stand Erweiterung)

- **CSV-Export importierter Arbeitspakete:** Nach einem **erfolgreichen echten Import** (nicht Dry-Run) können die verarbeiteten Pakete über **„Exportieren (CSV)“** gespeichert werden. Format: **Semikolon (`;`)** als Trennzeichen, UTF-8. Spalten (ohne `local_id`): `openproject_id`, `parent_openproject_id`, `predecessor_openproject_ids` (mehrere IDs mit `|`), `title`, `type`, `status`, `start_date`, `end_date`, `duration`, `description`, `assignee`. Implementierung: Main speichert `lastImportPackages` nach erfolgreichem Import; IPC `export-work-packages` + `workPackagesToCsvSemicolon` in `src/main.js`; Daten kommen aus `Importer` (`finalPackages` / Registry-Auflösung).
- **App-Version in den Einstellungen:** Anzeige aus `package.json` (`version`, aktuell **1.0.0**), geladen per IPC `get-app-info` / `window.bridge.getAppInfo()` beim Öffnen des Einstellungsdialogs.
