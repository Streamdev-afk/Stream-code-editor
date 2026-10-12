import { API_BASE } from './api'
import { apiFetch } from './supabase'

export async function streamEdit({ action, code, selection, language, instruction, model, thinking }, onChunk) {
  const res = await apiFetch(`${API_BASE}/api/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, code, selection, language, instruction, model, thinking }),
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

export async function streamAgent({ prompt, files, activeFile, history, model, thinking }, onChunk) {
  const res = await apiFetch(`${API_BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, files, activeFile, history, model, thinking }),
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

  try {
    return extractJSONLocal(full)
  } catch (e) {
    console.error('Agent raw output:', full)
    throw new Error('AI returned invalid JSON. Try again or rephrase.')
  }
}

// ---------- Planning mode ----------

export async function planTask({ prompt, files, activeFile, history, model, thinking }, onChunk) {
  const res = await apiFetch(`${API_BASE}/api/agent/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, files, activeFile, history, model, thinking }),
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
      } catch {}
    }
  }

  try {
    return extractJSONLocal(full)
  } catch (e) {
    console.error('Plan raw output:', full)
    throw new Error('Planner returned invalid JSON. Try again or rephrase.')
  }
}

export async function executeStep({ step, plan, allSteps, files, activeFile, model, thinking, originalPrompt }, onChunk) {
  const res = await apiFetch(`${API_BASE}/api/agent/execute-step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step, plan, allSteps, files, activeFile, model, thinking, originalPrompt }),
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
      } catch {}
    }
  }

  try {
    return extractJSONLocal(full)
  } catch (e) {
    console.error('Execute-step raw output:', full)

    // Log the first 500 chars for debugging
    console.error('First 500 chars:', full.slice(0, 500))

    throw new Error('Step execution returned invalid JSON. Retrying...')
  }
}

function extractJSONLocal(str) {
  let s = str.trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  }
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first !== -1 && last > first) s = s.slice(first, last + 1)

  // Try strict parse first
  try {
    return JSON.parse(s)
  } catch (e) {
    // Fallback: try a lenient repair
    const repaired = repairJSON(s)
    return JSON.parse(repaired)
  }
}

/**
 * Attempt to repair common JSON errors from LLMs:
 * - Unescaped newlines inside strings
 * - Trailing commas
 * - Unescaped backslashes
 */
function repairJSON(str) {
  let out = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    const next = str[i + 1]

    if (escaped) {
      out += c
      escaped = false
      continue
    }

    if (c === '\\') {
      out += c
      escaped = true
      continue
    }

    if (c === '"') {
      inString = !inString
      out += c
      continue
    }

    if (inString) {
      // Inside a string — replace raw control chars with escapes
      if (c === '\n') { out += '\\n'; continue }
      if (c === '\r') { out += '\\r'; continue }
      if (c === '\t') { out += '\\t'; continue }
      out += c
      continue
    }

    // Outside a string
    // Remove trailing commas: ,  followed by } or ]
    if (c === ',' && (next === '}' || next === ']')) {
      continue
    }

    out += c
  }

  return out
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