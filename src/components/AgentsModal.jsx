import { useEffect, useState } from 'react'
import { subscribe, startAgent, dismissAgent } from '../lib/agents'

const ago = (t) => { const s = Math.max(1, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : `${Math.round(s / 60)}m` }

export default function AgentsModal({ onClose, getContext, onReview }) {
  const [rows, setRows] = useState([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [, tick] = useState(0)
  useEffect(() => subscribe(setRows), [])
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t) }, [])
  const run = () => {
    setErr('')
    try { startAgent({ prompt: text, ...getContext() }); setText('') } catch (e) { setErr(e.message) }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal gh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><div className="modal-title-group"><div className="modal-title">Background agents</div><div className="modal-subtitle">They work while you keep coding. You review before anything changes.</div></div><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="gh-modal-body">
          <textarea className="agent-input" rows={3} value={text} placeholder="What should an agent do? e.g. add form validation to the signup page" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run() }} />
          <button className="gh-btn" onClick={run} disabled={!text.trim()}>Start agent (Ctrl+Enter)</button>
          {err && <div className="sc-note agent-err">{err}</div>}
          {rows.length === 0 && <div className="sc-note">No agents yet. Each one uses your normal AI credits, like a chat message.</div>}
          {rows.map((a) => (
            <div key={a.id} className={`agent-row agent-${a.status}`}>
              <div className="agent-top"><span className="agent-dot" /><strong>{a.prompt.length > 90 ? `${a.prompt.slice(0, 90)}…` : a.prompt}</strong></div>
              <div className="agent-sub">
                {a.status === 'running' && <>{a.hint} · {ago(a.startedAt)}</>}
                {a.status === 'done' && (a.plan?.operations?.length ? `${a.plan.operations.length} proposed change${a.plan.operations.length === 1 ? '' : 's'}` : (a.plan?.explanation || 'Finished: nothing to change').slice(0, 160))}
                {a.status === 'error' && `Stopped: ${a.error}`}
              </div>
              <div className="agent-btns">
                {a.status === 'done' && a.plan?.operations?.length > 0 && <button className="action-btn" onClick={() => { onReview(a.plan, a.prompt); dismissAgent(a.id); onClose() }}>Review changes</button>}
                <button className="action-btn ghost" onClick={() => dismissAgent(a.id)}>{a.status === 'running' ? 'Discard' : 'Dismiss'}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
