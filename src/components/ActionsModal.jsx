import Icon from './Icon'
import { useState, useEffect, useCallback, useRef } from 'react'
import { listUserRepos, listWorkflows, listRuns, listJobs, runWorkflow } from '../lib/github'

const dot = (r) => {
  if (r.status !== 'completed') return { c: '#f59e0b', t: r.status === 'queued' ? 'Queued' : 'Running' }
  if (r.conclusion === 'success') return { c: '#22c55e', t: 'Passed' }
  if (r.conclusion === 'cancelled') return { c: '#9ca3af', t: 'Cancelled' }
  return { c: '#ef4444', t: 'Failed' }
}
const ago = (iso) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso)) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export default function ActionsModal({ onClose, defaultRepo }) {
  const [repos, setRepos] = useState(null)
  const [repo, setRepo] = useState(defaultRepo || '')
  const [workflows, setWorkflows] = useState([])
  const [runs, setRuns] = useState([])
  const [open, setOpen] = useState(null) // run id
  const [jobs, setJobs] = useState({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const timer = useRef(null)

  useEffect(() => {
    listUserRepos().then((l) => {
      setRepos(l)
      if (!repo && l[0]) setRepo(l[0].fullName)
    }).catch((e) => { setError(e.message); setRepos([]) })
  }, [])

  const refresh = useCallback(async () => {
    if (!repo) return
    try {
      const [w, r] = await Promise.all([listWorkflows(repo), listRuns(repo)])
      setWorkflows(w.workflows)
      setRuns(r.runs)
      setError('')
    } catch (e) { setError(e.message) }
  }, [repo])

  useEffect(() => { setWorkflows([]); setRuns([]); setOpen(null); refresh() }, [refresh])

  // keep checking while something is still running
  useEffect(() => {
    clearInterval(timer.current)
    if (runs.some((r) => r.status !== 'completed')) {
      timer.current = setInterval(() => { refresh(); if (open) loadJobs(open) }, 6000)
    }
    return () => clearInterval(timer.current)
  }, [runs, open, refresh])

  const loadJobs = async (id) => {
    try { const d = await listJobs(repo, id); setJobs((j) => ({ ...j, [id]: d.jobs })) } catch {}
  }
  const toggle = (id) => { setOpen(open === id ? null : id); if (open !== id) loadJobs(id) }

  const run = async (w) => {
    setBusy(String(w.id)); setNote(''); setError('')
    try {
      const d = await runWorkflow(repo, w.id)
      setNote(`Started "${w.name}" on ${d.ref}. It can take a few seconds to show up below.`)
      setTimeout(refresh, 2500)
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal gh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon"><Icon name="play" size={14} /></span>
            <div>
              <div className="modal-title">GitHub Actions</div>
              <div className="modal-subtitle">Run workflows and watch your builds</div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><Icon name="close" size={16} strokeWidth={2.2} /></button>
        </div>

        <div className="gh-modal-body">
          <label className="gh-field">
            <span className="gh-field-label">Repository</span>
            <select className="gh-input" value={repo} onChange={(e) => setRepo(e.target.value)}>
              {repos === null && <option>Loading…</option>}
              {(repos || []).map((r) => <option key={r.fullName} value={r.fullName}>{r.fullName}</option>)}
            </select>
          </label>

          <div className="gh-field-label" style={{ marginTop: 6 }}>Workflows</div>
          <div className="act-list">
            {workflows.length === 0 ? <div className="gh-empty">No workflows found in this repo.</div> : workflows.map((w) => (
              <div key={w.id} className="act-row">
                <div className="act-main"><div className="gh-repo-name">{w.name}</div><div className="gh-repo-meta">{w.path}</div></div>
                <button className="act-run" disabled={!!busy} onClick={() => run(w)}>{busy === String(w.id) ? 'Starting…' : 'Run'}</button>
              </div>
            ))}
          </div>

          <div className="gh-field-label" style={{ marginTop: 10 }}>Recent runs</div>
          <div className="act-list">
            {runs.length === 0 ? <div className="gh-empty">No runs yet.</div> : runs.map((r) => {
              const d = dot(r)
              return (
                <div key={r.id} className="act-run-card">
                  <div className="act-row" onClick={() => toggle(r.id)} style={{ cursor: 'pointer' }}>
                    <span className="act-dot" style={{ background: d.c }} />
                    <div className="act-main">
                      <div className="gh-repo-name">{r.message || r.name}</div>
                      <div className="gh-repo-meta">{d.t} · #{r.number} · {r.branch} · {ago(r.createdAt)}</div>
                    </div>
                    <a href={r.url} target="_blank" rel="noreferrer" className="act-link" onClick={(e) => e.stopPropagation()}>Logs ↗</a>
                  </div>
                  {open === r.id && (
                    <div className="act-steps">
                      {!jobs[r.id] ? <div className="gh-empty">Loading steps…</div> : jobs[r.id].map((j) => (
                        <div key={j.id}>
                          <div className="act-job">{j.name}</div>
                          {j.steps.map((st, i) => {
                            const x = dot({ status: st.status, conclusion: st.conclusion })
                            return <div key={i} className="act-step"><span className="act-dot sm" style={{ background: x.c }} />{st.name}</div>
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {note && <div className="byok-ok">{note}</div>}
          {error && <div className="gh-error">⚠️ {error}</div>}
        </div>

        <div className="modal-footer">
          <span className="modal-hint">Needs a GitHub token with the "workflow" permission</span>
          <button className="btn-ghost" onClick={refresh}>Refresh</button>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
