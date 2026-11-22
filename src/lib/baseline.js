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

export const getBaseline = (id) => mem.get(id) || null

// a short, readable summary of what changed (added / removed lines), for the AI review
export function changeSummary(id, files, maxChars = 7000) {
  const base = mem.get(id) || {}
  let out = ''
  for (const c of diffFiles(id, files)) {
    if (out.length > maxChars) { out += '\n(more files not shown)'; break }
    const now = (files[c.path]?.content ?? '').split('\n')
    const was = (base[c.path] ?? '').split('\n')
    const wasSet = new Set(was); const nowSet = new Set(now)
    const added = now.filter((l) => l.trim() && !wasSet.has(l)).slice(0, 40)
    const removed = was.filter((l) => l.trim() && !nowSet.has(l)).slice(0, 15)
    out += `\n### ${c.status === 'A' ? 'NEW' : c.status === 'D' ? 'DELETED' : 'CHANGED'}: ${c.path}\n`
    if (c.status === 'D') continue
    out += added.map((l) => '+ ' + l.slice(0, 160)).join('\n') + (removed.length ? '\n' + removed.map((l) => '- ' + l.slice(0, 160)).join('\n') : '') + '\n'
  }
  return out.trim()
}
