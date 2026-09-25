import { useState, useMemo } from 'react'

export default function SearchPanel({ files, onOpenResult }) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)

  const results = useMemo(() => {
    if (!query.trim()) return []
    const q = caseSensitive ? query : query.toLowerCase()
    const out = []

    for (const [path, file] of Object.entries(files)) {
      const lines = (file.content || '').split('\n')
      const matches = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const haystack = caseSensitive ? line : line.toLowerCase()
        const idx = haystack.indexOf(q)
        if (idx !== -1) {
          matches.push({
            line: i + 1,
            text: line,
            start: idx,
            length: query.length,
          })
        }
        if (matches.length >= 50) break // cap per file
      }

      if (matches.length > 0) {
        out.push({ path, matches })
      }

      if (out.length >= 100) break // cap total files
    }

    return out
  }, [files, query, caseSensitive])

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0)

  return (
    <div className="search-panel">
      <div className="search-input-wrap">
        <input
          className="search-input"
          placeholder="Search across files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="search-options">
        <label className="search-option">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          <span>Aa</span>
        </label>
        <div className="search-summary">
          {query.trim()
            ? `${totalMatches} match${totalMatches === 1 ? '' : 'es'} in ${results.length} file${results.length === 1 ? '' : 's'}`
            : ''}
        </div>
      </div>

      <div className="search-results">
        {!query.trim() ? (
          <div className="search-empty">Type to search across all files</div>
        ) : results.length === 0 ? (
          <div className="search-empty">No matches</div>
        ) : (
          results.map((r) => (
            <div key={r.path} className="search-file-group">
              <div className="search-file-header">
                <span className="search-file-path">{r.path}</span>
                <span className="search-file-count">{r.matches.length}</span>
              </div>
              {r.matches.map((m, i) => (
                <div
                  key={i}
                  className="search-match"
                  onClick={() => onOpenResult?.(r.path, m.line)}
                >
                  <span className="search-line-num">{m.line}</span>
                  <span className="search-line-text">
                    {m.text.slice(0, m.start)}
                    <mark>{m.text.slice(m.start, m.start + m.length)}</mark>
                    {m.text.slice(m.start + m.length)}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}