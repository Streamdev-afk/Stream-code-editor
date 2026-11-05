import { useMemo, useRef, useEffect, useState } from 'react'
import { buildPreview } from '../lib/preview'
import { API_BASE } from '../lib/api'

export default function Preview({ files, activeFile, onConsoleMessage, sessionId }) {
  const [key, setKey] = useState(0)
  const [mode, setMode] = useState('inline') // 'inline' | 'url'
  const iframeRef = useRef(null)
  const [copied, setCopied] = useState(false)

  const html = useMemo(() => buildPreview(files, activeFile), [files, activeFile])
  const previewUrl = sessionId ? `${API_BASE}/preview/${sessionId}/` : null
  useEffect(() => {
    const handler = (e) => {
      if (e.data && e.data.__preview) {
        onConsoleMessage?.({
          level: e.data.level,
          text: e.data.text,
          time: Date.now(),
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onConsoleMessage])

  useEffect(() => {
    setKey((k) => k + 1)
  }, [html])

  const copyUrl = async () => {
    if (!previewUrl) return
    try {
      await navigator.clipboard.writeText(previewUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="preview-wrap">
      <div className="preview-toolbar">
        <div className="preview-mode">
          <button
            className={`preview-mode-btn ${mode === 'inline' ? 'active' : ''}`}
            onClick={() => setMode('inline')}
          >Inline</button>
          <button
            className={`preview-mode-btn ${mode === 'url' ? 'active' : ''}`}
            onClick={() => setMode('url')}
            disabled={!previewUrl}
            title={previewUrl ? 'Live URL mode' : 'Waiting for session…'}
          >Live URL</button>
        </div>

        {mode === 'inline' && (
          <span className="preview-label">
            Preview {activeFile ? `— ${activeFile}` : ''}
          </span>
        )}

        {mode === 'url' && previewUrl && (
          <div className="preview-url-bar">
            <span className="preview-url-text" title={previewUrl}>{previewUrl}</span>
            <button className="topbar-btn small" onClick={copyUrl}>
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
            <a
              className="topbar-btn small"
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
            >↗ Open</a>
          </div>
        )}

        <div className="preview-actions">
          <button
            className="topbar-btn small"
            onClick={() => setKey((k) => k + 1)}
            title="Reload preview"
          >↻ Reload</button>
        </div>
      </div>

      {mode === 'inline' ? (
        <iframe
          key={key}
          ref={iframeRef}
          className="preview-frame"
          title="Preview"
          srcDoc={html}
          sandbox="allow-scripts allow-modals allow-forms"
        />
      ) : (
        <div className="preview-url-frame-wrap">
          {previewUrl ? (
            <>
              <iframe
                key={key}
                className="preview-frame"
                title="Live preview"
                src={previewUrl}
              />
              <div className="preview-url-note">
                Real HTTP preview — opens in any browser tab. Share the URL with anyone on your network.
              </div>
            </>
          ) : (
            <div className="preview-waiting">
              Waiting for the backend to create a session…
            </div>
          )}
        </div>
      )}
    </div>
  )
}