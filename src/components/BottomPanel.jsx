import Icon from './Icon'
import { useState, useEffect, useRef } from 'react'
import Terminal from './Terminal'
import { isDesktopApp } from '../lib/diskSave'

const TABS = [
  { id: 'terminal', label: 'Terminal', icon: '⌘' },
  { id: 'output',   label: 'Output',   icon: '▤' },
  { id: 'problems', label: 'Problems', icon: '⚠' },
  { id: 'debug',    label: 'Debug',    icon: '🐞' },
]
export default function BottomPanel({ open, onClose, consoleMessages, files, onFilesChange, projectId }) {
  const [activeTab, setActiveTab] = useState('output')
  const [cleared, setCleared] = useState(false)
  useEffect(() => {
    const h = () => setActiveTab('terminal')
    window.addEventListener('qoders-open-terminal', h)
    return () => window.removeEventListener('qoders-open-terminal', h)
  }, [])
  const outputEndRef = useRef(null)
  const [problems, setProblems] = useState(() => window.__qodersProblems || [])
  useEffect(() => {
    const h = (e) => setProblems(e.detail || [])
    const o = () => setActiveTab('problems')
    window.addEventListener('qoders-problems', h)
    window.addEventListener('qoders-open-problems', o)
    return () => { window.removeEventListener('qoders-problems', h); window.removeEventListener('qoders-open-problems', o) }
  }, [])

  const messages = cleared ? [] : (consoleMessages || [])

  useEffect(() => {
    if (activeTab === 'output') {
      outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, activeTab])

  // the terminal is created the first time the panel opens and then stays alive (hidden), so closing or switching tabs doesn't kill it
  const [termOn, setTermOn] = useState(false)
  // several terminals (desktop app): terminal 1 is the one the AI uses
  const canMulti = isDesktopApp() && !!window.desktop?.ptyOpen
  const [terms, setTerms] = useState([0])
  const [activeT, setActiveT] = useState(0)
  const nextT = useRef(1)
  const addTerm = () => { if (terms.length >= 6) return; const n = nextT.current++; setTerms((t) => [...t, n]); setActiveT(n) }
  const closeTerm = (n) => {
    if (n === 0) return
    try { window.desktop.ptyKill(`pty-${projectId}-${n}`) } catch { /* ignore */ }
    setTerms((t) => t.filter((x) => x !== n)); setActiveT((a) => (a === n ? 0 : a))
  }
  useEffect(() => { setTimeout(() => window.dispatchEvent(new Event('resize')), 60); window.dispatchEvent(new CustomEvent('qoders-relayout')) }, [activeT, terms.length])
  useEffect(() => { if (open && activeTab === 'terminal') setTermOn(true) }, [open, activeTab])
  if (!open && !termOn) return null

  return (
    <div className="bottom-panel" style={open ? undefined : { display: 'none' }}>
      <div className="bottom-tabs">
        {TABS.map((tab) => {
          const badge = tab.id === 'output' && messages.length > 0
            ? messages.length
            : null
          const isProblems = tab.id === 'problems'
          return (
            <button
              key={tab.id}
              className={`bottom-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="bottom-tab-icon">{tab.icon}</span>
              <span className="bottom-tab-label">{tab.label}</span>
              {badge !== null && (
                <span className="tab-badge">{badge}</span>
              )}
              {isProblems && problems.length > 0 && (
                <span className="tab-badge tab-badge-dim">{problems.length}</span>
              )}
            </button>
          )
        })}
        <div className="bottom-tabs-spacer" />
        {activeTab === 'output' && messages.length > 0 && (
          <button
            className="bottom-action-btn"
            onClick={() => setCleared(true)}
            title="Clear output"
          >
            <Icon name="trash" size={13} /> Clear
          </button>
        )}
        <button
          className="bottom-close"
          onClick={onClose}
          title="Close panel"
        ><Icon name="close" size={14} strokeWidth={2.2} /></button>
      </div>

      <div className="bottom-body">
        {activeTab === 'output' ? (
          messages.length === 0 ? (
            <div className="bottom-placeholder">
              <div className="placeholder-icon">▤</div>
              <div className="placeholder-title">No output yet</div>
              <div className="placeholder-hint">
                Console output from your preview will appear here.
              </div>
            </div>
          ) : (
            <div className="console-output">
              {messages.map((m, i) => (
                <div key={i} className={`console-line level-${m.level}`}>
                  <span className="console-prefix">
                    {m.level === 'error' ? '✕' : m.level === 'warn' ? '⚠' : '›'}
                  </span>
                  <span className="console-text">{m.text}</span>
                </div>
              ))}
              <div ref={outputEndRef} />
            </div>
          )
        ) : activeTab === 'terminal' ? null : activeTab === 'problems' ? (
          problems.length === 0 ? (
          <div className="bottom-placeholder">
            <div className="placeholder-icon">⚠</div>
            <div className="placeholder-title">No problems detected</div>
            <div className="placeholder-hint">
              Errors and warnings from your code will appear here.
            </div>
          </div>
          ) : (
          <div className="problems-list">
            {problems.map((p, i) => (
              <div key={i} className={`problem-row sev-${p.sev}`} onClick={() => window.dispatchEvent(new CustomEvent('qoders-goto', { detail: { line: p.line, col: p.col } }))}>
                <span className="problem-ico">{p.sev === 'error' ? '✕' : '⚠'}</span>
                <span className="problem-msg">{p.msg}</span>
                <span className="problem-loc">Ln {p.line}, Col {p.col}</span>
                <button className="problem-fix" onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('ai-action', { detail: { action: 'selection', selection: p.src, instruction: `Fix this ${p.sev} on line ${p.line}: ${p.msg}` } })) }} title="Let the AI fix this">✦ Fix with AI</button>
              </div>
            ))}
          </div>
          )
        ) : (
          <div className="bottom-placeholder">
            <div className="placeholder-icon">🐞</div>
            <div className="placeholder-title">Debug console</div>
            <div className="placeholder-hint">
              Debug output will appear here.
            </div>
          </div>
        )}
        {termOn && (
          <div style={{ display: activeTab === 'terminal' ? 'flex' : 'none', flex: 1, minHeight: 0, height: '100%', flexDirection: 'column' }}>
            {canMulti && (
              <div className="term-tabs">
                {terms.map((n) => (
                  <button key={n} className={`term-tab ${activeT === n ? 'active' : ''}`} onClick={() => setActiveT(n)}>
                    ⌘ Terminal {n + 1}{n > 0 && <span className="term-tab-x" onClick={(e) => { e.stopPropagation(); closeTerm(n) }} title="Close this terminal">×</span>}
                  </button>
                ))}
                <button className="term-tab term-add" onClick={addTerm} title="New terminal" disabled={terms.length >= 6}>+</button>
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {terms.map((n) => (
                <div key={n} style={{ display: activeT === n ? 'flex' : 'none', position: 'absolute', inset: 0, flexDirection: 'column' }}>
                  <Terminal files={files} onFilesChange={onFilesChange} projectId={projectId} slot={n} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}