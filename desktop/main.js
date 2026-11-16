// ION Qoders desktop shell. The editor is the same web app, served from the app's own
// files on a fixed local address so sign-in, routing and the editor behave exactly as on the web.
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 47831 // must be listed in ALLOWED_ORIGINS on the server: http://localhost:47831
const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.map': 'application/json', '.txt': 'text/plain',
}

function serve() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0])
      let file = path.normalize(path.join(WEB, p))
      if (!file.startsWith(WEB)) { res.writeHead(403); return res.end() }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, 'index.html') // single-page app
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' })
      fs.createReadStream(file).pipe(res)
    })
    srv.on('error', reject)
    srv.listen(PORT, '127.0.0.1', () => resolve())
  })
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#0d0f15',
    title: 'ION Qoders',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  })
  Menu.setApplicationMenu(null)
  // links to other sites open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) { shell.openExternal(url); return { action: 'deny' } }
    return { action: 'allow' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) { e.preventDefault(); shell.openExternal(url) }
  })
  await win.loadURL(`http://localhost:${PORT}/`)
  return win
}

// ---------- saving projects to a folder on this computer ----------
ipcMain.handle('app-version', () => app.getVersion())
ipcMain.handle('disk-pick', async () => {
  const r = await dialog.showOpenDialog({ title: 'Choose a folder for this project', properties: ['openDirectory', 'createDirectory'] })
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
})
ipcMain.handle('disk-save', async (_e, { root, rel, content }) => {
  if (typeof root !== 'string' || typeof rel !== 'string' || typeof content !== 'string') throw new Error('bad request')
  const base = path.resolve(root)
  const target = path.resolve(base, rel)
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('That path is outside the project folder.')
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  await fs.promises.writeFile(target, content, 'utf8')
  return target
})
ipcMain.handle('disk-show', (_e, root) => { if (typeof root === 'string' && fs.existsSync(root)) shell.openPath(root) })

// ---------- updates (from the project's GitHub releases) ----------
let updater = null
function send(data) { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('upd', data) }
function setupUpdates() {
  if (!app.isPackaged) return
  try {
    ({ autoUpdater: updater } = require('electron-updater'))
  } catch { return }
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true
  updater.on('update-available', (i) => send({ state: 'available', version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes : '' }))
  updater.on('update-not-available', () => send({ state: 'none' }))
  updater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent || 0) }))
  updater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }))
  updater.on('error', (e) => send({ state: 'error', message: String((e && e.message) || e).slice(0, 160) }))
  const check = () => updater.checkForUpdates().catch(() => {})
  setTimeout(check, 6000)
  setInterval(check, 6 * 60 * 60 * 1000)
}
ipcMain.handle('upd-check', async () => {
  if (!updater) { send({ state: 'none' }); return }
  try { await updater.checkForUpdates() } catch (e) { send({ state: 'error', message: String(e.message || e).slice(0, 160) }) }
})
ipcMain.handle('upd-download', () => updater && updater.downloadUpdate().catch((e) => send({ state: 'error', message: String(e.message || e).slice(0, 160) })))
ipcMain.handle('upd-install', () => updater && updater.quitAndInstall())

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.whenReady().then(async () => {
    try { await serve() } catch (e) { if (e.code !== 'EADDRINUSE') throw e }
    await createWindow()
    setupUpdates()
  })
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus() } })
  app.on('window-all-closed', () => app.quit())
}
