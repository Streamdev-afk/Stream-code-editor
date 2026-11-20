// ION Qoders desktop shell. The editor is the same web app, served from the app's own
// files on a fixed local address so sign-in, routing and the editor behave exactly as on the web.
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron')
const http = require('http')
const { spawn } = require('child_process')
const os = require('os')
const https = require('https')
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
  // errors printed by the page of a local dev server shown in the preview (a different port than the editor itself)
  const isDevPage = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):(\d+)/.test(u || '') && !(u || '').startsWith(`http://localhost:${PORT}`) && !(u || '').startsWith(`http://127.0.0.1:${PORT}`)
  win.webContents.on('console-message', (_e, level, message, _line, sourceId) => {
    if (!isDevPage(sourceId) && !(level >= 2 && /Failed to load resource/.test(message) && isDevPage((message.match(/https?:\/\/\S+/) || [''])[0]))) return
    const lv = level >= 3 ? 'error' : level === 2 ? 'warn' : 'log'
    if (lv === 'log') return
    try { win.webContents.send('local-console', { level: lv, text: String(message).slice(0, 600) }) } catch {}
  })
  // a crashed or frozen page: save what is stored and bring the editor back by itself instead of leaving a black window
  const flush = () => { try { win.webContents.session.flushStorageData() } catch {} }
  const saver = setInterval(flush, 10000)
  win.on('closed', () => clearInterval(saver))
  win.on('close', flush)
  win.webContents.on('render-process-gone', () => { flush(); setTimeout(() => { try { win.reload() } catch {} }, 300) })
  win.webContents.on('unresponsive', () => { setTimeout(() => { try { if (!win.isDestroyed()) win.reload() } catch {} }, 15000) })
  await win.loadURL(`http://localhost:${PORT}/`)
  return win
}

// ---------- sign in with GitHub / Google inside the app ----------
// Opens the provider's login page in a small window. When the login finishes and it heads back to the app's own
// address, the window closes and the address (with the sign-in code) is handed back to the editor page.
ipcMain.handle('oauth-open', (_e, url) => new Promise((resolve) => {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return resolve(null)
  const parent = BrowserWindow.getAllWindows()[0]
  const win = new BrowserWindow({
    width: 520, height: 720, parent, modal: !!parent, autoHideMenuBar: true, title: 'Sign in',
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:oauth' },
  })
  // Google refuses logins from a window that calls itself "Electron", so look like a normal Chrome
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/\s?Electron\/\S+/, '').replace(/\s?ion-qoders-desktop\/\S+/i, ''))
  let done = false
  const finish = (v) => { if (done) return; done = true; resolve(v); if (!win.isDestroyed()) win.close() }
  const watch = (e, next) => {
    if (next.startsWith(`http://localhost:${PORT}`)) { e && e.preventDefault && e.preventDefault(); finish(next) }
  }
  win.webContents.on('will-redirect', watch)
  win.webContents.on('will-navigate', watch)
  win.webContents.setWindowOpenHandler(({ url: u }) => { win.loadURL(u); return { action: 'deny' } })
  win.on('closed', () => finish(null))
  win.loadURL(url)
}))

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

