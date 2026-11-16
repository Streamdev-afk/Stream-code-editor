// ION Qoders desktop shell. The editor is the same web app, served from the app's own
// files on a fixed local address so sign-in, routing and the editor behave exactly as on the web.
const { app, BrowserWindow, shell, Menu } = require('electron')
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.whenReady().then(async () => {
    try { await serve() } catch (e) { if (e.code !== 'EADDRINUSE') throw e }
    await createWindow()
  })
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus() } })
  app.on('window-all-closed', () => app.quit())
}
