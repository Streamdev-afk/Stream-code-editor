import { useState, useMemo } from 'react'

function simpleDiff(a = '', b = '') {
  const A = a.split('\n')
  const B = b.split('\n')
  const max = Math.max(A.length, B.length)
  const rows = []
  for (let i = 0; i < max; i++) {
    const l = A[i], r = B[i]
    if (l === r) rows.push({ type: 'same', text: l ?? '' })
    else {
      if (l !== undefined) rows.push({ type: 'removed', text: l })
      if (r !== undefined) rows.push({ type: 'added', text: r })
    }
  }
  return rows
}

const OP_LABEL = {
  create_file: 'new file',
  write_file: 'modify',
  delete_file: 'delete',
}

export default function AgentModal({ plan, files, onAccept, onReject, originalPrompt }) {
  const ops = plan.operations || []
  const [expanded, setExpanded] = useState(0)
  const [selected, setSelected] = useState(() => new Set(ops.map((_, i) => i)))

  const diffs = useMemo(
    () => ops.map((op) => {
      const before = files[op.path]?.content ?? ''
      const after = op.type === 'delete_file' ? '' : (op.content ?? '')
      return simpleDiff(before, after)
    }),
    [ops, files]
  )

  const toggle = (i) => {
    setSelected((s) => {
      const next = new Set(s)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === ops.length) setSelected(new Set())
    else setSelected(new Set(ops.map((_, i) => i)))
  }

  const accept = () => {
  const chosen = ops.filter((_, i) => selected.has(i))
  onAccept(chosen, plan.explanation, originalPrompt)
}

  const allSelected = selected.size === ops.length && ops.length > 0

  return (
    <div className="modal-backdrop">
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">◆</span>
            <div>
              <div className="modal-title">
                Stream wants to make {ops.length} change{ops.length === 1 ? '' : 's'}
              </div>
              {plan.explanation && (
  <div className="modal-subtitle">{plan.explanation}</div>
)}
            </div>
          </div>
          <button className="modal-close" onClick={onReject}>✕</button>
        </div>
         
         {Array.isArray(plan.plan) && plan.plan.length > 0 && (
  <div className="agent-plan">
    {plan.plan.map((step, i) => (
      <div key={i} className="agent-plan-step">
        <span className="agent-plan-num">{i + 1}</span>
        <span>{step}</span>
      </div>
    ))}
  </div>
)}

        <div className="agent-layout">
          <div className="agent-files">
            <div className="agent-files-header">
              <label className="agent-select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                />
                <span>Select all</span>
              </label>
              <span className="agent-count">
                {selected.size}/{ops.length}
              </span>
            </div>
            <div className="agent-files-list">
              {ops.map((op, i) => (
                <div
                  key={i}
                  className={`agent-file ${expanded === i ? 'expanded' : ''}`}
                  onClick={() => setExpanded(i)}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggle(i)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="agent-file-info">
                    <div className="agent-file-path">{op.path}</div>
                    <div className={`agent-file-op op-${op.type}`}>
                      {OP_LABEL[op.type] || op.type}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="agent-diff">
            {ops[expanded] ? (
              <>
                <div className="agent-diff-header">
                  <span className="agent-diff-path">{ops[expanded].path}</span>
                  <span className={`agent-diff-op op-${ops[expanded].type}`}>
                    {OP_LABEL[ops[expanded].type]}
                  </span>
                </div>
                <pre className="diff-view">
                  {diffs[expanded].map((r, i) => (
                    <div key={i} className={`diff-line ${r.type}`}>
                      <span className="diff-marker">
                        {r.type === 'added' ? '+' : r.type === 'removed' ? '-' : ' '}
                      </span>
                      <span className="diff-text">{r.text || ' '}</span>
                    </div>
                  ))}
                </pre>
              </>
            ) : (
              <div className="agent-diff-empty">No change selected</div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <span className="modal-hint">
            {selected.size} of {ops.length} selected
          </span>
          <button className="btn-ghost" onClick={onReject}>Reject all</button>
          <button
            className="btn-accept"
            onClick={accept}
            disabled={selected.size === 0}
          >
            <span className="btn-check">✓</span> Accept {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}