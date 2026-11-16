import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

// Phone layout: one full-screen panel at a time, a bottom tab bar, a symbol row above the keyboard.
// Every panel stays mounted once opened, so an AI reply keeps streaming while you look at other tabs.

const TABS = [
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'editor', label: 'Code', icon: 'edit' },
  { id: 'ai', label: 'AI', icon: 'bot' },
  { id: 'preview', label: 'Preview', icon: 'globe' },
  { id: 'terminal', label: 'Console', icon: 'command' },
]

const SYMBOLS = ['{', '}', '(', ')', '[', ']', '<', '>', ';', ':', '=', '"', "'", '`', '/', '\\', '|', '&', '!', '?', '+', '-', '*', '_', '#', '$', '%', '.', ',', '@']

export default function MobileLayout({
  tab, setTab, fileName, editorRef, consoleCount, syncing,
  moreItems, account,
  files, search, history, code, preview, ai, terminal,
}) {
  const [sub, setSub] = useState('files') // inside the Files tab
  const [sheet, setSheet] = useState(false)
  const [kb, setKb] = useState(false) // keyboard open
  const [visited, setVisited] = useState(() => new Set(['editor']))
  const rootRef = useRef(null)

  // remember which panels were opened (they stay mounted afterwards)
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set([...v, tab])))
  }, [tab])

  // Follow the visible area so the keyboard never covers the page
  useEffect(() => {
    const vv = window.visualViewport
    const apply = () => {
      const h = vv ? vv.height : window.innerHeight
      document.documentElement.style.setProperty('--vvh', `${Math.round(h)}px`)
      setKb(window.innerHeight - h > 140)
      if (vv && vv.offsetTop) window.scrollTo(0, 0)
    }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    window.addEventListener('resize', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', apply)
      document.documentElement.style.removeProperty('--vvh')
    }
  }, [])

  const ed = () => editorRef?.current?.getEditor?.()
  const type = (text) => {
    const e = ed()
    if (!e) return
    e.focus()
    e.trigger('keyboard', 'type', { text })
  }
  const cmd = (id) => {
    const e = ed()
    if (!e) return
    e.focus()
    e.trigger('mobile-bar', id, null)
  }
  // keep the keyboard open: do not let the buttons steal focus from the editor
  const keep = (e) => e.preventDefault()

  const running = tab === 'preview'
  const titles = { files: 'Files', ai: 'AI chat', preview: 'Preview', terminal: 'Console' }
  const showSymbols = kb && tab === 'editor'

  const panel = (id, node) =>
    visited.has(id) ? (
      <section className={`m-panel ${tab === id ? 'on' : ''}`} hidden={tab !== id} key={id}>
        {node}
      </section>
    ) : null

  return (
    <div className="m-root" ref={rootRef}>
      <header className="m-head">
        <div className="m-head-left">
          <span className="m-logo" aria-hidden="true" />
          {tab === 'editor' ? (
            <button className="m-file" onClick={() => setTab('files')} title="Open files">
              <Icon name="file" size={14} />
              <span>{fileName ? fileName.split('/').pop() : 'No file open'}</span>
            </button>
          ) : (
            <span className="m-title">{titles[tab]}</span>
          )}
        </div>
        <div className="m-head-right">
          {syncing && <Icon name="sync" size={15} className="spin m-sync" />}
          <button
            className={`m-run ${running ? 'stop' : ''}`}
            onClick={() => setTab(running ? 'editor' : 'preview')}
          >
            <Icon name={running ? 'stop' : 'play'} size={12} />
            <span>{running ? 'Stop' : 'Run'}</span>
          </button>
          <button className="m-icon" onClick={() => setSheet(true)} aria-label="More">
            <Icon name="dots" size={20} />
          </button>
        </div>
      </header>

      <main className="m-body">
        {panel('files', (
          <>
            <div className="m-seg">
              {[['files', 'Files'], ['search', 'Search'], ['history', 'History']].map(([id, label]) => (
                <button key={id} className={sub === id ? 'active' : ''} onClick={() => setSub(id)}>{label}</button>
              ))}
            </div>
            <div className="m-fill">
              {sub === 'files' && files}
              {sub === 'search' && search}
              {sub === 'history' && history}
            </div>
          </>
        ))}
        {panel('editor', (
          <>
            <div className="m-code">{code}</div>
            {showSymbols && (
              <div className="m-symbols" onPointerDown={keep}>
                <button className="m-key wide" onPointerDown={keep} onClick={() => cmd('tab')}>Tab</button>
                <button className="m-key" onPointerDown={keep} onClick={() => cmd('undo')} aria-label="Undo"><Icon name="undo" size={15} /></button>
                <button className="m-key" onPointerDown={keep} onClick={() => cmd('redo')} aria-label="Redo" style={{ transform: 'scaleX(-1)' }}><Icon name="undo" size={15} /></button>
                <button className="m-key" onPointerDown={keep} onClick={() => cmd('cursorLeft')}>←</button>
                <button className="m-key" onPointerDown={keep} onClick={() => cmd('cursorRight')}>→</button>
                {SYMBOLS.map((s) => (
                  <button key={s} className="m-key" onPointerDown={keep} onClick={() => type(s)}>{s}</button>
                ))}
              </div>
            )}
          </>
        ))}
        {panel('ai', ai)}
        {panel('preview', preview)}
        {panel('terminal', <div className="m-term">{terminal}</div>)}
      </main>

      {!kb && (
        <nav className="m-nav" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} className={`m-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <span className="m-tab-icon">
                <Icon name={t.icon} size={20} />
                {t.id === 'terminal' && consoleCount > 0 && <i className="m-badge">{consoleCount > 9 ? '9+' : consoleCount}</i>}
              </span>
              <span className="m-tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      )}

      {sheet && (
        <div className="m-sheet-back" onClick={() => setSheet(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-grab" />
            <div className="m-sheet-grid">
              {moreItems.filter(Boolean).map((it) => (
                <button
                  key={it.label}
                  className="m-sheet-item"
                  disabled={it.disabled}
                  onClick={() => { setSheet(false); it.onClick() }}
                >
                  <Icon name={it.icon} size={20} />
                  <span>{it.label}</span>
                </button>
              ))}
            </div>
            {account && <div className="m-sheet-account">{account}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
