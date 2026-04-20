const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  openFile: () => ipcRenderer.invoke('open-file-dialog'),
  importFile: (args) => ipcRenderer.invoke('import-file', args),
  dryRun: (args) => ipcRenderer.invoke('dry-run', args),
});
