import { useState, useEffect, useRef } from 'react'
import Icon from './Icon'

const ASK_RE = /\[\[ASK\]\]([\s\S]*?)(?:\[\[\/ASK\]\]|$)/

export function normalizeAsk(a) {
  if (!a || typeof a.question !== 'string' || !a.question.trim()) return null
  const options = Array.isArray(a.options) ? a.options.map((o) => String(o).trim().slice(0, 90)).filter(Boolean).slice(0, 6) : []
  return { question: a.question.trim().slice(0, 300), options, multi: a.multi === true }
}

/** Pulls a [[ASK]]{...}[[/ASK]] block out of a chat reply. Returns the clean text and the question (if valid). */
export function extractAsk(text) {
  const t = String(text || '')
  const m = t.match(ASK_RE)
  if (!m) return { text: t, ask: null }
  let ask = null
  try { ask = normalizeAsk(JSON.parse(m[1].trim())) } catch { /* half-typed or invalid: just hide it */ }
  return { text: t.replace(ASK_RE, '').trim(), ask }
}

/** A small pop-up: the question, a few options, and a box for your own answer. */
export default function AskModal({ ask, onAnswer, onSkip }) {
  const [picked, setPicked] = useState([])
  const [other, setOther] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onSkip() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip])

  const toggle = (o) => {
    if (ask.multi) setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]))
    else onAnswer([o, other.trim()].filter(Boolean).join('. '))
  }
  const parts = [...picked, other.trim()].filter(Boolean)
  const canSend = parts.length > 0

  return (
    <div className="ask-back" onClick={onSkip}>
      <div className="ask-card" role="dialog" aria-label="Question from the AI" onClick={(e) => e.stopPropagation()}>
        <div className="ask-head">
          <span className="ask-badge"><Icon name="chat" size={14} /></span>
          <span className="ask-label">Qoders needs your input</span>
          <button className="ask-x" onClick={onSkip} aria-label="Close"><Icon name="close" size={14} /></button>
        </div>
        <div className="ask-q">{ask.question}</div>
        {ask.options.length > 0 && (
          <div className="ask-options">
            {ask.options.map((o, i) => {
              const on = picked.includes(o)
              return (
                <button key={o} className={`ask-opt ${on ? 'on' : ''}`} style={{ animationDelay: `${i * 45}ms` }} onClick={() => toggle(o)}>
                  <span className={`ask-mark ${ask.multi ? 'box' : 'dot'} ${on ? 'on' : ''}`}>{on && <Icon name="check" size={11} strokeWidth={3} />}</span>
                  <span>{o}</span>
                </button>
              )
            })}
          </div>
        )}
        <div className="ask-other">
          <input
            ref={inputRef}
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSend) onAnswer(parts.join(', ')) }}
            placeholder={ask.options.length ? 'Something else? Type it here' : 'Type your answer'}
          />
        </div>
        <div className="ask-actions">
          <button className="ask-skip" onClick={() => onAnswer('You decide, pick what you think is best.')}>Let the AI decide</button>
          <button className="ask-send" disabled={!canSend} onClick={() => onAnswer(parts.join(', '))}>
            {ask.multi || !ask.options.length || other.trim() ? 'Send' : 'Choose'}
          </button>
        </div>
      </div>
    </div>
  )
}
