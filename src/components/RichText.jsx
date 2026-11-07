import { useState } from 'react'

// Removes markdown markers so plain-text places (titles, summaries, history) never show **stars**
export function stripMd(s) {
  if (typeof s !== 'string') return s
  return s
    .replace(/```[a-z0-9]*\n?/gi, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|__/g, '')
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(__[^_\n]+?__)|(\[[^\]\n]+\]\(https:\/\/[^)\s]+\))|((?:^|(?<=[\s(]))\*(?!\s)[^*\n]+?\*(?=[\s).,!?:;]|$))/g

function inline(text, key) {
  const out = []
  let last = 0
  let m
  let n = 0
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    const k = `${key}-${n++}`
    if (m[1]) out.push(<code key={k} className="rt-code">{t.slice(1, -1)}</code>)
    else if (m[2] || m[3]) out.push(<strong key={k}>{t.slice(2, -2)}</strong>)
    else if (m[4]) {
      const mm = t.match(/^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/)
      out.push(<a key={k} href={mm[2]} target="_blank" rel="noopener noreferrer">{mm[1]}</a>)
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  // half-typed markers while the answer is still streaming
  return out.map((p) => (typeof p === 'string' ? p.replace(/\*\*|__/g, '') : p))
}

function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rt-pre">
      <div className="rt-pre-bar">
        <span>{lang || 'code'}</span>
        <button
          onClick={() => {
            try { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch {}
          }}
        >{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  )
}

/** Small, safe markdown renderer (no HTML injection) for the AI chat bubbles. */
export default function RichText({ text }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/)
    if (fence) {
      const code = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++])
      i++ // closing fence (may be missing while streaming)
      blocks.push(<CodeBlock key={blocks.length} code={code.join('\n')} lang={fence[1]} />)
      continue
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ''))
      blocks.push(<ul key={blocks.length} className="rt-list">{items.map((t, j) => <li key={j}>{inline(t, `l${j}`)}</li>)}</ul>)
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))
      blocks.push(<ol key={blocks.length} className="rt-list">{items.map((t, j) => <li key={j}>{inline(t, `o${j}`)}</li>)}</ol>)
      continue
    }
    const h = line.match(/^\s*#{1,6}\s+(.*)$/)
    if (h) { blocks.push(<div key={blocks.length} className="rt-h">{inline(h[1], 'h')}</div>); i++; continue }
    if (/^\s*>\s?/.test(line)) { blocks.push(<div key={blocks.length} className="rt-quote">{inline(line.replace(/^\s*>\s?/, ''), 'q')}</div>); i++; continue }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { i++; continue }
    if (!line.trim()) { i++; continue }
    const para = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^\s*(```|[-*•]\s|\d+[.)]\s|#{1,6}\s|>)/.test(lines[i])) para.push(lines[i++])
    blocks.push(<p key={blocks.length} className="rt-p">{para.map((t, j) => <span key={j}>{j > 0 && <br />}{inline(t, `p${j}`)}</span>)}</p>)
  }
  return <div className="rt">{blocks}</div>
}
