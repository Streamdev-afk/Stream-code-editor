import { useState, useEffect, useRef } from 'react'
import Terminal from './Terminal'

const TABS = [
  { id: 'terminal', label: 'Terminal', icon: '⌘' },
  { id: 'output',   label: 'Output',   icon: '▤' },
  { id: 'problems', label: 'Problems', icon: '⚠' },
  { id: 'debug',    label: 'Debug',    icon: '🐞' },
]
export default function BottomPanel({ open, onClose, consoleMessages, files, onFilesChange }) {
  const [activeTab, setActiveTab] = useState('output')
  const [cleared, setCleared] = useState(false)
  const outputEndRef = useRef(null)

  const messages = cleared ? [] : (consoleMessages || [])

  useEffect(() => {
    if (activeTab === 'output') {
      outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, activeTab])

  if (!open) return null

  return (
    <div className="bottom-panel">
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
              {isProblems && (
                <span className="tab-badge tab-badge-dim">0</span>
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
            🗑 Clear
          </button>
        )}
        <button
          className="bottom-close"
          onClick={onClose}
          title="Close panel"
        >✕</button>
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
        ) : activeTab === 'terminal' ? (
  <Terminal files={files} onFilesChange={onFilesChange} />
) : activeTab === 'problems' ? (
          <div className="bottom-placeholder">
            <div className="placeholder-icon">⚠</div>
            <div className="placeholder-title">No problems detected</div>
            <div className="placeholder-hint">
              Errors and warnings from your code will appear here.
            </div>
          </div>
        ) : (
          <div className="bottom-placeholder">
            <div className="placeholder-icon">🐞</div>
            <div className="placeholder-title">Debug console</div>
            <div className="placeholder-hint">
              Debug output will appear here.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}