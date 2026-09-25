import { useState, useRef } from 'react'

export default function ImportModal({ currentFileCount, onImport, onCancel }) {
  const [mode, setMode] = useState('replace') // 'replace' | 'merge'
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const handleFile = (f) => {
    if (!f) return
    if (!f.name.endsWith('.zip')) {
      setError('Please select a .zip file')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      setError('File is too large (max 20 MB)')
      return
    }
    setFile(f)
    setError(null)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    handleFile(f)
  }

  const submit = () => {
    if (!file) return
    onImport(file, mode)
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">📦</span>
            <div>
              <div className="modal-title">Import project</div>
              <div className="modal-subtitle">Load files from a zip archive</div>
            </div>
          </div>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="modal-body-simple">
          <div
            className={`drop-zone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            {file ? (
              <>
                <div className="drop-icon">📦</div>
                <div className="drop-name">{file.name}</div>
                <div className="drop-size">
                  {(file.size / 1024).toFixed(1)} KB
                </div>
              </>
            ) : (
              <>
                <div className="drop-icon">⬆</div>
                <div className="drop-title">Drop a .zip file here</div>
                <div className="drop-hint">or click to browse</div>
              </>
            )}
          </div>

          {error && <div className="drop-error">⚠️ {error}</div>}

          <div className="import-mode">
            <div className="import-mode-title">How should we handle existing files?</div>
            <label className={`import-option ${mode === 'replace' ? 'active' : ''}`}>
              <input
                type="radio"
                name="import-mode"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
              />
              <div>
                <div className="import-option-label">Replace everything</div>
                <div className="import-option-hint">
                  Wipe the current {currentFileCount} file{currentFileCount === 1 ? '' : 's'} and load only the zip
                </div>
              </div>
            </label>
            <label className={`import-option ${mode === 'merge' ? 'active' : ''}`}>
              <input
                type="radio"
                name="import-mode"
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
              />
              <div>
                <div className="import-option-label">Merge</div>
                <div className="import-option-hint">
                  Keep current files, add / overwrite matching paths from the zip
                </div>
              </div>
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <span className="modal-hint">
            {mode === 'replace'
              ? '⚠️ Replaces all files (history is preserved)'
              : 'Adds new files, overwrites matching ones'}
          </span>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-accept" onClick={submit} disabled={!file}>
            <span className="btn-check">✓</span> Import
          </button>
        </div>
      </div>
    </div>
  )
}