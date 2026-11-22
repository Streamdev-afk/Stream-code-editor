import { useMemo, useState } from 'react'

// A light symbol finder (no language server): functions, classes, methods, components, headings, selectors
function symbolsOf(code, path = '') {
  const out = []
  const ext = (path.split('.').pop() || '').toLowerCase()
  const lines = String(code || '').split('\n')
  const push = (i, name, kind, depth = 0) => out.push({ line: i + 1, name, kind, depth })
  lines.forEach((ln, i) => {
    let m
    if (ext === 'md' || ext === 'markdown') { if ((m = ln.match(/^(#{1,6})\s+(.+)/))) push(i, m[2].trim(), 'H', m[1].length - 1); return }
    if (ext === 'css' || ext === 'scss') { if ((m = ln.match(/^([.#@a-zA-Z][^{};]*)\{\s*$/))) push(i, m[1].trim(), '#'); return }
    if (ext === 'html' || ext === 'htm') { if ((m = ln.match(/<(h[1-3]|section|header|nav|main|footer|script|style)\b[^>]*?(?:id="([^"]+)")?[^>]*>/i))) push(i, m[2] ? `${m[1]}#${m[2]}` : m[1], '<>'); return }
    if (ext === 'py') {
      if ((m = ln.match(/^(\s*)class\s+(\w+)/))) push(i, m[2], 'C', m[1].length ? 1 : 0)
      else if ((m = ln.match(/^(\s*)(?:async\s+)?def\s+(\w+)/))) push(i, m[2], 'ƒ', m[1].length ? 1 : 0)
      return
    }
    if ((m = ln.match(/^\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)/))) return push(i, m[1], 'C')
    if ((m = ln.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+(\w+)/))) return push(i, m[1], 'ƒ')
    if ((m = ln.match(/^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|\w+\s*=>)/))) return push(i, m[1], 'ƒ')
    if ((m = ln.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Z_][A-Z0-9_]{2,})\s*=/))) return push(i, m[1], 'K')
    if ((m = ln.match(/^\s{2,}(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{\s*$/)) && !/^(if|for|while|switch|catch|function|return)$/.test(m[1])) return push(i, m[1], 'm', 1)
    if ((m = ln.match(/^\s*(?:interface|type|enum)\s+(\w+)/))) return push(i, m[1], 'T')
  })
  return out
}

export default function Outline({ code, path, onGoto }) {
  const [q, setQ] = useState('')
  const syms = useMemo(() => symbolsOf(code, path), [code, path])
  const shown = syms.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="outline-panel">
      <div className="panel-header">Outline{path ? ` · ${path.split('/').pop()}` : ''}</div>
      <input className="gh-input outline-search" placeholder="Filter symbols…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="outline-list">
        {!path && <div className="outline-empty">Open a file to see its structure.</div>}
        {path && shown.length === 0 && <div className="outline-empty">No functions, classes or headings found.</div>}
        {shown.map((s, i) => (
          <button key={i} className="outline-item" style={{ paddingLeft: 12 + s.depth * 14 }} onClick={() => onGoto(s.line)} title={`Line ${s.line}`}>
            <span className={`outline-kind k-${s.kind === 'ƒ' ? 'f' : s.kind === 'C' ? 'c' : 'o'}`}>{s.kind}</span>
            <span className="outline-name">{s.name}</span>
            <span className="outline-line">{s.line}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
