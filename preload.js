const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reclaim', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  scanFolder: root => ipcRenderer.invoke('scan-folder', root),
  scanRaw: source => ipcRenderer.invoke('scan-raw', source),
  preview: candidate => ipcRenderer.invoke('preview', candidate),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: payload => ipcRenderer.invoke('download-update', payload),
  installUpdate: installerPath => ipcRenderer.invoke('install-update', installerPath),
  onUpdateProgress: callback => ipcRenderer.on('update-progress', (_, value) => callback(value)),
  recover: payload => ipcRenderer.invoke('recover', payload),
  openFolder: folder => ipcRenderer.invoke('open-folder', folder),
  onProgress: callback => ipcRenderer.on('scan-progress', (_, value) => callback(value))
});
