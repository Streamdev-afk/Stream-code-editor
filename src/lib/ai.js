import { getWeb } from './web'
import { buildAppContext, buildMemoryContext } from './appContext'

// Whether the AI may pop up a question when it needs a decision (Settings → AI assistant)
let ASK_OK = true
let RULES = ''
export const setProjectRules = (t) => { RULES = (t || '').slice(0, 6000) }
export const setAskQuestions = (v) => { ASK_OK = v !== false }
export const askQuestionsOn = () => ASK_OK
let FULL = false
export const setFullAccess = (v) => { FULL = !!v }
import { API_BASE } from './api'
import { apiFetch } from './supabase'
import { loadActivePersona } from './team'
import { createShell, runCommand, isReadOnlyCommand } from './shell'
import { remapOps } from './ops'
import { contextForQuery, chunkText } from './codeindex'

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
  const size = () => obs.reduce((n, o) => (o.pinned ? n : n + o.cmd.length + o.output.length), 0)
  while (size() > MAX_OBSERVATION_CHARS) {
    const i = obs.findIndex((o) => !o.pinned)
    if (i < 0 || obs.filter((o) => !o.pinned).length <= 1) break
    obs.splice(i, 1)
  }
}

// True when the user only wants NEW files/folders/pages made (not existing code changed).
// Then the AI must not run terminal commands on the project.
export function isCreationOnly(text, hasImages = false) {
  const t = String(text || '').toLowerCase()
  if (!t.trim()) return false
  const changes = /\b(fix|change|update|edit|modify|refactor|rename|replace|improve|debug|optimi[sz]e|remove|delete|move|bug|error|broken|not working|doesn'?t work|existing|current|already|in (my|the|this) (code|file|project|app)|(add|insert|put) .{0,40}\b(to|into|in) (the|my|this)\b)/.test(t)
  if (changes) return false
  const creates = /\b(create|make|build|generate|design|scaffold|set ?up|write|new)\b/.test(t)
  const things = /\b(file|folder|directory|page|site|website|landing|component|app|project|template|layout|ui|section|game|form|dashboard|portfolio|navbar|footer)\b/.test(t)
  if (creates && things) return true
  // a picture as inspiration with no mention of existing code
  if (hasImages && /\b(inspir\w*|reference|like this|similar|look like|based on|recreate|copy this|clone)\b/.test(t)) return true
  return false
}

async function postStream(path, body, onChunk, _retried = false) {
  try {
    return await postStreamOnce(path, body, onChunk)
  } catch (e) {
    // one automatic retry for transient failures that produced no output
    if (!_retried && /busy|rate limit|formatting|confused|Failed to fetch|NetworkError|network|HTTP 5\d\d|reach the AI/i.test(String(e?.message))) {
      await new Promise((r) => setTimeout(r, 2500))
      return postStream(path, body, onChunk, true)
    }
    throw e
  }
}

async function postStreamOnce(path, body, onChunk) {
  const persona = body.persona !== undefined ? body.persona : await loadActivePersona().catch(() => '')
  const res = await apiFetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, persona, web: getWeb(), allowQuestions: ASK_OK && !FULL, fullAccess: FULL, rules: RULES, appContext: buildAppContext(), memoryContext: buildMemoryContext() }),
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
  return { full, turn, streamError }
}

