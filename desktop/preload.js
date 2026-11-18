const { contextBridge, ipcRenderer } = require('electron')

// The small, safe set of things the editor page may ask the desktop app to do.
contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  version: () => ipcRenderer.invoke('app-version'),
  // sign in with GitHub or Google in a small window inside the app
  oauth: (url) => ipcRenderer.invoke('oauth-open', url),
  // errors from a local dev server's page shown in the preview
  onLocalConsole: (cb) => {
    const f = (_e, d) => cb(d)
    ipcRenderer.on('local-console', f)
    return () => ipcRenderer.removeListener('local-console', f)
  },
  // real terminal (runs on this computer, inside the project folder)
  termRun: (id, root, cwd, cmd) => ipcRenderer.invoke('term-run', { id, root, cwd, cmd }),
  termCd: (cwd, target) => ipcRenderer.invoke('term-cd', { cwd, target }),
  diskRead: (root) => ipcRenderer.invoke('disk-read', root),
  termDownload: (id, root, cwd, url, name) => ipcRenderer.invoke('term-download', { id, root, cwd, url, name }),
  termKill: (id) => ipcRenderer.invoke('term-kill', id),
  termScan: (root, since) => ipcRenderer.invoke('term-scan', { root, since }),
  onTermData: (cb) => {
    const f = (_e, d) => cb(d)
    ipcRenderer.on('term-data', f)
    return () => ipcRenderer.removeListener('term-data', f)
  },
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
