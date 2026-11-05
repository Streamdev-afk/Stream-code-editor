import { API_BASE } from './api'
import { apiFetch } from './supabase'

export async function streamEdit({ action, code, selection, language, instruction, model, thinking, behavior }, onChunk) {
  const res = await apiFetch(`${API_BASE}/api/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, code, selection, language, instruction, model, thinking, behavior }),
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

export async function streamAgent({ prompt, files, activeFile, history, model, thinking, behavior }, onChunk) {
  const res = await apiFetch(`${API_BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, files, activeFile, history, model, thinking, behavior }),
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

export async function planTask({ prompt, files, activeFile, history, model, thinking, behavior }, onChunk) {
  const res = await apiFetch(`${API_BASE}/api/agent/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, files, activeFile, history, model, thinking, behavior }),
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

export async function executeStep({ step, plan, allSteps, files, activeFile, model, thinking, originalPrompt, behavior }, onChunk) {
  const res = await apiFetch(`${API_BASE}/api/agent/execute-step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step, plan, allSteps, files, activeFile, model, thinking, originalPrompt, behavior }),
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
    console.error('First 500 chars:', full.slice(0, 500))
    throw new Error('Step execution returned invalid JSON. Try again or rephrase.')
  }
}

function extractJSONLocal(str) {
  let s = str.trim()
  if (!s) throw new Error('Empty response')

  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  }

  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first === -1 || last <= first) {
    throw new Error('No JSON object found in response')
  }
  s = s.slice(first, last + 1)

  let parsed
  try {
    parsed = JSON.parse(s)
  } catch (e) {
    const repaired = repairJSON(s)
    parsed = JSON.parse(repaired)
  }

  return sanitizeParsedResult(parsed)
}

/**
 * Walks a parsed result object and un-escapes literal \n \r \t \" that
 * slipped through as actual characters in file contents.
 */
function sanitizeParsedResult(obj) {
  if (!obj || typeof obj !== 'object') return obj

  if (Array.isArray(obj.operations)) {
    obj.operations = obj.operations.map((op) => {
      if (!op || typeof op !== 'object') return op
      if (typeof op.content === 'string') {
        op = { ...op, content: unescapeContent(op.content) }
      }
      return op
    })
  }

  return obj
}

/**
 * If a string contains LITERAL \n sequences (backslash + n as two chars),
 * replace them with real newlines. Same for \r \t and \".
 * Safe: only runs if the string contains those literal patterns AND
 * does NOT already contain real newlines in the same abundance.
 */
function unescapeContent(str) {
  if (typeof str !== 'string') return str
  if (!str) return str

  // Check if the string has literal backslash sequences
  const hasLiteralEscapes = /\\[nrt"\\]/.test(str)
  if (!hasLiteralEscapes) return str

  // Count real newlines vs literal \n
  const realNewlines = (str.match(/\n/g) || []).length
  const literalEscapes = (str.match(/\\n/g) || []).length

  // If the string has way more literal \n than real newlines,
  // it probably needs unescaping.
  if (literalEscapes > realNewlines) {
    try {
      return str
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
    } catch {
      return str
    }
  }

  return str
}

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
      if (c === '\n') { out += '\\n'; continue }
      if (c === '\r') { out += '\\r'; continue }
      if (c === '\t') { out += '\\t'; continue }
      out += c
      continue
    }

    if (c === ',' && (next === '}' || next === ']')) {
      continue
    }

    out += c
  }

  return out
}

export async function searchWeb(query, maxResults = 5) {
  const res = await apiFetch(`${API_BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, maxResults }),
  })
  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`)
  return res.json()
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