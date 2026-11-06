import { useState, useRef, useEffect } from 'react'
import { streamAgent, planTask } from '../lib/ai'
import { API_BASE } from '../lib/api'
import { apiFetch } from '../lib/supabase'
import { fileToDataUrl } from '../lib/image'
import { createShell } from '../lib/shell'
import { shouldExplore, buildIndex, runForAI, trimObservations, MAX_SHELL_ROUNDS } from '../lib/ai'
import ModelSwitcher from './ModelSwitcher'
import ThinkingSwitcher from './ThinkingSwitcher'
import BehaviorSwitcher from './BehaviorSwitcher'

// The chat AI asks to read code by replying with a <shell>...</shell> block
const looksLikeShell = (text) => {
  const t = text.trimStart().toLowerCase()
  return t.startsWith('<shell') || (t.length > 0 && '<shell>'.startsWith(t))
}

const parseShellRequest = (text) => {
  const m = text.trim().match(/^<shell>([\s\S]*?)(?:<\/shell>|$)/i)
  if (!m) return []
  return m[1].split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4)
}

export default function AIChat({
  code,
  language,
  files,
  activeFile,
  messages: messagesProp,
  setMessages: setMessagesProp,
  sessionTitle,
  onFirstMessage,
  onApplyPlan,
  onPlanReady,
  model,
  thinking,
  behavior,
  onModelChange,
  onThinkingChange,
  onBehaviorChange,
  testAfterApply,
  onTestToggle,
  planningMode = true,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onDeleteSession,
}) {
  const [showSessions, setShowSessions] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [sessionQuery, setSessionQuery] = useState('')
  const [mode, setMode] = useState('chat')
  const [images, setImages] = useState([]) // data URLs waiting to be sent (max 2)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [imageError, setImageError] = useState('')
  const fileInputRef = useRef(null)

  // If parent supplies messages (session-backed), use those.
  // Otherwise fall back to internal state (backward compat).
  const [localMessages, setLocalMessages] = useState(() => [
    {
      role: 'assistant',
      text: "Hey! I'm Qoders. Ask me anything, or switch to Agent mode to make changes to your files.",
      time: Date.now(),
    },
  ])
  const messages = messagesProp ?? localMessages
  const setMessages = setMessagesProp ?? setLocalMessages
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addImageFiles = async (fileList) => {
    const picked = Array.from(fileList || []).filter((f) => f && f.type?.startsWith('image/'))
    if (!picked.length) return
    setImageError('')
    try {
      const room = Math.max(0, 2 - images.length)
      if (picked.length > room) setImageError('You can attach up to 2 images.')
      const urls = []
      for (const f of picked.slice(0, room)) urls.push(await fileToDataUrl(f))
      if (urls.length) setImages((prev) => [...prev, ...urls].slice(0, 2))
    } catch (e) {
      setImageError(e.message || 'Could not read that image.')
    }
  }

useEffect(() => {
  const handler = (e) => {
    const { status, summary, attempt } = e.detail
    const prefix = status === 'ok' ? '✅' : status === 'fix' ? '🔧' : '⚠️'
    setMessages((m) => [...m, {
      role: 'assistant',
      text: `${prefix} ${summary}`,
      time: Date.now(),
    }])
  }
  window.addEventListener('stream-test-result', handler)
  return () => window.removeEventListener('stream-test-result', handler)
}, [])

  const sendChat = async (text, imgs = []) => {
    const userMsg = { role: 'user', text, time: Date.now(), ...(imgs.length ? { imageCount: imgs.length } : {}) }

    // Build the full conversation including the new message
    const newMessages = [...messages, userMsg]

    // Update the session in ONE call so nothing gets overwritten
    setMessages([
      ...newMessages,
      { role: 'assistant', text: '', time: Date.now() },
    ])
    setStreaming(true)

    const setLast = (t) =>
      setMessages((m) => {
        const c = [...m]
        c[c.length - 1] = { role: 'assistant', text: t, time: Date.now() }
        return c
      })

    try {
      const apiMessages = newMessages
        .filter((m) => !(m.role === 'assistant' && /^Hey! I'm (Stream|Qoders)/.test(m.text)))
        .map((m) => ({ role: m.role, content: m.text }))

      // Bigger projects: the AI is not sent the files. It asks for terminal commands
      // (grep -rn, sed -n ...) and gets back only the lines it needs.
      const explore = shouldExplore(files)
      const shell = explore ? createShell(files, '/') : null
      const index = explore ? buildIndex(files) : null
      const observations = []
      let turn = null

      for (let round = 0; round <= MAX_SHELL_ROUNDS; round++) {
        const lastRound = round === MAX_SHELL_ROUNDS
        const body = explore
          ? {
              messages: apiMessages, language, activeFile, model, thinking, behavior, images: imgs,
              explore: true, fileIndex: index, observations, turn, lastRound,
            }
          : { messages: apiMessages, code, language, model, thinking, behavior, images: imgs }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 60000)
        let res
        try {
          res = await apiFetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timeoutId)
        }
        if (!res.ok) {
          let errorMsg = `HTTP ${res.status}`
          try {
            const errorData = await res.json()
            if (errorData.error) errorMsg = errorData.error
          } catch {}
          throw new Error(errorMsg)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let full = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.error) {
                setLast(`⚠️ ${parsed.error}`)
                continue
              }
              if (parsed.turn) turn = parsed.turn
              if (parsed.text) {
                full += parsed.text
                // a terminal request is not an answer: show a status instead of the raw command
                setLast(explore && !lastRound && looksLikeShell(full) ? '🔎 Reading your code…' : full)
              }
            } catch {}
          }
        }

        if (explore && !lastRound) {
          const cmds = parseShellRequest(full)
          if (cmds.length) {
            for (const c of cmds) {
              setLast(`🔎 Reading: ${c}`)
              observations.push({ cmd: c, output: runForAI(shell, c) })
            }
            trimObservations(observations)
            setLast('🔎 Thinking…')
            continue
          }
        }
        break
      }
    } catch (err) {
      const msg = err.name === 'AbortError'
        ? 'Request timed out after 60s. Try a shorter question.'
        : err.message
      setLast(`⚠️ ${msg}`)
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }

  const sendAgent = async (text, imgs = []) => {
    // shows which terminal command the AI is running to read your code
    const showReading = (cmd) =>
      setMessages((m) => {
        const c = [...m]
        c[c.length - 1] = { role: 'assistant', text: `🔎 Reading: ${cmd}`, time: Date.now(), _status: true }
        return c
      })
    setMessages([
      ...messages,
      { role: 'user', text, time: Date.now(), ...(imgs.length ? { imageCount: imgs.length } : {}) },
      { role: 'assistant', text: 'Analyzing project…', time: Date.now(), _status: true },
    ])
    setStreaming(true)

    try {
      // If planning mode is on, plan first
      if (planningMode && onPlanReady) {
        const planResult = await planTask(
  { prompt: text, files, activeFile, history: messages, model, thinking, behavior, images: imgs, onStatus: showReading },
          (_chunk, full) => {
            let hint = 'Analyzing project…'
            if (full.length > 200) hint = 'Drafting plan…'
            if (full.length > 600) hint = 'Almost ready…'
            setMessages((m) => {
              const c = [...m]
              c[c.length - 1] = { role: 'assistant', text: hint, time: Date.now(), _status: true }
              return c
            })
          }
        )

        const stepCount = Array.isArray(planResult.steps) ? planResult.steps.length : 0
        setMessages((m) => {
          const c = [...m]
          c[c.length - 1] = {
            role: 'assistant',
            text: `🧭 Planned ${stepCount} step${stepCount === 1 ? '' : 's'}: ${planResult.title || planResult.summary || ''}\n\nReview the plan and click Execute when ready.`,
            time: Date.now(),
          }
          return c
        })

        onPlanReady(planResult, text)
        setStreaming(false)
        return
      }

      // Fallback: direct agent (no planning)
      const plan = await streamAgent(
  { prompt: text, files, activeFile, history: messages, model, thinking, behavior, images: imgs, onStatus: showReading },
  (_chunk, full) => {
          let hint = 'Analyzing project…'
          if (full.length > 200) hint = 'Planning changes…'
          if (full.length > 600) hint = 'Writing code…'
          setMessages((m) => {
            const c = [...m]
            c[c.length - 1] = { role: 'assistant', text: hint, time: Date.now(), _status: true }
            return c
          })
        }
      )

      if (!plan.operations || plan.operations.length === 0) {
        setMessages((m) => {
          const c = [...m]
          c[c.length - 1] = { role: 'assistant', text: plan.explanation || 'No changes needed.', time: Date.now() }
          return c
        })
        return
      }

      const planLines = Array.isArray(plan.plan) && plan.plan.length > 0
  ? '\n\n' + plan.plan.map((s, i) => `${i + 1}. ${s}`).join('\n')
  : ''
const opsLine = `\n\nOpening review for ${plan.operations.length} change(s)…`

setMessages((m) => {
  const c = [...m]
  c[c.length - 1] = {
    role: 'assistant',
    text: `${plan.explanation}${planLines}${opsLine}`,
    time: Date.now(),
  }
  return c
})
      onApplyPlan?.(plan, text)
    } catch (err) {
      setMessages((m) => {
        const c = [...m]
        c[c.length - 1] = { role: 'assistant', text: `⚠️ ${err.message}`, time: Date.now() }
        return c
      })
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }

  const send = () => {
    if ((!input.trim() && images.length === 0) || streaming) return
    const imgs = images
    const text = input.trim() || 'Look at the attached image.'
    setInput('')
    setImages([])
    setImageError('')

    // Auto-title on first user message
    const userMsgCount = messages.filter((m) => m.role === 'user').length
    if (userMsgCount === 0 && onFirstMessage) {
      onFirstMessage(text)
    }

    if (mode === 'agent') sendAgent(text, imgs)
    else sendChat(text, imgs)
  }

  const fmtTime = (t) =>
    new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div
      className={`aichat ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        addImageFiles(e.dataTransfer?.files)
      }}
    >
            <div className="panel-header aichat-header">
        <div className="aichat-header-row">
          <div className="mode-switch">
            <button
              className={`mode-btn ${mode === 'chat' ? 'active' : ''}`}
              onClick={() => setMode('chat')}
            >
              <span className="mode-dot" /> Chat
            </button>
            <button
              className={`mode-btn ${mode === 'agent' ? 'active' : ''}`}
              onClick={() => setMode('agent')}
            >
              <span className="mode-dot agent" /> Agent
            </button>
          </div>
          <div className="aichat-header-actions">
            <button
              className={`aichat-icon-btn ${showSearch ? 'active' : ''}`}
              onClick={() => {
                setShowSearch((s) => !s)
                setShowSessions(true)
              }}
              title="Search sessions"
            >
              🔍
            </button>
            <button
              className={`aichat-icon-btn ${showSessions ? 'active' : ''}`}
              onClick={() => {
                setShowSessions((s) => !s)
                if (showSessions) setShowSearch(false)
              }}
              title={showSessions ? 'Close sessions' : 'Show sessions'}
            >
              ▢
            </button>
          </div>
        </div>
        {mode === 'agent' && (
          <label className="test-toggle" title="After applying changes, let Qoders open the preview, watch for errors, and auto-fix them">
            <input
              type="checkbox"
              checked={!!testAfterApply}
              onChange={(e) => onTestToggle?.(e.target.checked)}
            />
            <span>Test after applying</span>
          </label>
        )}
      </div>

            {showSessions && (
        <div className="aichat-sessions-overlay">
          <div className="aichat-sessions-header">
            <div className="aichat-sessions-title">Sessions</div>
            <button
              className="aichat-sessions-new"
              onClick={() => {
                onNewSession?.()
                setShowSessions(false)
              }}
              title="New session"
            >
              ＋
            </button>
          </div>

          {showSearch && (
            <div className="aichat-sessions-search">
              <input
                className="aichat-sessions-search-input"
                placeholder="Search sessions…"
                value={sessionQuery}
                onChange={(e) => setSessionQuery(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="aichat-sessions-list">
            {(() => {
              const list = Array.isArray(sessions) ? sessions : []
              const q = sessionQuery.trim().toLowerCase()
              const filtered = q
                ? list.filter((s) => (s.title || '').toLowerCase().includes(q))
                : list

              if (filtered.length === 0) {
                return (
                  <div className="aichat-sessions-empty">
                    {q ? 'No matches' : 'No sessions yet — click ＋ to create one'}
                  </div>
                )
              }

              return filtered.map((s) => {
                const msgCount = Array.isArray(s.messages)
                  ? s.messages.filter((m) => m.role === 'user').length
                  : 0
                const fileCount = s.files ? Object.keys(s.files).length : 0
                const isActive = s.id === activeSessionId

                return (
                  <div
                    key={s.id}
                    className={`aichat-session-item ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      onSelectSession?.(s.id)
                      setShowSessions(false)
                      setShowSearch(false)
                      setSessionQuery('')
                    }}
                  >
                    <div className="aichat-session-icon">💬</div>
                    <div className="aichat-session-body">
                      <div className="aichat-session-name">{s.title || 'Untitled'}</div>
                      <div className="aichat-session-meta">
                        {msgCount} msg · {fileCount} files
                      </div>
                    </div>
                    {confirmDelete === s.id ? (
                      <div className="aichat-session-confirm" onClick={(e) => e.stopPropagation()}>
                        <span>Delete?</span>
                        <button
                          className="aichat-session-yes"
                          onClick={() => {
                            setConfirmDelete(null)
                            onDeleteSession?.(s.id)
                          }}
                        >
                          Yes
                        </button>
                        <button className="aichat-session-no" onClick={() => setConfirmDelete(null)}>
                          No
                        </button>
                      </div>
                    ) : (
                      <>
                        {isActive && <div className="aichat-session-active-dot" />}
                        {onDeleteSession && (
                          <button
                            className="aichat-session-del"
                            title="Delete this session"
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmDelete(s.id)
                            }}
                          >
                            🗑
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}

      <div className="chat-messages">
        {messages.map((msg, i) => {
          const isUser = msg.role === 'user'
          const isLast = i === messages.length - 1
          const showTyping = streaming && isLast && !msg._status && !msg.text

          return (
            <div key={i} className={`chat-msg ${isUser ? 'user' : 'assistant'}`}>
              <div className="chat-avatar">
                {isUser ? '👤' : '◆'}
              </div>
              <div className="chat-body">
                <div className="chat-meta">
                  <span className="chat-author">{isUser ? 'You' : 'Qoders'}</span>
                  <span className="chat-time">{fmtTime(msg.time || Date.now())}</span>
                </div>
                <div className={`chat-text ${msg._status ? 'chat-status' : ''}`}>
                  {showTyping ? (
                    <span className="typing">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </span>
                  ) : (
                    msg.text || (streaming && isLast ? '▍' : '')
                  )}
                </div>
                {msg.imageCount > 0 && (
                  <div className="chat-image-chip">🖼 {msg.imageCount} image{msg.imageCount > 1 ? 's' : ''} attached</div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-wrap">
        {images.length > 0 && (
          <div className="chat-attachments">
            {images.map((src, i) => (
              <div className="chat-attach" key={i}>
                <img src={src} alt="attachment" />
                <button
                  className="chat-attach-x"
                  title="Remove"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {imageError && <div className="chat-image-error">{imageError}</div>}
        <div className={`chat-composer mode-${mode}`}>
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={
              streaming ? 'ION Qoders is working...'
                : mode === 'agent' ? 'Tell Qoders what to build or change...'
                : 'Ask Qoders anything... (paste or drop a screenshot)'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'))
              if (files.length) {
                e.preventDefault()
                addImageFiles(files)
              }
            }}
            disabled={streaming}
            rows={2}
          />
          <div className="composer-bar">
            <div className="composer-tools">
              <button
                className="composer-icon"
                title="Attach an image (or paste / drop one)"
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming || images.length >= 2}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="4" />
                  <circle cx="9" cy="9.5" r="1.6" />
                  <path d="M21 16l-5-5-8 8" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  addImageFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <ModelSwitcher value={model} onChange={onModelChange} disabled={streaming} compact up />
              <ThinkingSwitcher value={thinking} onChange={onThinkingChange} disabled={streaming} compact up />
              <BehaviorSwitcher value={behavior} onChange={onBehaviorChange} disabled={streaming} compact up />
            </div>
            <button
              className="chat-send"
              onClick={send}
              disabled={streaming || (!input.trim() && images.length === 0)}
              title={mode === 'agent' ? 'Plan changes' : 'Send'}
            >
              {streaming ? '⋯' : mode === 'agent' ? '⚡' : '↑'}
            </button>
          </div>
        </div>
        <div className="chat-hint">
          {mode === 'agent'
            ? 'Agent mode — Qoders reads only the lines it needs, then proposes changes you can review'
            : 'Chat mode — ask questions. Switch to Agent to edit files.'}
        </div>
      </div>
    </div>
  )
}