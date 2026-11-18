// Save a project into a real folder on this computer.
// Desktop app: uses a native folder picker. Browser (Chrome/Edge): File System Access API.
// Anything else: the file downloads instead.

const KEY = (pid) => `ion-disk-folder:${pid}`

export const isDesktopApp = () => !!(typeof window !== 'undefined' && window.desktop?.saveFile)
export const canPickFolder = () => isDesktopApp() || (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function')

// ---- browser: remember the chosen folder in IndexedDB ----
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('ion-disk', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('h')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
async function idbGet(k) {
  const db = await idb()
  return new Promise((res) => { const q = db.transaction('h').objectStore('h').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null) })
}
async function idbSet(k, v) {
  const db = await idb()
  return new Promise((res) => { const t = db.transaction('h', 'readwrite'); t.objectStore('h').put(v, k); t.oncomplete = () => res() })
}

// ---- where the project lives inside the chosen folder ----
// The chosen folder is a workspace. Each project gets its own folder inside it, so the project never mixes with
// other files of yours. If the editor's files already sit in one main folder, that folder is the project folder.
const layouts = {}
const slug = (t) => String(t || 'project').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'project'
export function noteLayout(pid, files, title) {
  const paths = Object.keys(files || {}).filter((p) => typeof files[p]?.content === 'string' && !/^ION_MEMORY\.md$/.test(p))
  let direct = false
  try { direct = localStorage.getItem(`ion-disk-direct:${pid}`) === '1' } catch {}
  if (direct) { layouts[pid] = { savePrefix: '', dirName: '', importPrefix: '' }; return layouts[pid] }
  const tops = new Set(paths.map((p) => (p.includes('/') ? p.split('/')[0] : null)))
  if (paths.length && !tops.has(null) && tops.size === 1) {
    const top = [...tops][0]
    layouts[pid] = { savePrefix: '', dirName: top, importPrefix: `${top}/` }
  } else {
    const name = slug(title)
    layouts[pid] = { savePrefix: `${name}/`, dirName: name, importPrefix: '' }
  }
  return layouts[pid]
}
export const layoutFor = (pid) => layouts[pid] || { savePrefix: '', dirName: '', importPrefix: '' }
export const setDirectFolder = (pid, on) => { try { on ? localStorage.setItem(`ion-disk-direct:${pid}`, '1') : localStorage.removeItem(`ion-disk-direct:${pid}`) } catch {} }
const joinPath = (a, b) => (b ? `${a}${/\\/.test(a) ? '\\' : '/'}${b}` : a)
/** Full path of the project folder on this computer (desktop). */
export async function projectFolderPath(pid) {
  const l = await linkedFolder(pid)
  if (!l?.path) return null
  return joinPath(l.path, layoutFor(pid).dirName)
}

const lastName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || String(p)

/** Name of the linked folder for this project, or null. */
export async function linkedFolder(pid) {
  try {
    if (isDesktopApp()) { const p = localStorage.getItem(KEY(pid)); return p ? { name: lastName(p), path: p } : null }
    const h = await idbGet(KEY(pid))
    return h ? { name: h.name } : null
  } catch { return null }
}

/** Opens the folder picker. Returns { name } or null if cancelled. Needs a click or key press. */
export async function chooseFolder(pid) {
  if (isDesktopApp()) {
    const p = await window.desktop.pickFolder()
    if (!p) return null
    localStorage.setItem(KEY(pid), p)
    return { name: lastName(p), path: p }
  }
  if (!canPickFolder()) return null
  try {
    const h = await window.showDirectoryPicker({ mode: 'readwrite' })
    await idbSet(KEY(pid), h)
    return { name: h.name }
  } catch { return null } // cancelled
}

async function dirFor(root, rel) {
  const parts = rel.split('/').filter(Boolean)
  const name = parts.pop()
  let dir = root
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
  return { dir, name }
}

function download(rel, content) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  a.download = rel.split('/').pop()
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/**
 * Writes one file. Returns { ok, where } where `where` says what happened:
 * 'folder' (saved in the linked folder), 'download' (browser fallback), or null on failure.
 */
export async function saveToDisk(pid, relIn, content, { askFolder = true } = {}) {
  if (typeof content !== 'string') return { ok: false, where: null }
  const rel = layoutFor(pid).savePrefix + relIn
  try {
    if (isDesktopApp()) {
      let link = await linkedFolder(pid)
      if (!link && askFolder) link = await chooseFolder(pid)
      if (!link) return { ok: false, where: null, cancelled: true }
      await window.desktop.saveFile(link.path, rel, content)
      return { ok: true, where: 'folder', folder: link.name }
    }
    if (canPickFolder()) {
      let h = await idbGet(KEY(pid))
      if (h) {
        let perm = await h.queryPermission?.({ mode: 'readwrite' })
        if (perm !== 'granted') perm = await h.requestPermission?.({ mode: 'readwrite' })
        if (perm !== 'granted') h = null
      }
      if (!h && askFolder) {
        const c = await chooseFolder(pid)
        h = c ? await idbGet(KEY(pid)) : null
      }
      if (!h) return { ok: false, where: null, cancelled: true }
      const { dir, name } = await dirFor(h, rel)
      const fh = await dir.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(content)
      await w.close()
      return { ok: true, where: 'folder', folder: h.name }
    }
    download(rel, content)
    return { ok: true, where: 'download' }
  } catch (e) {
    return { ok: false, where: null, error: String(e?.message || e) }
  }
}

/** Saves every text file in the project into the linked folder. */
export async function saveAllToDisk(pid, files) {
  let n = 0
  let folder = null
  for (const [path, f] of Object.entries(files || {})) {
    if (typeof f?.content !== 'string') continue
    const r = await saveToDisk(pid, path, f.content, { askFolder: n === 0 })
    if (!r.ok) { if (n === 0) return { ok: false, count: 0, cancelled: r.cancelled } ; continue }
    folder = r.folder
    n++
  }
  return { ok: n > 0, count: n, folder }
}

export async function showLinkedFolder(pid) {
  const l = await linkedFolder(pid)
  if (l?.path && window.desktop?.showFolder) window.desktop.showFolder(l.path)
}
