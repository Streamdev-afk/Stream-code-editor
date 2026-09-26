import { API_BASE } from './api'
import { apiFetch } from './supabase'

export async function streamEdit({ action, code, selection, language, instruction, model }, onChunk) {
  const res = await apiFetch(`${API_BASE}/api/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, code, selection, language, instruction, model }),
  })

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
      if (data === '[DONE]') return
      try {
        const parsed = JSON.parse(data)
        if (parsed.error) throw new Error(parsed.error)
        if (parsed.text) onChunk(parsed.text)
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e
      }
    }
  }
}

// ---------- Agent (multi-file plan, /api/agent) ----------
export async function streamAgent({ prompt, files, activeFile, history, model }, onChunk) {
  const res = await apiFetch(`${API_BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, files, activeFile, history, model }),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)

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
        if (parsed.error) throw new Error(parsed.error)
        if (parsed.text) {
          full += parsed.text
          onChunk?.(parsed.text, full)
        }
      } catch (e) {
        // ignore partial JSON chunks
      }
    }
  }

  // Parse accumulated JSON, being forgiving about fences and prose
  function extractJSON(str) {
    let s = str.trim()
    if (s.startsWith('```')) {
      s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    }
    const firstBrace = s.indexOf('{')
    const lastBrace = s.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      s = s.slice(firstBrace, lastBrace + 1)
    }
    return JSON.parse(s)
  }

  try {
    return extractJSON(full)
  } catch (e) {
    console.error('Agent raw output:', full)
    throw new Error('AI returned invalid JSON. Try again or rephrase.')
  }
}

export async function updatePreviewSession({ sessionId, files, activeFile }) {
  const res = await apiFetch(`${API_BASE}/api/agent/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, files, activeFile }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchPreviewErrors(sessionId) {
  const res = await apiFetch(`${API_BASE}/api/preview/errors/${sessionId}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.errors || []
}

export async function clearPreviewErrors(sessionId) {
  await apiFetch(`${API_BASE}/api/preview/errors/${sessionId}`, { method: 'DELETE' })
}

export async function diagnose({ sessionId, files, activeFile, errors, originalPrompt, attempt, model }) {
  const res = await apiFetch(`${API_BASE}/api/agent/diagnose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, files, activeFile, errors, originalPrompt, attempt, model }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}