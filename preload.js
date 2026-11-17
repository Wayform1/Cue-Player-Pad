'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  pickAudioFile: (title) => ipcRenderer.invoke('dialog:pick-audio', title),
  readAudioFile: (filePath) => ipcRenderer.invoke('fs:read-audio', filePath),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (data) => ipcRenderer.invoke('config:save', data),
  saveConfigSync: (data) => ipcRenderer.sendSync('config:save-sync', data),
  getConfigPath: () => ipcRenderer.invoke('config:path'),
  saveProject: (data) => ipcRenderer.invoke('project:save', data),
  publishRemoteState: (state) => ipcRenderer.send('remote:publish', state),
  getRemoteInfo: () => ipcRenderer.invoke('remote:info'),
  onRemoteCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('remote:command', listener);
    return () => ipcRenderer.removeListener('remote:command', listener);
  },
});
