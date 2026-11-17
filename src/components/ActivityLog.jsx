import { useState } from 'react'
import Icon from './Icon'

const ICONS = { created: 'filePlus', edited: 'edit', rewrote: 'edit', deleted: 'trash', terminal: 'command', plan: 'compass', preview: 'play', check: 'check', warn: 'warn', github: 'github', search: 'search' }
const WORDS = {
  created: ['Created a file', 'Created {n} files'],
  edited: ['Edited a file', 'Edited {n} files'],
  rewrote: ['Rewrote a file', 'Rewrote {n} files'],
  deleted: ['Deleted a file', 'Deleted {n} files'],
  terminal: ['Ran a command', 'Ran {n} commands'],
  plan: ['Made a plan', 'Made {n} plans'],
  preview: ['Opened the preview', 'Opened the preview'],
  check: ['Checked the project', 'Checked the project'],
  warn: ['Hit a problem', 'Hit {n} problems'],
  github: ['Opened GitHub', 'Opened GitHub'],
  search: ['Searched the web', 'Searched the web'],
}

export function summarize(items) {
  const counts = new Map()
  for (const it of items) counts.set(it.kind, (counts.get(it.kind) || 0) + 1)
  const parts = [...counts.entries()].map(([k, n]) => (WORDS[k] || ['Did something', 'Did {n} things'])[n > 1 ? 1 : 0].replace('{n}', n))
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(', ')
}

/** "Created 2 files, ran a command >" — expands to show everything the AI did. */
export default function ActivityLog({ items }) {
  const [open, setOpen] = useState(false)
  const [row, setRow] = useState(null)
  if (!Array.isArray(items) || !items.length) return null
  return (
    <div className={`act-log ${open ? 'open' : ''}`}>
      <button className="act-sum" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{summarize(items)}</span>
        <Icon name="chevronRight" size={14} className="act-chev" />
      </button>
      {open && (
        <div className="act-rows">
          {items.map((it, i) => (
            <div key={i} className={`act-item ${it.detail ? 'has' : ''}`} style={{ animationDelay: `${i * 30}ms` }}>
              <button className="act-item-row" onClick={() => it.detail && setRow(row === i ? null : i)} disabled={!it.detail}>
                <span className={`act-ico k-${it.kind}`}><Icon name={ICONS[it.kind] || 'dot'} size={13} /></span>
                <span className="act-title">{it.title}</span>
                {it.note && <span className="act-note">{it.note}</span>}
                {it.detail && <Icon name="chevronDown" size={13} className={`act-more ${row === i ? 'on' : ''}`} />}
              </button>
              {row === i && it.detail && <pre className="act-detail">{it.detail}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
