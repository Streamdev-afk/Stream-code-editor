import { useMemo } from 'react'
import { diffFiles } from '../lib/baseline'

const LABEL = { M: 'Modified', A: 'New', D: 'Deleted' }
export default function SourceControl({ sessionId, files, onOpen, onPush, onReview }) {
  const changes = useMemo(() => diffFiles(sessionId, files), [sessionId, files])
  const repo = (() => { try { return localStorage.getItem('qoders-lastrepo') || '' } catch { return '' } })()
  return (
    <div className="sc-panel">
      <div className="panel-header">Source control{changes.length ? ` · ${changes.length}` : ''}</div>
      <div className="sc-note">{repo ? `Last pushed to ${repo}` : 'Not pushed to GitHub yet'}. Showing what changed since then.</div>
      <div className="sc-list">
        {changes.length === 0 && <div className="outline-empty">No changes. Everything matches the last push.</div>}
        {changes.map((c) => (
          <button key={c.path} className="sc-item" onClick={() => c.status !== 'D' && onOpen(c.path)} title={LABEL[c.status]}>
            <span className={`git-badge g-${c.status}`}>{c.status}</span>
            <span className="sc-path">{c.path}</span>
          </button>
        ))}
      </div>
      <div className="sc-foot">{onReview && changes.length > 0 && <button className="gh-btn" style={{ marginBottom: 8 }} onClick={onReview}>✦ Review changes with AI</button>}<button className="gh-btn gh-btn-primary" onClick={onPush}>{changes.length ? `Commit & push ${changes.length} change${changes.length === 1 ? '' : 's'}` : 'Push to GitHub'}</button></div>
    </div>
  )
}
