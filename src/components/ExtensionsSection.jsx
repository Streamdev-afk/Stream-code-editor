import { useEffect, useState } from 'react'
import { getServers, addServer, refreshServer, removeServer, setEnabled } from '../lib/mcp'
import { STORE } from '../lib/extStore'

const initials = (n) => String(n || '?').trim().slice(0, 2).toUpperCase()

function Field({ label, hint, children }) {
  return (
    <label className="ext-field">
      <span className="ext-label">{label}</span>
      {children}
      {hint && <span className="ext-hint">{hint}</span>}
    </label>
  )
}

function AddForm({ initial, onDone, onBack }) {
  const [name, setName] = useState(initial?.name || '')
  const [url, setUrl] = useState(initial?.url || '')
  const [mode, setMode] = useState(initial?.headers?.length ? 'headers' : 'none')
  const [headers, setHeaders] = useState(initial?.headers?.length ? initial.headers : [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const setRow = (i, patch) => setHeaders((h) => h.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const submit = async () => {
    setErr(''); setBusy(true)
    try {
      await addServer({ name, url, headers: mode === 'headers' ? headers : [], storeId: initial?.storeId })
      onDone()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return (
    <div className="ext-form">
      <Field label="Name" hint="Shown in your extensions list.">
        <input className="ext-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. docs" maxLength={40} />
      </Field>
      <Field label="MCP server URL" hint="The https:// address where the server accepts MCP requests, for example https://mcp.example.com/mcp.">
        <input className="ext-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </Field>

      <div className="ext-section">Authentication</div>
      <div className="ext-radios">
        <button type="button" className={`ext-radio ${mode === 'none' ? 'on' : ''}`} onClick={() => setMode('none')}>
          <i /><span><b>No sign-in</b><em>For servers with open access.</em></span>
        </button>
        <button type="button" className={`ext-radio ${mode === 'headers' ? 'on' : ''}`} onClick={() => { setMode('headers'); if (!headers.length) setHeaders([{ k: 'Authorization', v: '' }]) }}>
          <i /><span><b>API key or token</b><em>Sent as request headers with every call.</em></span>
        </button>
        <div className="ext-radio off">
          <i /><span><b>Sign in with OAuth <u>Coming soon</u></b><em>Servers that need an OAuth sign-in are not supported yet.</em></span>
        </div>
      </div>

      {mode === 'headers' && (
        <>
          <div className="ext-section">Request headers</div>
          <div className="ext-hint">Sent with every request. They stay in this browser and are never shown again after you save. You can add up to four.</div>
          {headers.map((r, i) => (
            <div className="ext-hrow" key={i}>
              <input className="ext-input" placeholder="Header name" value={r.k} onChange={(e) => setRow(i, { k: e.target.value })} autoCapitalize="off" spellCheck={false} />
              <input className="ext-input" type="password" placeholder="Value" value={r.v} onChange={(e) => setRow(i, { v: e.target.value })} autoComplete="off" />
              <button type="button" className="ext-x" aria-label="Remove header" onClick={() => setHeaders((h) => h.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          {headers.length < 4 && <button type="button" className="ext-btn ghost" onClick={() => setHeaders((h) => [...h, { k: '', v: '' }])}>+ Add header</button>}
        </>
      )}

      <div className="ext-section">Advanced</div>
      <div className="ext-radios">
        <div className="ext-radio on static"><i /><span><b>Streamable HTTP</b><em>The current MCP transport. Used for every server here.</em></span></div>
        <div className="ext-radio off"><i /><span><b>SSE (legacy) <u>Not supported</u></b><em>An older transport that is being phased out.</em></span></div>
      </div>

      <div className="ext-warn">Only use extensions from developers you trust. A server decides which tools it offers and can change them at any time. The AI can only propose a tool call, and you approve each one.</div>
      {err && <div className="ext-err">{err}</div>}
      <div className="ext-actions">
        <button type="button" className="ext-btn primary" disabled={busy || !name.trim() || !url.trim()} onClick={submit}>{busy ? 'Connecting…' : 'Add'}</button>
        <button type="button" className="ext-btn" onClick={onBack}>Back</button>
      </div>
    </div>
  )
}

function StoreCard({ item, installed, onInstalled, onCustomize }) {
  const [open, setOpen] = useState(false)
  const [vals, setVals] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const needs = (item.fields || []).length > 0 || (item.inputs || []).length > 0
  const build = () => {
    let url = item.url
    if (item.template) {
      const o = String(vals.owner || '').trim(); const r = String(vals.repo || '').trim()
      if (!/^[\w.-]+$/.test(o) || !/^[\w.-]+$/.test(r)) throw new Error('Enter the owner and the repository name')
      url = item.template.replace('{owner}', o).replace('{repo}', r)
    }
    const headers = (item.fields || []).map((f, i) => ({ k: f.header, v: vals[`f${i}`] ? `${f.prefix || ''}${String(vals[`f${i}`]).trim()}` : '' })).filter((h) => h.v)
    const name = item.template ? `${item.name} ${vals.owner}/${vals.repo}`.slice(0, 40) : item.name
    return { name, url, headers, storeId: item.id }
  }
  const install = async () => {
    setErr('')
    if (needs && !open) { setOpen(true); return }
    setBusy(true)
    try { await addServer(build()); setOpen(false); onInstalled() } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return (
    <div className="ext-card">
      <div className="ext-card-top">
        <span className="ext-logo" style={{ background: item.color }}>{initials(item.name)}</span>
        <div className="ext-card-text"><b>{item.name}</b><span className="ext-tag">{item.tag}</span></div>
        {installed && !item.template ? <span className="ext-done">Added</span>
          : <button className="ext-btn primary sm" disabled={busy} onClick={install}>{busy ? '…' : open ? 'Add' : 'Install'}</button>}
      </div>
      <p>{item.desc}</p>
      {open && (
        <div className="ext-mini">
          {(item.inputs || []).map((f) => (
            <input key={f.key} className="ext-input" placeholder={f.label} value={vals[f.key] || ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} autoCapitalize="off" spellCheck={false} />
          ))}
          {(item.fields || []).map((f, i) => (
            <input key={i} className="ext-input" type="password" placeholder={f.label} value={vals[`f${i}`] || ''} onChange={(e) => setVals({ ...vals, [`f${i}`]: e.target.value })} autoComplete="off" />
          ))}
          <button className="ext-link" onClick={() => onCustomize(build)}>Edit details</button>
        </div>
      )}
      {err && <div className="ext-err">{err}</div>}
    </div>
  )
}

export default function ExtensionsSection() {
  const [tab, setTab] = useState('store')
  const [list, setList] = useState(getServers())
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [form, setForm] = useState(null) // null | {} | initial values
  useEffect(() => {
    const h = () => setList(getServers())
    window.addEventListener('qoders-mcp-changed', h)
    return () => window.removeEventListener('qoders-mcp-changed', h)
  }, [])
  const refresh = async (n) => { setErr(''); setBusy(n); try { await refreshServer(n) } catch (e) { setErr(`${n}: ${e.message}`) } setBusy('') }
  const have = new Set(list.map((s) => s.storeId).filter(Boolean))

  if (form) return <AddForm initial={form} onDone={() => { setForm(null); setTab('installed') }} onBack={() => setForm(null)} />

  return (
    <div className="ext">
      <div className="ext-tabs">
        <button className={tab === 'store' ? 'on' : ''} onClick={() => setTab('store')}>Store</button>
        <button className={tab === 'installed' ? 'on' : ''} onClick={() => setTab('installed')}>Installed{list.length ? ` (${list.length})` : ''}</button>
        <button className="ext-add" onClick={() => setForm({})}>+ Custom</button>
      </div>

      {tab === 'store' && (
        <>
          <div className="ext-hint">Add tools the AI can use. It proposes a call and you approve each one. Some servers need a free key from their provider.</div>
          <div className="ext-grid">
            {STORE.map((it) => (
              <StoreCard key={it.id} item={it} installed={have.has(it.id)} onInstalled={() => setTab('installed')} onCustomize={(b) => { try { setForm(b()) } catch { setForm({ name: it.name, url: it.url || '' }) } }} />
            ))}
          </div>
        </>
      )}

      {tab === 'installed' && (
        <>
          {list.length === 0 && <div className="ext-empty">Nothing added yet. Pick one from the Store or add your own server.</div>}
          {list.map((s) => (
            <div className="ext-item" key={s.name}>
              <div className="ext-card-top">
                <span className="ext-logo" style={{ background: (STORE.find((x) => x.id === s.storeId) || {}).color || '#667' }}>{initials(s.name)}</span>
                <div className="ext-card-text"><b>{s.name}</b><span className="ext-tag">{(s.tools || []).length} tools</span></div>
                <label className="ext-switch"><input type="checkbox" checked={s.enabled !== false} onChange={(e) => setEnabled(s.name, e.target.checked)} /><i /></label>
              </div>
              <div className="ext-tools">{(s.tools || []).length ? s.tools.map((t) => t.name).join(' · ') : 'No tools found'}</div>
              <div className="ext-actions">
                <button className="ext-btn sm" disabled={busy === s.name} onClick={() => refresh(s.name)}>{busy === s.name ? 'Checking…' : 'Refresh tools'}</button>
                <button className="ext-btn sm danger" onClick={() => removeServer(s.name)}>Remove</button>
              </div>
            </div>
          ))}
          {err && <div className="ext-err">{err}</div>}
        </>
      )}
    </div>
  )
}
