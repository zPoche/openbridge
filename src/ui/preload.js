const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  openFile: () => ipcRenderer.invoke('open-file-dialog'),
  getColumns: (args) => ipcRenderer.invoke('get-columns', args),
  importFile: (args) => ipcRenderer.invoke('import-file', args),
  dryRun: (args) => ipcRenderer.invoke('dry-run', args),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
  exportResult: (payload) => ipcRenderer.invoke('export-result', payload),
  exportWorkPackages: (options) => ipcRenderer.invoke('export-work-packages', options || {}),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  clearLastImportPackages: () => ipcRenderer.invoke('clear-last-import-packages'),
  onImportProgress: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('import-progress', (_event, data) => {
      handler(data);
    });
  },
});
