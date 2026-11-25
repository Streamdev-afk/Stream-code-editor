// Applies the file operations the AI proposes.
//
//   create_file / write_file : full content (new files, or when most of a file changes)
//   delete_file              : remove
//   edit_file                : small exact find -> replace edits, so the AI never has to
//                              rewrite a whole file just to change a few lines
//
// resolveOp() tells you what a file would look like after an operation (used by the diff
// screen), and any problems (text that could not be found) so they are shown, not hidden.

const clip = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 60)

export function applyEdits(content, edits) {
  let out = String(content ?? '').replace(/\r/g, '')
  const errors = []

  for (const e of Array.isArray(edits) ? edits : []) {
    const find = String(e?.find ?? '').replace(/\r/g, '')
    const replace = String(e?.replace ?? '')
    if (!find.trim()) { errors.push('An edit had an empty "find" text.'); continue }

    // 1) exact match, must be unique
    const first = out.indexOf(find)
    if (first !== -1) {
      if (out.indexOf(find, first + 1) !== -1) {
        errors.push(`"${clip(find)}" appears more than once, so it was not changed.`)
        continue
      }
      out = out.slice(0, first) + replace + out.slice(first + find.length)
      continue
    }

    // 2) same lines, ignoring indentation and trailing spaces
    const wanted = find.split('\n').map((l) => l.trim())
    const lines = out.split('\n')
    const hits = []
    for (let i = 0; i + wanted.length <= lines.length; i++) {
      let all = true
      for (let j = 0; j < wanted.length; j++) {
        if (lines[i + j].trim() !== wanted[j]) { all = false; break }
      }
      if (all) hits.push(i)
    }
    if (hits.length === 1) {
      const i = hits[0]
      // re-use the file's own indentation for replacement lines that came without any
      const indents = wanted.map((_, j) => lines[i + j].match(/^\s*/)[0])
      const repLines = replace.split('\n').map((l, k) =>
        !l || /^\s/.test(l) ? l : indents[Math.min(k, indents.length - 1)] + l
      )
      lines.splice(i, wanted.length, ...repLines)
      out = lines.join('\n')
      continue
    }
    errors.push(
      hits.length > 1
        ? `"${clip(find)}" matches several places, so it was not changed.`
        : `Could not find "${clip(find)}" in the file.`
    )
  }
  return { content: out, errors }
}

// A model sometimes sends code with the two characters \ and n instead of real line breaks. Put the line breaks back.
export const fixFlat = (t) => {
  if (typeof t !== 'string' || !/\\n/.test(t)) return t
  const un = (x) => x.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, '\t')
  if (!t.includes('\n')) return un(t).replace(/\\"/g, '"')
  // mixed: a very long line that holds several escaped line breaks between statements is flattened code
  return t.split('\n').map((l) => (l.length > 200 && (l.match(/\\n/g) || []).length >= 3 && /[;{}>)]\\n/.test(l) ? un(l) : l)).join('\n')
}

export function resolveOp(files, op) {
  const existing = files?.[op.path]
  const before = existing?.content ?? ''

  if (op.type === 'delete_file') return { before, after: '', errors: [] }
  if (op.type === 'rename_file') return { before, after: before, errors: existing && op.newPath ? [] : [`${op.path} does not exist or no new name was given.`] }

  if (op.type === 'edit_file') {
    if (!existing) return { before: '', after: '', errors: [`${op.path} does not exist.`] }
    const edits = Array.isArray(op.edits)
      ? op.edits
      : op.find != null ? [{ find: op.find, replace: op.replace }] : []
    const fixed = edits.map((e) => {
      const f = typeof e?.find === 'string' && !before.includes(e.find) && before.includes(fixFlat(e.find)) ? fixFlat(e.find) : e?.find
      return { ...e, find: f, replace: before.includes('\n') ? fixFlat(e?.replace) : e?.replace }
    })
    const r = applyEdits(before, fixed)
    return { before, after: r.content, errors: r.errors }
  }

  return { before, after: fixFlat(op.content ?? ''), errors: [] }
}

// The AI sometimes writes "my-app/src/App.jsx" or "./src/app.jsx" when the project already has "src/App.jsx".
// Point such paths at the files that already exist so they are rewritten, not duplicated into a new folder.
export function remapOps(files, ops) {
  if (!files || !Array.isArray(ops)) return ops
  const paths = Object.keys(files)
  if (!paths.length) return ops
  const lower = new Map(paths.map((p) => [p.toLowerCase(), p]))
  const tops = new Set(paths.filter((p) => p.includes('/')).map((p) => p.split('/')[0]))
  const clean = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '')
  const fix = (p) => {
    const c = clean(p)
    if (files[c]) return c
    if (lower.has(c.toLowerCase())) return lower.get(c.toLowerCase())
    const parts = c.split('/')
    for (let i = 1; i < parts.length && i <= 2; i++) {
      const rest = parts.slice(i).join('/')
      if (!tops.has(parts[0]) && (files[rest] || lower.has(rest.toLowerCase()))) return files[rest] ? rest : lower.get(rest.toLowerCase())
    }
    return c
  }
  // one wrapper folder around everything (e.g. "my-app/..."): drop it when the project has no such folder
  const cl = ops.map((o) => (o && typeof o.path === 'string' ? clean(o.path) : ''))
  const wrap = cl[0] ? cl[0].split('/')[0] : ''
  const wrapped = wrap && !tops.has(wrap) && !files[wrap] && cl.every((p) => !p || (p.includes('/') && p.split('/')[0] === wrap))
  let work = ops
  if (wrapped) {
    const inner = cl.map((p) => p.split('/').slice(1).join('/'))
    if (inner.some((p) => files[p] || lower.has(p.toLowerCase())) || paths.some((p) => !p.includes('/') || ['src', 'public'].includes(p.split('/')[0]))) {
      work = ops.map((o, i) => (cl[i] ? { ...o, path: inner[i] } : o))
    }
  }
  return work.map((op) => (op && typeof op.path === 'string' && op.path ? { ...op, path: fix(op.path) } : op))
}
