import { useState, useRef, useEffect } from 'react'
import { streamAgent, planTask } from '../lib/ai'
import { API_BASE } from '../lib/api'
import { apiFetch } from '../lib/supabase'

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
  testAfterApply,
  onTestToggle,
  planningMode = true,
  // ---- sessions overlay props ----
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

  // If parent supplies messages (session-backed), use those.
  // Otherwise fall back to internal state (backward compat).
  const [localMessages, setLocalMessages] = useState(() => [
    {
      role: 'assistant',
      text: "Hey! I'm Stream. Ask me anything, or switch to Agent mode to make changes to your files.",
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

  const sendChat = async (text) => {
    const userMsg = { role: 'user', text, time: Date.now() }

    // Build the full conversation including the new message
    const newMessages = [...messages, userMsg]

    // Update the session in ONE call so nothing gets overwritten
    setMessages([
      ...newMessages,
      { role: 'assistant', text: '', time: Date.now() },
    ])
    setStreaming(true)

    try {
      const apiMessages = newMessages
        .filter((m) => !(m.role === 'assistant' && m.text.startsWith("Hey! I'm Stream")))
        .map((m) => ({ role: m.role, content: m.text }))

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 60000)

      let res
      try {
        res = await apiFetch(`${API_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: apiMessages, code, language, model, thinking }),
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
              setMessages((m) => {
                const c = [...m]
                c[c.length - 1] = { role: 'assistant', text: `⚠️ ${parsed.error}`, time: Date.now() }
                return c
              })
              continue
            }
            if (parsed.text) {
              setMessages((m) => {
                const c = [...m]
                const last = c[c.length - 1]
                c[c.length - 1] = { ...last, text: last.text + parsed.text }
                return c
              })
            }
          } catch {}
        }
      }
    } catch (err) {
      const msg = err.name === 'AbortError'
        ? 'Request timed out after 60s. Try a shorter question.'
        : err.message
      setMessages((m) => {
        const c = [...m]
        c[c.length - 1] = { role: 'assistant', text: `⚠️ ${msg}`, time: Date.now() }
        return c
      })
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }

  const sendAgent = async (text) => {
    setMessages([
      ...messages,
      { role: 'user', text, time: Date.now() },
      { role: 'assistant', text: 'Analyzing project…', time: Date.now(), _status: true },
    ])
    setStreaming(true)

    try {
      // If planning mode is on, plan first
      if (planningMode && onPlanReady) {
        const planResult = await planTask(
          { prompt: text, files, activeFile, history: messages, model, thinking },
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
  { prompt: text, files, activeFile, history: messages, model, thinking },
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
    if (!input.trim() || streaming) return
    const text = input.trim()
    setInput('')

    // Auto-title on first user message
    const userMsgCount = messages.filter((m) => m.role === 'user').length
    if (userMsgCount === 0 && onFirstMessage) {
      onFirstMessage(text)
    }

    if (mode === 'agent') sendAgent(text)
    else sendChat(text)
  }

  const fmtTime = (t) =>
    new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="aichat">
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
          <label className="test-toggle" title="After applying changes, let Stream open the preview, watch for errors, and auto-fix them">
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
                    {isActive && <div className="aichat-session-active-dot" />}
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
                  <span className="chat-author">{isUser ? 'You' : 'Stream'}</span>
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
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-wrap">
        <div className={`chat-composer mode-${mode}`}>
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={
              streaming ? 'Stream is working...'
                : mode === 'agent' ? 'Tell Stream what to build or change...'
                : 'Ask Stream anything...'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            disabled={streaming}
            rows={2}
          />
          <button
            className="chat-send"
            onClick={send}
            disabled={streaming || !input.trim()}
            title={mode === 'agent' ? 'Plan changes' : 'Send'}
          >
            {streaming ? '⋯' : mode === 'agent' ? '⚡' : '↑'}
          </button>
        </div>
        <div className="chat-hint">
          {mode === 'agent'
            ? 'Agent mode — Stream will propose file changes you can review'
            : 'Chat mode — ask questions. Switch to Agent to edit files.'}
        </div>
      </div>
    </div>
  )
}