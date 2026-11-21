const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pel', {
  list: () => ipcRenderer.invoke('reminders:list'),
  add: (r) => ipcRenderer.invoke('reminders:add', r),
  remove: (id) => ipcRenderer.invoke('reminders:remove', id),
  preview: (r) => ipcRenderer.invoke('reminders:preview', r),
  onChanged: (cb) => ipcRenderer.on('reminders:changed', () => cb()),
});
