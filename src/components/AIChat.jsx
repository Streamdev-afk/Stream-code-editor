import { useState, useRef, useEffect } from 'react'
import { streamAgent } from '../lib/ai'
import { API_BASE } from '../lib/api'

export default function AIChat({ code, language, files, activeFile, onApplyPlan, model, testAfterApply, onTestToggle }) {
  const [mode, setMode] = useState('chat')
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: "Hey! I'm Stream. Ask me anything, or switch to Agent mode to make changes to your files.",
      time: Date.now(),
    }
  ])
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
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setStreaming(true)
    setMessages((m) => [...m, { role: 'assistant', text: '', time: Date.now() }])

    try {
      const apiMessages = newMessages
        .filter((m) => !(m.role === 'assistant' && m.text.startsWith("Hey! I'm Stream")))
        .map((m) => ({ role: m.role, content: m.text }))

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 60000)

      let res
      try {
        res = await fetch(`${API_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: apiMessages, code, language, model }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

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
    setMessages((m) => [...m,
      { role: 'user', text, time: Date.now() },
      { role: 'assistant', text: 'Analyzing project…', time: Date.now(), _status: true },
    ])
    setStreaming(true)

    try {
      const plan = await streamAgent(
  { prompt: text, files, activeFile, history: messages, model },
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
    if (mode === 'agent') sendAgent(text)
    else sendChat(text)
  }

  const fmtTime = (t) =>
    new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="aichat">
            <div className="panel-header aichat-header">
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