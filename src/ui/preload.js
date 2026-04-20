const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  openFile: () => ipcRenderer.invoke('open-file-dialog'),
  getColumns: (args) => ipcRenderer.invoke('get-columns', args),
  importFile: (args) => ipcRenderer.invoke('import-file', args),
  dryRun: (args) => ipcRenderer.invoke('dry-run', args),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
});
