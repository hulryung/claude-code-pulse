const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchRateLimits: () => ipcRenderer.invoke('fetch-rate-limits'),
  startLogin: () => ipcRenderer.invoke('start-login'),
  logout: () => ipcRenderer.invoke('logout'),
  onAutoRefresh: (callback) => {
    ipcRenderer.on('auto-refresh-data', (_, data) => callback(data));
  },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  quitApp: () => ipcRenderer.send('quit-app'),
});
