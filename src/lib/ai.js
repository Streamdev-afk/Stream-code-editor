import { API_BASE } from './api'
import { apiFetch } from './supabase'
import { createShell, runCommand, isReadOnlyCommand } from './shell'

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

// ------------------------------------------------------------------
// Agent + planner. Small projects are sent as before. Bigger ones are NOT sent whole:
// the AI gets only a file index and reads exactly the lines it needs by asking for
// read-only terminal commands (grep -rn, sed -n, head ...), which run here in the
// browser. That cuts tokens a lot and stops big files being cut off halfway.
// ------------------------------------------------------------------

const SMALL_PROJECT_CHARS = 6000
const MAX_SHELL_ROUNDS = 4
const MAX_OUTPUT_CHARS = 2500
const MAX_OBSERVATION_CHARS = 9000
const IGNORED = /(^|\/)(node_modules|\.git|dist|build)\/|\.gitkeep$|\.lock$|\.log$|package-lock\.json$/

function projectChars(files) {
  let n = 0
  for (const [p, f] of Object.entries(files || {})) {
    if (!IGNORED.test(p)) n += (f?.content || '').length
  }
  return n
}

function buildIndex(files) {
  return Object.entries(files || {})
    .filter(([p]) => !IGNORED.test(p))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 200)
    .map(([path, f]) => {
      const content = f?.content || ''
      return { path, lines: content ? content.split('\n').length : 0, chars: content.length }
    })
}

function runForAI(shell, cmd) {
  if (!isReadOnlyCommand(cmd)) {
    return 'refused: only read commands are allowed (ls, tree, find, cat, head, tail, sed -n, grep, wc)'
  }
  const out = runCommand(shell, cmd).output || '(no output)'
  return out.length > MAX_OUTPUT_CHARS
    ? out.slice(0, MAX_OUTPUT_CHARS) + `\n…(cut at ${MAX_OUTPUT_CHARS} characters, ask for a narrower range)`
    : out
}

function trimObservations(obs) {
  const size = () => obs.reduce((n, o) => n + o.cmd.length + o.output.length, 0)
  while (size() > MAX_OBSERVATION_CHARS && obs.length > 1) obs.shift()
}

async function postStream(path, body, onChunk) {
  const res = await apiFetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {}
    throw new Error(msg)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let turn = null
  let streamError = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const line of parts) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue
      let parsed
      try { parsed = JSON.parse(data) } catch { continue }
      if (parsed.error) { streamError = parsed.error; continue }
      if (parsed.turn) turn = parsed.turn
      if (parsed.text) {
        full += parsed.text
        onChunk?.(parsed.text, full)
      }
    }
  }
  if (streamError && !full) throw new Error(streamError)
  return { full, turn }
}

async function runExplorable(path, args, onChunk, onStatus, kind) {
  // everything except the files and the status callback is passed through to the server as is
  const { files, onStatus: argStatus, ...base } = args
  onStatus = onStatus || argStatus

  const parse = (full) => {
    try {
      return extractJSONLocal(full)
    } catch {
      console.error(`${kind} raw output:`, full)
      throw new Error(
        kind === 'Plan'
          ? 'Planner returned invalid JSON. Try again or rephrase.'
          : kind === 'Step'
            ? 'Step execution returned invalid JSON. Try again or rephrase.'
            : 'AI returned invalid JSON. Try again or rephrase.'
      )
    }
  }

  // small project: send it all, like before
  if (projectChars(files) <= SMALL_PROJECT_CHARS) {
    const { full } = await postStream(path, { ...base, files }, onChunk)
    return parse(full)
  }

  // bigger project: let the AI read only what it needs
  const shell = createShell(files, '/')
  const observations = []
  const index = buildIndex(files)
  let turn = null

  for (let round = 0; round <= MAX_SHELL_ROUNDS; round++) {
    const lastRound = round === MAX_SHELL_ROUNDS
    const { full, turn: t } = await postStream(
      path,
      { ...base, explore: true, fileIndex: index, observations, turn, lastRound },
      onChunk
    )
    turn = t || turn
    const parsed = parse(full)
    const cmds = Array.isArray(parsed.shell) ? parsed.shell.filter((c) => typeof c === 'string').slice(0, 4) : []
    if (cmds.length && !lastRound) {
      for (const c of cmds) {
        onStatus?.(c)
        observations.push({ cmd: c, output: runForAI(shell, c) })
      }
      trimObservations(observations)
      continue
    }
    return parsed
  }
}

export function streamAgent(args, onChunk, onStatus) {
  return runExplorable('/api/agent', args, onChunk, onStatus, 'Agent')
}

export function planTask(args, onChunk, onStatus) {
  return runExplorable('/api/agent/plan', args, onChunk, onStatus, 'Plan')
}

export function executeStep(args, onChunk, onStatus) {
  return runExplorable('/api/agent/execute-step', args, onChunk, onStatus, 'Step')
}

// Helpers the chat panel uses to read the project the same way
export const shouldExplore = (files) => projectChars(files) > SMALL_PROJECT_CHARS
export { buildIndex, runForAI, trimObservations, MAX_SHELL_ROUNDS }

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