async function runExplorable(path, args, onChunk, onStatus, kind) {
  // everything except the files and the status callback is passed through to the server as is
  const { files, onStatus: argStatus, ...base } = args
  onStatus = onStatus || argStatus

  const parse = (full, streamError) => {
    try {
      return extractReply(full)
    } catch {
      console.error(`${kind} raw output:`, full)
      // the server told us why it stopped (rate limit, model error...): show that, not "invalid JSON"
      if (streamError) throw new Error(streamError)
      throw Object.assign(new Error(
        kind === 'Plan'
          ? 'The planner could not finish. Try again or rephrase.'
          : kind === 'Step'
            ? 'The step was too long and got cut off. Try again, or ask for one smaller part at a time.'
            : 'The answer was too long and got cut off. Try again, or ask for one smaller part at a time.'
      ), { parseFail: true })
    }
  }

  // new files only: no terminal reading at all, just give the AI the list of names
  if (projectChars(files) > SMALL_PROJECT_CHARS && isCreationOnly(base.prompt || base.originalPrompt, (base.images || []).length > 0)) {
    const { full, streamError } = await postStream(
      path,
      { ...base, explore: true, noShell: true, fileIndex: buildIndex(files), observations: [], lastRound: true },
      onChunk
    )
    return parse(full, streamError)
  }

  // small project: send it all, like before
  if (projectChars(files) <= SMALL_PROJECT_CHARS) {
    const { full, streamError } = await postStream(path, { ...base, files }, onChunk)
    return parse(full, streamError)
  }

  // bigger project: let the AI read only what it needs
  const shell = createShell(files, '/')
  const observations = []
  const index = buildIndex(files)
  let turn = null
  // codebase index: start with the files most relevant to the request already in view
  try {
    const ctx = contextForQuery(files, base.prompt || base.originalPrompt || '', base.activeFile || base.currentFile)
    if (ctx) {
      const body = `Most relevant files (auto-picked from the whole project):\n\n${ctx.text}\n\nSymbols per file:\n${ctx.map}`
      chunkText(body).forEach((c, i) => observations.push({ cmd: `codebase index (${i + 1})`, output: c, pinned: true }))
    }
  } catch { /* index is optional */ }

  for (let round = 0; round <= MAX_SHELL_ROUNDS; round++) {
    const lastRound = round === MAX_SHELL_ROUNDS
    const { full, turn: t, streamError } = await postStream(
      path,
      { ...base, explore: true, fileIndex: index, observations, turn, lastRound },
      onChunk
    )
    turn = t || turn
    const parsed = parse(full, streamError)
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

const remapResult = (args, r) => { if (r && Array.isArray(r.operations)) r.operations = remapOps(args?.files, r.operations); return r }

// Agent mode must edit files. If the reply has no file changes but pastes a lot of code, ask once more, firmly.
const pastedCode = (r) => r && !(r.operations || []).length && !r.ask && /```[\s\S]{200,}```/.test(String(r.explanation || r.text || r.raw || ''))

export async function streamAgent(args, onChunk, onStatus) {
  try {
    const r = await runExplorable('/api/agent', args, onChunk, onStatus, 'Agent')
    if (pastedCode(r)) return remapResult(args, await runExplorable('/api/agent', { ...args, strict: true, forceFiles: true }, onChunk, onStatus, 'Agent'))
    return remapResult(args, r)
  } catch (e) {
    if (!e.parseFail) throw e
    // an answer that could not be read: ask once more, shorter and stricter, before giving up
    return remapResult(args, await runExplorable('/api/agent', { ...args, strict: true, thinking: 'low' }, onChunk, onStatus, 'Agent'))
  }
}

// A plan with no steps is not a plan: ask again (up to 2 more times). If it still fails, the caller works directly instead.
export async function planTask(args, onChunk, onStatus) {
  let last
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await runExplorable('/api/agent/plan', attempt === 0 ? args : { ...args, strict: true }, onChunk, onStatus, 'Plan')
      const steps = Array.isArray(r.steps) ? r.steps.filter((x) => x && typeof x === 'object' && (x.title || x.description) && !/^shell(\.\d+)*$/i.test(String(x.title || '').trim())) : []
      if (!steps.length && !r.ask) throw Object.assign(new Error('The plan came back empty.'), { parseFail: true })
      r.steps = steps.map((x, i) => ({ ...x, id: `s${i + 1}`, title: String(x.title || x.description || `Step ${i + 1}`), description: String(x.description || ''), files: Array.isArray(x.files) ? x.files.filter((f) => typeof f === 'string') : [] }))
      return r
    } catch (e) {
      last = e
      if (!e.parseFail) throw e
    }
  }
  throw Object.assign(last || new Error('No plan'), { planFailed: true })
}

