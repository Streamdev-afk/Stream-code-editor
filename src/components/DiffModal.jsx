import { useMemo } from 'react'

function diffLines(a, b) {
  const A = a.split('\n')
  const B = b.split('\n')
  const max = Math.max(A.length, B.length)
  const rows = []
  for (let i = 0; i < max; i++) {
    const left = A[i]
    const right = B[i]
    if (left === right) rows.push({ type: 'same', text: left ?? '' })
    else {
      if (left !== undefined) rows.push({ type: 'removed', text: left })
      if (right !== undefined) rows.push({ type: 'added', text: right })
    }
  }
  return rows
}

export default function DiffModal({ original, next, onAccept, onReject, label }) {
  const rows = useMemo(() => diffLines(original, next), [original, next])

  const additions = rows.filter((r) => r.type === 'added').length
  const removals = rows.filter((r) => r.type === 'removed').length

  return (
    <div className="modal-backdrop" onClick={onReject}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">◆</span>
            <div>
              <div className="modal-title">Stream suggestion</div>
              <div className="modal-subtitle">{label || 'Edit'}</div>
            </div>
          </div>
          <button className="modal-close" onClick={onReject}>✕</button>
        </div>

        <div className="diff-stats">
          <span className="diff-stat diff-stat-add">
            <span className="diff-stat-icon">+</span>{additions} addition{additions === 1 ? '' : 's'}
          </span>
          <span className="diff-stat diff-stat-remove">
            <span className="diff-stat-icon">−</span>{removals} removal{removals === 1 ? '' : 's'}
          </span>
        </div>

        <div className="modal-body">
          <pre className="diff-view">
            {rows.map((r, i) => (
              <div key={i} className={`diff-line ${r.type}`}>
                <span className="diff-marker">
                  {r.type === 'added' ? '+' : r.type === 'removed' ? '-' : ' '}
                </span>
                <span className="diff-text">{r.text || ' '}</span>
              </div>
            ))}
          </pre>
        </div>

        <div className="modal-footer">
          <span className="modal-hint">Review the changes before accepting</span>
          <button className="btn-ghost" onClick={onReject}>Reject</button>
          <button className="btn-accept" onClick={onAccept}>
            <span className="btn-check">✓</span> Accept
          </button>
        </div>
      </div>
    </div>
  )
}