// ---------- the real terminal: a true shell (PowerShell on Windows, your login shell on Mac/Linux) ----------
let ptyLib = null
try { ptyLib = require('@lydell/node-pty') } catch { ptyLib = null }
const ptys = new Map()
const shellFor = () => {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo', '-ExecutionPolicy', 'Bypass'] }
  const sh = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return { file: sh, args: ['-l'] } // a login shell, so PATH has node, npm, brew, nvm like in your own terminal
}
ipcMain.handle('pty-available', () => !!ptyLib)
ipcMain.handle('pty-open', (e, { id, cwd, cols, rows }) => {
  if (!ptyLib) return { ok: false, error: 'The terminal engine is not available.' }
  const old = ptys.get(id)
  if (old) { old.sender = e.sender; return { ok: true, reused: true, buffer: old.buf, shell: old.file } }
  try { if (cwd && !fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true }) } catch {}
  const { file, args } = shellFor()
  try {
    const proc = ptyLib.spawn(file, args, {
      name: 'xterm-256color', cols: cols || 80, rows: rows || 24,
      cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    })
    const entry = { proc, buf: '', sender: e.sender, file }
    ptys.set(id, entry)
    proc.onData((d) => {
      entry.buf = (entry.buf + d).slice(-150000)
      try { entry.sender.send('pty-data', { id, data: d }) } catch {}
    })
    proc.onExit(({ exitCode }) => {
      ptys.delete(id)
      try { entry.sender.send('pty-exit', { id, code: exitCode }) } catch {}
    })
    return { ok: true, reused: false, buffer: '', shell: file }
  } catch (err) {
    return { ok: false, error: String(err.message || err) }
  }
})
ipcMain.on('pty-write', (_e, { id, data }) => { const t = ptys.get(id); if (t && typeof data === 'string') t.proc.write(data) })
ipcMain.on('pty-resize', (_e, { id, cols, rows }) => { const t = ptys.get(id); if (t && cols > 0 && rows > 0) { try { t.proc.resize(cols, rows) } catch {} } })
ipcMain.handle('pty-kill', (_e, id) => { const t = ptys.get(id); if (t) { try { t.proc.kill() } catch {} ptys.delete(id) } return true })
app.on('before-quit', () => { for (const t of ptys.values()) { try { t.proc.kill() } catch {} } })

