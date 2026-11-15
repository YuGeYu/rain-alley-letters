const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rainTool', Object.freeze({
  call: (action, args = {}) => ipcRenderer.invoke('player-tool:call', action, args),
  chooseDirectory: () => ipcRenderer.invoke('player-tool:choose', 'directory'),
  chooseFile: () => ipcRenderer.invoke('player-tool:choose', 'file'),
  openLink: url => ipcRenderer.invoke('player-tool:link', url),
}));
