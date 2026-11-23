// Codebase index: finds the files most relevant to a request so the AI starts
// with the right code instead of exploring blindly. Pure client-side, no network.
const SKIP = /(^|\/)(node_modules|\.git|dist|build)\/|\.gitkeep$|\.lock$|\.log$|package-lock\.json$|\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|mp3|mp4|zip|pdf)$/i
const STOP = new Set(('the a an and or to of in on for with is are was be it this that these those i me my we you your do does did can could should would will '
  + 'please make add fix change update create remove delete use using want need how what why when where which from into so not no yes just also then there here '
  + 'file files code project app page button thing stuff some any all more less new old get set show give').split(' '))

const cache = new WeakMap()

export function tokenize(text) {
  const out = []
  for (const w of String(text || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 2 || STOP.has(w)) continue
    out.push(w)
    if (w.length > 3 && w.endsWith('s')) out.push(w.slice(0, -1))
  }
  return out
}

const SYM = [
  /(?:^|\s)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
  /(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  /(?:^|\s)(?:export\s+)?(?:abstract\s+)?(?:class|interface|enum|type)\s+([A-Za-z_$][\w$]*)/g,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm,
  /^\s*class\s+([A-Za-z_]\w*)/gm,
  /^\s*([.#][A-Za-z_][\w-]*)\s*[{,]/gm,
]

function symbolsOf(content) {
  const set = new Set()
  const src = content.length > 60000 ? content.slice(0, 60000) : content
  for (const re of SYM) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src)) && set.size < 60) set.add(m[1])
  }
  return [...set]
}

function build(files) {
  const docs = []
  const df = new Map()
  for (const [path, f] of Object.entries(files || {})) {
    if (SKIP.test(path)) continue
    const content = f?.content
    if (typeof content !== 'string' || !content || content.length > 200000) continue
    const tf = new Map()
    for (const t of tokenize(content.slice(0, 60000))) tf.set(t, (tf.get(t) || 0) + 1)
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1)
    const syms = symbolsOf(content)
    docs.push({ path, content, tf, syms, symTokens: new Set(syms.flatMap(tokenize)), pathTokens: new Set(tokenize(path)) })
  }
  return { docs, df, n: docs.length }
}

function getIndex(files) {
  let idx = cache.get(files)
  if (!idx) { idx = build(files); cache.set(files, idx) }
  return idx
}

function excerpt(content, terms, budget) {
  if (content.length <= budget) return content.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')
  const lines = content.split('\n')
  const hits = []
  lines.forEach((l, i) => {
    const low = l.toLowerCase()
    let s = 0
    for (const t of terms) if (low.includes(t)) s++
    if (s) hits.push([i, s])
  })
  hits.sort((a, b) => b[1] - a[1])
  const keep = new Set()
  let used = 0
  for (const [i] of hits) {
    if (used > budget) break
    for (let k = Math.max(0, i - 4); k <= Math.min(lines.length - 1, i + 6); k++) {
      if (!keep.has(k)) { keep.add(k); used += lines[k].length + 6 }
    }
  }
  if (!keep.size) for (let k = 0; k < Math.min(lines.length, 25); k++) keep.add(k)
  const sorted = [...keep].sort((a, b) => a - b)
  let out = '', prev = -2
  for (const k of sorted) {
    if (k !== prev + 1) out += '…\n'
    out += `${k + 1}: ${lines[k].slice(0, 200)}\n`
    prev = k
  }
  return out.slice(0, budget + 400)
}

/** Returns { picked: [paths], text } for the request, or null when nothing relevant. */
export function contextForQuery(files, prompt, activeFile) {
  const { docs, df, n } = getIndex(files)
  if (!n) return null
  const terms = [...new Set(tokenize(prompt))].slice(0, 24)
  const raw = String(prompt || '').toLowerCase()
  const scored = []
  for (const d of docs) {
    let s = 0
    const base = d.path.split('/').pop().toLowerCase()
    if (raw.includes(base) || raw.includes(d.path.toLowerCase())) s += 20
    for (const t of terms) {
      const idf = Math.log(1 + n / (df.get(t) || 1))
      if (d.pathTokens.has(t)) s += 6
      if (d.symTokens.has(t)) s += 5
      const c = d.tf.get(t)
      if (c) s += Math.min(4, 1 + Math.log(c)) * idf
    }
    if (activeFile && d.path === activeFile) s += 3
    if (s > 0) scored.push([s, d])
  }
  if (!scored.length) return null
  scored.sort((a, b) => b[0] - a[0])
  const top = scored.slice(0, 5).filter(([s], i) => i < 2 || s >= scored[0][0] * 0.25)
  const per = Math.floor(5600 / top.length)
  const parts = top.map(([, d]) => `=== ${d.path} (${d.content.split('\n').length} lines) ===\n${excerpt(d.content, terms, per)}`)
  const map = docs
    .filter((d) => d.syms.length)
    .sort((a, b) => b.syms.length - a.syms.length)
    .slice(0, 25)
    .map((d) => `${d.path}: ${d.syms.slice(0, 8).join(', ')}`)
    .join('\n')
    .slice(0, 2400)
  return { picked: top.map(([, d]) => d.path), text: parts.join('\n\n'), map }
}

/** Splits text into chunks that fit the server's per-observation cap. */
export function chunkText(text, size = 2800) {
  const out = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}
