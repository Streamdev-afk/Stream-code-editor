const { contextBridge, ipcRenderer } = require('electron')

// The small, safe set of things the editor page may ask the desktop app to do.
contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  version: () => ipcRenderer.invoke('app-version'),
  // sign in with GitHub or Google in a small window inside the app
  oauth: (url) => ipcRenderer.invoke('oauth-open', url),
  // saving projects to a folder on this computer
  pickFolder: () => ipcRenderer.invoke('disk-pick'),
  saveFile: (root, rel, content) => ipcRenderer.invoke('disk-save', { root, rel, content }),
  showFolder: (root) => ipcRenderer.invoke('disk-show', root),
  // updates
  checkUpdate: () => ipcRenderer.invoke('upd-check'),
  downloadUpdate: () => ipcRenderer.invoke('upd-download'),
  installUpdate: () => ipcRenderer.invoke('upd-install'),
  onUpdate: (cb) => {
    const f = (_e, data) => cb(data)
    ipcRenderer.on('upd', f)
    return () => ipcRenderer.removeListener('upd', f)
  },
})