// A step whose answer could not be read is tried again (up to 2 more times) with a stricter, shorter instruction
export async function executeStep(args, onChunk, onStatus) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const a = attempt === 0 ? args : { ...args, strict: true, thinking: 'low' }
      return remapResult(args, await runExplorable('/api/agent/execute-step', a, onChunk, onStatus, 'Step'))
    } catch (e) {
      lastErr = e
      if (!e.parseFail) throw e
    }
  }
  throw lastErr
}

// Helpers the chat panel uses to read the project the same way
export const shouldExplore = (files) => projectChars(files) > SMALL_PROJECT_CHARS
export { buildIndex, runForAI, trimObservations, MAX_SHELL_ROUNDS, postStream }

// Reads a reply that is a small JSON object plus <<<FILE path>>> ... <<<END>>> blocks (old replies with
// content inside the JSON still work). A file block that was cut off is dropped and reported, never half-written.
function extractReply(full) {
  const blocks = []
  let cut = null
  const re = /<<<FILE[ \t]+([^\r\n>]+?)[ \t]*>>>\r?\n?([\s\S]*?)(?:\r?\n)?<<<END>>>/g
  let rest = String(full || '').replace(re, (_m, path, body) => {
    blocks.push({ path: path.trim().replace(/^\.?\//, ''), content: stripFence(body) })
    return ''
  })
  const open = rest.indexOf('<<<FILE')
  if (open !== -1) {
    const m = rest.slice(open).match(/^<<<FILE[ \t]+([^\r\n>]+?)[ \t]*>>>/)
    cut = m ? m[1].trim() : 'a file'
    rest = rest.slice(0, open)
  }
  let parsed
  try {
    parsed = extractJSONLocal(rest)
  } catch (e) {
    if (!blocks.length) throw e
    parsed = { explanation: '', operations: [] }
  }
  const ops = Array.isArray(parsed.operations) ? parsed.operations : []
  const byPath = new Map(blocks.map((b) => [b.path, b.content]))
  for (const op of ops) {
    if (op && (op.type === 'create_file' || op.type === 'write_file') && op.content == null && byPath.has(op.path)) {
      op.content = byPath.get(op.path)
      byPath.delete(op.path)
    }
  }
  // files that came as blocks without being listed in the JSON are still files to write
  for (const [path, content] of byPath) ops.push({ type: 'create_file', path, content })
  parsed.operations = ops.filter((op) => !((op?.type === 'create_file' || op?.type === 'write_file') && op.content == null))
  if (cut) {
    if (!parsed.operations.length) throw Object.assign(new Error('cut off'), { cutOff: true })
    parsed.explanation = `${parsed.explanation || ''}\n\nNote: ${cut} was cut off because the answer got too long, so it was not written. Ask me to do ${cut} again.`.trim()
  }
  return parsed
}

const stripFence = (t) => {
  const m = String(t).match(/^\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```\s*$/)
  return m ? m[1] : String(t)
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

// ---------------------------------------------------------------
// Project digest: a compact, cheap overview of EVERY file (no AI call, no terminal).
// Cached for 30 minutes per project signature so repeated questions cost nothing to build.
// ---------------------------------------------------------------
const DIGEST_TTL = 30 * 60 * 1000
const _digestCache = new Map()

function sig(files) {
  let h = 0
  for (const [p, f] of Object.entries(files || {})) {
    const c = f?.content || ''
    h = (h * 31 + p.length * 7 + c.length + c.charCodeAt(0) + c.charCodeAt(c.length - 1 || 0)) | 0
    for (let i = 0; i < c.length; i += 97) h = (h * 33 + c.charCodeAt(i)) | 0
  }
  return `${Object.keys(files || {}).length}:${h}`
}

function outline(path, c) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  const lines = c.split('\n')
  const keep = []
  const push = (l) => { const t = l.trim(); if (t && keep.length < 24 && !keep.includes(t)) keep.push(t.slice(0, 110)) }
  if (/^(js|jsx|ts|tsx|mjs)$/.test(ext)) {
    for (const l of lines) if (/^\s*(import |export |(async )?function |class |const [A-Z]\w* *=|const \w+ *= *(async )?\(|app\.(get|post|use)|router\.)/.test(l)) push(l)
  } else if (ext === 'css') {
    for (const l of lines) if (/\{\s*$/.test(l) && !/^\s{2,}/.test(l)) push(l.replace(/\{\s*$/, ''))
  } else if (/^(html|htm)$/.test(ext)) {
    for (const l of lines) if (/<(title|h[1-3]|section|header|nav|footer|main|form|script|link|button)\b/i.test(l)) push(l)
  } else if (ext === 'json') {
    push(lines.slice(0, 14).join(' '))
  } else if (ext === 'md') {
    for (const l of lines) if (/^#{1,3} /.test(l)) push(l)
  } else {
    lines.slice(0, 10).forEach(push)
  }
  return keep
}

export function buildDigest(files, activeFile, budget = 12000) {
  const key = `${sig(files)}|${activeFile || ''}|${budget}`
  const hit = _digestCache.get(key)
  if (hit && Date.now() - hit.at < DIGEST_TTL) return hit.text
  const entries = Object.entries(files || {})
    .filter(([p]) => !IGNORED.test(p))
    .sort(([a], [b]) => (a === activeFile ? -1 : b === activeFile ? 1 : a.localeCompare(b)))
    .slice(0, 80)
  const per = Math.max(350, Math.floor(budget / Math.max(entries.length, 1)))
  let out = `Files (${entries.length}):\n` + entries.map(([p, f]) => `- ${p} (${(f?.content || '').split('\n').length} lines)`).join('\n') + '\n'
  for (const [p, f] of entries) {
    const c = f?.content || ''
    const isActive = p === activeFile
    const lim = isActive ? per * 4 : per
    let block
    if (c.length <= lim) block = c
    else {
      const o = outline(p, c).join('\n')
      block = `${c.slice(0, Math.floor(lim * 0.45))}\n… (${c.length - Math.floor(lim * 0.45)} more chars)\nKEY LINES:\n${o}`.slice(0, lim + 600)
    }
    const chunk = `\n=== ${p}${isActive ? ' (open in editor)' : ''} ===\n${block}\n`
    if (out.length + chunk.length > budget * 1.15) { out += `\n(+ more files not shown: ${entries.length - entries.findIndex(([x]) => x === p)} files)\n`; break }
    out += chunk
  }
  if (_digestCache.size > 20) _digestCache.clear()
  _digestCache.set(key, { at: Date.now(), text: out })
  return out
}

// A question ABOUT the project (review, explain, "how does it look") with no request to change anything
export function isOverviewQuestion(text) {
  const t = String(text || '').toLowerCase()
  if (!t.trim()) return false
  const change = /\b(fix|change|update|edit|modify|refactor|rename|replace|add|remove|delete|move|implement|create|make|build|write|install|push|import|run|set|convert|translate|optimi[sz]e)\b/.test(t)
  if (change) return false
  return /\b(look|looks|review|check|explain|understand|overview|summar|how (is|does|do|good)|what (is|does|do|are)|any (error|bug|issue|problem)|opinion|thoughts|feedback|rate|structure|my (file|code|project|app)|this (file|code|project|app))\b/.test(t)
}


// Asks the server for a short plain explanation of changes that were really applied.
export async function summarizeChanges({ originalPrompt, changes, model, behavior, failed = [] }) {
  const persona = await loadActivePersona().catch(() => '')
  const res = await apiFetch(`${API_BASE}/api/agent/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalPrompt, changes, model, behavior, persona, failed }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = await res.json()
  return String(j.text || '')
}
