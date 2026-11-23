// Background agents: AI tasks that keep running while you work. Each one reads a snapshot of the
// project, proposes changes, and waits. Nothing is applied until you review it.
import { streamAgent } from './ai'

const MAX_RUNNING = 3
let agents = []
let seq = 0
const dismissedIds = new Set()
const subs = new Set()
const emit = () => subs.forEach((f) => f(agents))

export const subscribe = (f) => { subs.add(f); f(agents); return () => subs.delete(f) }
export const list = () => agents
export const runningCount = () => agents.filter((a) => a.status === 'running').length
export const readyCount = () => agents.filter((a) => a.status === 'done' && a.plan).length

function update(id, patch) {
  agents = agents.map((a) => (a.id === id ? { ...a, ...patch } : a))
  emit()
}

export function startAgent({ prompt, files, activeFile, model, thinking, behavior }) {
  const text = String(prompt || '').trim()
  if (!text) throw new Error('Describe the task first')
  if (runningCount() >= MAX_RUNNING) throw new Error(`Only ${MAX_RUNNING} agents can run at once. Wait for one to finish.`)
  const id = ++seq
  const snapshot = JSON.parse(JSON.stringify(files || {}))
  agents = [{ id, prompt: text, status: 'running', hint: 'Starting…', startedAt: Date.now(), plan: null, error: '' }, ...agents].slice(0, 12)
  emit()
  ;(async () => {
    try {
      const plan = await streamAgent(
        { prompt: text, files: snapshot, activeFile, history: [], model, thinking: thinking || 'medium', behavior: behavior || 'friendly', images: [] },
        (_c, full) => update(id, { hint: full.length > 600 ? 'Writing code…' : full.length > 200 ? 'Planning changes…' : 'Reading the project…' }),
        (cmd) => update(id, { hint: `Reading: ${String(cmd).slice(0, 60)}` })
      )
      if (dismissedIds.has(id)) return
      update(id, { status: 'done', plan, hint: '', finishedAt: Date.now() })
      try { window.dispatchEvent(new CustomEvent('qoders-agent-done', { detail: { id } })) } catch { /* ignore */ }
    } catch (e) {
      if (dismissedIds.has(id)) return
      update(id, { status: 'error', error: String(e?.message || e).slice(0, 200), hint: '' })
    }
  })()
  return id
}

export function dismissAgent(id) {
  dismissedIds.add(id)
  agents = agents.filter((a) => a.id !== id)
  emit()
}
