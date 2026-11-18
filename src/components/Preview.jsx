import Icon from './Icon'
import { useMemo, useRef, useEffect, useState } from 'react'
import { buildPreview } from '../lib/preview'
import { API_BASE } from '../lib/api'

export default function Preview({ files, activeFile, onConsoleMessage, sessionId, onAskAI }) {
  const [key, setKey] = useState(0)
  const [mode, setMode] = useState(() => (typeof window !== 'undefined' && window.desktop?.isDesktop && window.__qodersLocalUrl ? 'local' : 'inline')) // 'inline' | 'url' | 'local'
  const [localUrl, setLocalUrl] = useState(() => (typeof window !== 'undefined' && window.desktop?.isDesktop ? window.__qodersLocalUrl || '' : ''))
  useEffect(() => {
    const onUrl = (e) => { setLocalUrl(e.detail.url); setMode('local'); setKey((k) => k + 1) }
    const onMode = (e) => { if (e.detail?.mode) setMode(e.detail.mode) }
    const onReload = () => setKey((k) => k + 1)
    window.addEventListener('qoders-local-url', onUrl)
    window.addEventListener('qoders-preview-mode', onMode)
    window.addEventListener('qoders-preview-reload', onReload)
    return () => {
      window.removeEventListener('qoders-local-url', onUrl)
      window.removeEventListener('qoders-preview-mode', onMode)
      window.removeEventListener('qoders-preview-reload', onReload)
    }
  }, [])
  const iframeRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState(null) // element the user clicked
  const [ask, setAsk] = useState('')

  const html = useMemo(() => buildPreview(files, activeFile), [files, activeFile])
  const previewUrl = sessionId ? `${API_BASE}/preview/${sessionId}/` : null
  useEffect(() => {
    const handler = (e) => {
      if (e.data && e.data.__pick && e.source === iframeRef.current?.contentWindow) {
        setPicked(e.data)
        setAsk('')
        setPicking(false)
        return
      }
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
    setPicking(false)
    setPicked(null)
  }, [html])

  // turn the click-to-select mode on or off inside the page
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ __pickMode: picking }, '*')
  }, [picking, key])
  const onFrameLoad = () => iframeRef.current?.contentWindow?.postMessage({ __pickMode: picking }, '*')

  // a project that needs npm (Vite, React, TypeScript, 3D...) cannot run in the plain inline preview
  const npmProject = (() => {
    const pkgPath = Object.keys(files || {}).find((p) => /(^|\/)package\.json$/.test(p))
    if (!pkgPath) return null
    try {
      const pkg = JSON.parse(files[pkgPath].content)
      const script = pkg.scripts?.dev ? 'dev' : pkg.scripts?.start ? 'start' : null
      if (!script) return null
      const dir = pkgPath.includes('/') ? pkgPath.slice(0, pkgPath.lastIndexOf('/')) : ''
      return { script, dir }
    } catch { return null }
  })()
  const desktopApp = typeof window !== 'undefined' && !!window.desktop?.termRun
  const runNpm = () => {
    const pre = npmProject.dir ? `cd ${npmProject.dir} && ` : ''
    window.dispatchEvent(new CustomEvent('qoders-enqueue', { detail: { goal: 'Run the project', commands: [
      { command: `${pre}npm install`, test: true, message: 'Installs the packages this project needs' },
      { command: `${pre}npm run ${npmProject.script}`, test: true, message: 'Starts the project on your computer' },
    ] } }))
  }

  const sendChange = () => {
    if (!picked || !ask.trim()) return
    const st = picked.styles || {}
    const prompt = [
      'Change one element of the live preview.',
      `Element: <${picked.tag}> (selector: ${picked.selector})`,
      picked.text ? `Its text: "${picked.text}"` : '',
      `Its HTML: ${picked.html}`,
      `Current look: color ${st.color}, background ${st.background}, font-size ${st.fontSize}, padding ${st.padding}, radius ${st.borderRadius}`,
      '',
      `What I want: ${ask.trim()}`,
      '',
      'Find where this element is made in the project files and change only what is needed. Keep everything else exactly the same.',
    ].filter((l) => l !== '').join('\n')
    const shown = `Change the ${picked.tag}${picked.text ? ` "${picked.text.slice(0, 40)}"` : ''}: ${ask.trim()}`
    onAskAI?.({ prompt, shown })
    setPicked(null)
    setAsk('')
  }

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
          {localUrl && (
            <button
              className={`preview-mode-btn ${mode === 'local' ? 'active' : ''}`}
              onClick={() => setMode('local')}
              title={`Your dev server on this computer: ${localUrl}`}
            >Local</button>
          )}
        </div>
        {mode === 'local' && localUrl && (
          <div className="preview-url-bar">
            <span className="preview-url-text" title={localUrl}>{localUrl}</span>
            <a className="topbar-btn small" href={localUrl} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Open</a>
          </div>
        )}

        {mode === 'inline' && (
          <span className="preview-label">
            Preview {activeFile ? `— ${activeFile}` : ''}
          </span>
        )}

        {mode === 'url' && previewUrl && (
          <div className="preview-url-bar">
            <span className="preview-url-text" title={previewUrl}>{previewUrl}</span>
            <button className="topbar-btn small" onClick={copyUrl}>
              {copied ? <><Icon name="check" size={13} /> Copied</> : <><Icon name="copy" size={13} /> Copy</>}
            </button>
            <a
              className="topbar-btn small"
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
            ><Icon name="external" size={13} /> Open</a>
          </div>
        )}

        <div className="preview-actions">
          {mode === 'inline' && onAskAI && (
            <button
              className={`topbar-btn small ${picking ? 'pick-on' : ''}`}
              onClick={() => { setPicked(null); setPicking((p) => !p) }}
              title="Click an element in the preview, then tell the AI what to change"
            ><Icon name="bolt" size={13} /> {picking ? 'Pick an element…' : 'Select'}</button>
          )}
          <button
            className="topbar-btn small"
            onClick={() => setKey((k) => k + 1)}
            title="Reload preview"
          ><Icon name="refresh" size={13} /> Reload</button>
        </div>
      </div>

      {npmProject && mode !== 'local' && !localUrl && (
        <div className="npm-banner">
          <div><strong>This project needs npm.</strong> It cannot show here until its packages are installed and it is started, so you may only see a blank page.</div>
          {desktopApp
            ? <button className="action-btn" onClick={runNpm}>Install &amp; run it</button>
            : <div className="npm-hint">Open the desktop app to run it, or run <code>npm install</code> then <code>npm run {npmProject.script}</code> yourself.</div>}
        </div>
      )}
      {mode === 'local' && localUrl ? (
        <div className="preview-url-frame-wrap">
          <iframe key={key} className="preview-frame" title="Local server" src={localUrl} />
          <div className="preview-url-note">Your dev server, running on this computer. Errors it shows are sent to the AI.</div>
        </div>
      ) : mode === 'inline' ? (
        <iframe
          key={key}
          ref={iframeRef}
          className="preview-frame"
          title="Preview"
          srcDoc={html}
          onLoad={onFrameLoad}
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
      {picked && (
        <div className="pick-pop" role="dialog" aria-label="Change this element">
          <div className="pick-chip"><Icon name="bolt" size={12} /> &lt;{picked.tag}&gt;{picked.text ? ` "${picked.text.slice(0, 36)}${picked.text.length > 36 ? '…' : ''}"` : ''}</div>
          <div className="pick-row">
            <input
              autoFocus
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendChange(); if (e.key === 'Escape') setPicked(null) }}
              placeholder="What should change? e.g. make it bigger and blue"
            />
            <button className="pick-go" disabled={!ask.trim()} onClick={sendChange}>Change</button>
            <button className="pick-x" onClick={() => setPicked(null)} aria-label="Cancel"><Icon name="close" size={13} /></button>
          </div>
        </div>
      )}
    </div>
  )
}