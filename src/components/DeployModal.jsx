import { useState } from 'react'

const sKey = (id) => `qoders-secrets-${id}`
const load = (id) => { try { return JSON.parse(localStorage.getItem(sKey(id)) || '[]') } catch { return [] } }

export default function DeployModal({ sessionId, onClose, onPush }) {
  const [tab, setTab] = useState('deploy')
  const [rows, setRows] = useState(() => load(sessionId))
  const [k, setK] = useState(''); const [v, setV] = useState('')
  const [copied, setCopied] = useState(false)
  const repo = (() => { try { return localStorage.getItem('qoders-lastrepo') || '' } catch { return '' } })()
  const url = repo ? `https://github.com/${repo}` : ''
  const save = (next) => { setRows(next); try { localStorage.setItem(sKey(sessionId), JSON.stringify(next)) } catch { /* ignore */ } }
  const add = () => { const key = k.trim().replace(/\s+/g, '_').toUpperCase(); if (!key) return; save([...rows.filter((r) => r.k !== key), { k: key, v }]); setK(''); setV('') }
  const hosts = [
    { name: 'Vercel', note: 'Best for React, Vite and static sites', href: `https://vercel.com/new/clone?repository-url=${encodeURIComponent(url)}` },
    { name: 'Netlify', note: 'Simple static hosting and forms', href: `https://app.netlify.com/start/deploy?repository=${encodeURIComponent(url)}` },
    { name: 'Cloudflare Pages', note: 'Fast and generous free plan', href: 'https://dash.cloudflare.com/?to=/:account/pages/new/provider/github' },
    { name: 'Render', note: 'For apps with a server (Node, Python)', href: `https://dashboard.render.com/select-repo?type=web` },
  ]
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal gh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><div className="modal-title-group"><div className="modal-title">Deploy</div><div className="modal-subtitle">Put this project online</div></div><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="gh-modal-body">
          <div className="gh-seg">
            <button className={tab === 'deploy' ? 'active' : ''} onClick={() => setTab('deploy')}>Deploy</button>
            <button className={tab === 'secrets' ? 'active' : ''} onClick={() => setTab('secrets')}>Secrets</button>
          </div>
          {tab === 'deploy' && (url ? (
            <>
              <div className="sc-note">Your code is on GitHub at <b>{repo}</b>. Pick a host: it opens with this repo ready to import. Push first if you changed anything.</div>
              {hosts.map((h) => (
                <a key={h.name} className="deploy-host" href={h.href} target="_blank" rel="noreferrer"><strong>{h.name}</strong><span>{h.note}</span></a>
              ))}
              <button className="gh-btn" onClick={onPush}>Push latest changes first</button>
            </>
          ) : (
            <>
              <div className="sc-note">Hosts deploy from GitHub, so push this project there first. After that, this window gives you one-click links to Vercel, Netlify and more.</div>
              <button className="gh-btn gh-btn-primary" onClick={onPush}>Push to GitHub</button>
            </>
          ))}
          {tab === 'secrets' && (
            <>
              <div className="sc-note">API keys and passwords your project needs. They stay in this browser only: they are never pushed to GitHub or sent to the AI. Copy them into your host's environment variables settings.</div>
              {rows.map((r) => (
                <div className="secret-row" key={r.k}><code>{r.k}</code><span>{'•'.repeat(Math.min(12, (r.v || '').length || 6))}</span><button onClick={() => save(rows.filter((x) => x.k !== r.k))} title="Remove">×</button></div>
              ))}
              <div className="secret-add">
                <input className="gh-input" placeholder="NAME (e.g. OPENAI_API_KEY)" value={k} onChange={(e) => setK(e.target.value)} />
                <input className="gh-input" placeholder="value" type="password" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
                <button className="gh-btn gh-btn-primary" onClick={add}>Add</button>
              </div>
              {rows.length > 0 && <button className="gh-btn" onClick={() => { try { navigator.clipboard.writeText(rows.map((r) => `${r.k}=${r.v}`).join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ } }}>{copied ? 'Copied ✓' : 'Copy all as .env text'}</button>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
