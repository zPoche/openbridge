# Dependency-Upgrade (Electron / electron-builder)

**Datum:** 2026-04-20

## Geänderte Versionen

| Paket            | Vorher (Lockfile)     | Nachher   |
|------------------|------------------------|-----------|
| `electron`       | `^30.0.0` (aufgelöst)  | `41.2.1`  |
| `electron-builder` | `^24.0.0` (aufgelöst) | `26.8.1` |

`package.json` pinnt beide Pakete in `devDependencies` auf die genannten Versionen; `package-lock.json` wurde per `npm install` neu aufgelöst.

## Anwendungscode

- **Keine Änderungen** an `src/main.js`, `src/ui/preload.js` oder `src/ui/app.js` nötig.
- `BrowserWindow` behält `contextIsolation: true`, `nodeIntegration: false` und den `preload`-Pfad wie bisher.
- Renderer nutzt weiterhin nur `window.bridge` (exponiert in `preload.js`).

## Skripte / Build

- `npm run dev` und `npm run build` sind mit installiertem **Node.js inkl. npm auf dem PATH** geprüft (electron-builder 26 ruft intern `npm list` auf; ohne erreichbares `npm` kann die Modulsammlung fehlschlagen).
- `electron-builder`-Konfiguration im `package.json`-Feld `build` unverändert; NSIS-Build unter Windows erfolgreich getestet.

## Bekannte Restpunkte

- **`npm audit`:** Meldungen zu **`xlsx` (SheetJS)** (Prototype Pollution / ReDoS) sind **erwartbar**; für das Community-npm-Paket wird oft **kein regulärer Fix** angeboten. Paket bleibt bewusst; Risiko-Hinweis siehe README.
- Sonstige transitive Deprecation-Warnungen von npm während der Installation sind kosmetisch.