// ---------- fallback terminal (only used if the engine above is missing): runs commands", on this computer, inside the project's folder ----------
const runs = new Map()
const insideRoot = (root, rel) => {
  const base = path.resolve(root)
  const target = path.resolve(base, rel || '.')
  return target === base || target.startsWith(base + path.sep) ? target : null
}
ipcMain.handle('term-run', (e, { id, root, cwd: cwdArg, cmd }) => new Promise((resolve) => {
  if (typeof cmd !== 'string' || !cmd.trim()) return resolve({ code: 1, error: 'bad request' })
  const cwd = typeof cwdArg === 'string' && cwdArg ? cwdArg : root
  if (typeof cwd === 'string' && !fs.existsSync(cwd) && typeof root === 'string' && path.resolve(cwd).startsWith(path.resolve(root))) { try { fs.mkdirSync(cwd, { recursive: true }) } catch {} }
  if (typeof cwd !== 'string' || !fs.existsSync(cwd)) return resolve({ code: 1, error: `The folder ${cwd} does not exist.` })
  const send = (chunk) => { try { e.sender.send('term-data', { id, chunk: chunk.toString('utf8') }) } catch {} }
  const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
  const child = process.platform === 'win32'
    ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { cwd, env, windowsHide: true })
    : spawn(process.env.SHELL || '/bin/bash', ['-l', '-c', cmd], { cwd, env })
  runs.set(id, child)
  child.stdout.on('data', send)
  child.stderr.on('data', send)
  child.on('error', (err) => { runs.delete(id); resolve({ code: 1, error: String(err.message || err) }) })
  child.on('close', (code) => { runs.delete(id); resolve({ code: code == null ? 1 : code }) })
}))
// cd for real: checks the folder exists, like a normal terminal
ipcMain.handle('term-cd', (_e, { cwd, target }) => {
  let t = String(target || '').trim().replace(/^["']|["']$/g, '')
  if (!t || t === '~') t = os.homedir()
  else if (t.startsWith('~/') || t.startsWith('~\\')) t = path.join(os.homedir(), t.slice(2))
  if (/^[a-z]:$/i.test(t)) t += path.sep // "D:" jumps to that drive
  const next = path.resolve(cwd || os.homedir(), t)
  let st
  try { st = fs.statSync(next) } catch { return { ok: false, error: process.platform === 'win32' ? 'The system cannot find the path specified.' : `cd: no such file or directory: ${target}` } }
  if (!st.isDirectory()) return { ok: false, error: process.platform === 'win32' ? 'The directory name is invalid.' : `cd: not a directory: ${target}` }
  return { ok: true, cwd: next }
})
ipcMain.handle('term-kill', (_e, id) => {
  const c = runs.get(id)
  if (!c) return false
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'])
  else c.kill('SIGTERM')
  return true
})
// download a file from the web straight into the project folder
ipcMain.handle('term-download', (e, { id, root, cwd: cwdArg, url, name }) => new Promise((resolve) => {
  const say = (t) => { try { e.sender.send('term-data', { id, chunk: t }) } catch {} }
  const cwd = typeof cwdArg === 'string' && cwdArg ? cwdArg : root
  if (!cwd || !fs.existsSync(cwd)) return resolve({ code: 1, error: 'That folder does not exist.' })
  let u
  try { u = new URL(url) } catch { return resolve({ code: 1, error: 'That is not a valid link.' }) }
  if (!/^https?:$/.test(u.protocol)) return resolve({ code: 1, error: 'Only http and https links work.' })
  const fetchOne = (link, hops) => {
    const mod = link.protocol === 'http:' ? require('http') : https
    const req = mod.get(link, { headers: { 'User-Agent': 'ion-qoders' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
        res.resume()
        return fetchOne(new URL(res.headers.location, link), hops + 1)
      }
      if (res.statusCode !== 200) { res.resume(); return resolve({ code: 1, error: `The server answered ${res.statusCode}.` }) }
      const fileName = (name || decodeURIComponent(path.basename(link.pathname)) || 'download').replace(/[\\/:*?"<>|]/g, '_')
      const target = path.join(cwd, fileName)
      const total = Number(res.headers['content-length']) || 0
      let got = 0, last = 0
      const out = fs.createWriteStream(target)
      res.on('data', (c) => {
        got += c.length
        if (got > 300 * 1024 * 1024) { res.destroy(); out.destroy(); fs.unlink(target, () => {}); return resolve({ code: 1, error: 'Stopped: the file is bigger than 300 MB.' }) }
        if (Date.now() - last > 700) { last = Date.now(); say(`\rDownloading ${fileName}: ${(got / 1048576).toFixed(1)} MB${total ? ` of ${(total / 1048576).toFixed(1)} MB` : ''}   `) }
      })
      res.pipe(out)
      out.on('finish', () => { say(`\nSaved ${fileName} (${(got / 1048576).toFixed(2)} MB) in ${cwd}\n`); resolve({ code: 0 }) })
      out.on('error', (err) => resolve({ code: 1, error: String(err.message || err) }))
    })
    req.on('error', (err) => resolve({ code: 1, error: String(err.message || err) }))
    req.setTimeout(30000, () => { req.destroy(); resolve({ code: 1, error: 'The download timed out.' }) })
  }
  fetchOne(u, 0)
}))

// text files in the project folder that changed since a moment ago (so files a command made show up in the editor)
const SKIP_DIRS = new Set(['node_modules', '.git', 'venv', '.venv', '__pycache__', 'dist', 'build', '.next', '.cache', 'target', 'release', 'bin', 'obj', 'out', 'platform-tools', 'vendor', 'Pods', '.gradle', '.idea', '.vscode', '.dart_tool', '__MACOSX', 'tmp', 'temp', 'coverage', 'site-packages', 'lib64'])
const TEXT_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|json|html|htm|css|scss|md|txt|py|rb|go|rs|java|c|h|cpp|cs|php|sh|yml|yaml|toml|xml|svg|env|gitignore|sql|vue|svelte)$/i
async function scanFolder(root, since, limit) {
  const out = {}
  let count = 0
  let over = false
  const walk = async (dir, rel) => {
    let items
    try { items = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const it of items) {
      if (over) return
      const r = rel ? `${rel}/${it.name}` : it.name
      if (it.isDirectory()) { if (!SKIP_DIRS.has(it.name) && !it.name.startsWith('.')) await walk(path.join(dir, it.name), r); continue }
      if (!it.isFile() || !TEXT_EXT.test(it.name)) continue
      try {
        const full = path.join(dir, it.name)
        const st = await fs.promises.stat(full)
        if (st.mtimeMs < since || st.size > 300 * 1024) continue
        if (count >= limit) { over = true; return }
        out[r] = await fs.promises.readFile(full, 'utf8')
        count++
      } catch {}
    }
  }
  if (typeof root === 'string' && fs.existsSync(root)) await walk(path.resolve(root), '')
  return { files: out, tooMany: over }
}
// files a command made or changed (small numbers only: a big pile is not the user's project)
ipcMain.handle('term-scan', (_e, { root, since }) => scanFolder(root, since, 25))
// open an existing folder's project files in the editor
ipcMain.handle('disk-read', (_e, root) => scanFolder(root, 0, 300))

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
