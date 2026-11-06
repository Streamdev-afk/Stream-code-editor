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

export function resolveOp(files, op) {
  const existing = files?.[op.path]
  const before = existing?.content ?? ''

  if (op.type === 'delete_file') return { before, after: '', errors: [] }

  if (op.type === 'edit_file') {
    if (!existing) return { before: '', after: '', errors: [`${op.path} does not exist.`] }
    const edits = Array.isArray(op.edits)
      ? op.edits
      : op.find != null ? [{ find: op.find, replace: op.replace }] : []
    const r = applyEdits(before, edits)
    return { before, after: r.content, errors: r.errors }
  }

  return { before, after: op.content ?? '', errors: [] }
}
