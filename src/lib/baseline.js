// "What changed since the last push": a copy of the files as they were when the project opened or was last pushed
const mem = new Map() // sessionId -> { path: content }
const K = (id) => `qoders-base-${id}`
const snap = (files) => Object.fromEntries(Object.entries(files || {}).map(([p, f]) => [p, f?.content ?? '']))
export function ensureBaseline(id, files) {
  if (!id || mem.has(id)) return
  let b = null
  try { b = JSON.parse(localStorage.getItem(K(id)) || 'null') } catch { /* ignore */ }
  mem.set(id, b || snap(files))
}
export function resetBaseline(id, files) {
  const b = snap(files)
  mem.set(id, b)
  try { const t = JSON.stringify(b); if (t.length < 1_500_000) localStorage.setItem(K(id), t); else localStorage.removeItem(K(id)) } catch { /* ignore */ }
}
export function diffFiles(id, files) {
  const base = mem.get(id)
  if (!base) return []
  const out = []
  for (const [p, f] of Object.entries(files || {})) {
    if (!(p in base)) out.push({ path: p, status: 'A' })
    else if (base[p] !== (f?.content ?? '')) out.push({ path: p, status: 'M' })
  }
  for (const p of Object.keys(base)) if (!(p in (files || {}))) out.push({ path: p, status: 'D' })
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
