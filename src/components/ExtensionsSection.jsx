import { useEffect, useState } from 'react'
import { getServers, addServer, refreshServer, removeServer, setEnabled } from '../lib/mcp'

export default function ExtensionsSection() {
  const [list, setList] = useState(getServers())
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [auth, setAuth] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    const h = () => setList(getServers())
    window.addEventListener('qoders-mcp-changed', h)
    return () => window.removeEventListener('qoders-mcp-changed', h)
  }, [])
  const add = async () => {
    setErr(''); setBusy('add')
    try { await addServer({ name, url, auth }); setName(''); setUrl(''); setAuth('') } catch (e) { setErr(e.message) }
    setBusy('')
  }
  const refresh = async (n) => { setErr(''); setBusy(n); try { await refreshServer(n) } catch (e) { setErr(`${n}: ${e.message}`) } setBusy('') }
  return (
    <div className="byok">
      <div className="byok-note">Extensions let the AI use tools from MCP servers (for example docs search, databases, issue trackers). The AI can only propose a tool call: you approve each one. Server addresses must start with https://. Your token stays in this browser and is sent only to run a call.</div>
      {list.map((s) => (
        <div className="mcp-row" key={s.name}>
          <div className="mcp-row-top">
            <strong>{s.name}</strong>
            <span>
              <label><input type="checkbox" checked={s.enabled !== false} onChange={(e) => setEnabled(s.name, e.target.checked)} /> On</label>{' '}
              <button className="action-btn ghost" disabled={busy === s.name} onClick={() => refresh(s.name)}>{busy === s.name ? '…' : 'Refresh'}</button>{' '}
              <button className="action-btn ghost" onClick={() => removeServer(s.name)}>Remove</button>
            </span>
          </div>
          <div className="mcp-tools">{(s.tools || []).length ? `${s.tools.length} tools: ${s.tools.map((t) => t.name).join(', ')}` : 'No tools found'}</div>
        </div>
      ))}
      <div className="mcp-form">
        <input className="byok-input" placeholder="Name (e.g. docs)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="byok-input" placeholder="https://example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input className="byok-input" type="password" placeholder="Token (optional)" value={auth} onChange={(e) => setAuth(e.target.value)} autoComplete="off" />
        <button className="gh-btn" disabled={busy === 'add' || !name.trim() || !url.trim()} onClick={add}>{busy === 'add' ? 'Connecting…' : 'Connect extension'}</button>
        {err && <div className="sc-note agent-err">{err}</div>}
      </div>
    </div>
  )
}
