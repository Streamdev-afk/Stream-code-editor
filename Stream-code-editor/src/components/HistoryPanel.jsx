export default function HistoryPanel({ history, onRestore, onClear }) {
  if (history.length === 0) {
    return (
      <div className="history-panel">
        <div className="history-empty">
          <div className="history-empty-icon">🕐</div>
          <div className="history-empty-title">No history yet</div>
          <div className="history-empty-hint">
            AI changes and file saves will appear here. Click any entry to restore.
          </div>
        </div>
      </div>
    )
  }

  // Show newest first
  const entries = [...history].reverse()

  const fmtTime = (t) => {
    const d = new Date(t)
    const now = new Date()
    const diff = Math.floor((now - d) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return d.toLocaleDateString()
  }

  const kindIcon = (kind) => kind === 'manual' ? '💾' : '◆'
  const kindLabel = (kind) => kind === 'manual' ? 'Manual save' : 'AI change'

  return (
    <div className="history-panel">
      <div className="history-header">
        <span>{history.length} entr{history.length === 1 ? 'y' : 'ies'}</span>
        <button
          className="history-clear"
          onClick={() => {
            if (confirm('Clear all history? This does not affect your files.')) onClear?.()
          }}
          title="Clear history"
        >🗑</button>
      </div>
      <div className="history-list">
        {entries.map((entry) => {
          const files = Object.keys(entry.before)
          return (
            <div
              key={entry.id}
              className={`history-item kind-${entry.kind}`}
              onClick={() => {
                if (confirm(`Restore "${entry.label}"? Current unsaved changes will be lost.`)) {
                  onRestore?.(entry)
                }
              }}
            >
              <div className="history-item-head">
                <span className="history-icon">{kindIcon(entry.kind)}</span>
                <span className="history-label">{entry.label}</span>
              </div>
              <div className="history-item-meta">
                <span className={`history-kind kind-${entry.kind}`}>{kindLabel(entry.kind)}</span>
                <span className="history-time">{fmtTime(entry.time)}</span>
              </div>
              <div className="history-files">
                {files.slice(0, 3).map((p) => (
                  <div key={p} className="history-file">{p}</div>
                ))}
                {files.length > 3 && (
                  <div className="history-file history-file-more">
                    +{files.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}