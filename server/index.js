import './env.js'
import express from 'express'
import cors from 'cors'
import Groq from 'groq-sdk'
import crypto from 'crypto'
import path from 'path'
import * as esbuild from 'esbuild'
import { attachUser } from './auth.js'
import { checkLimit, recordUsage, getUsage, THINKING_MULTIPLIERS } from './usage.js'
import {
  initializeTransaction,
  disableSubscription,
  verifyWebhookSignature,
  isConfigured as paystackConfigured,
} from './paystack.js'
import {
  getSubscription,
  upsertSubscription,
  cancelSubscription,
  isConfigured as subsConfigured,
} from './subscriptions.js'

const app = express()

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  process.env.FRONTEND_URL,
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (origin.endsWith('.vercel.app')) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    return callback(null, true)
  },
  credentials: true,
}))

app.use((req, res, next) => {
  if (req.path === '/api/paystack/webhook') return next()
  return express.json()(req, res, next)
})

app.use(attachUser)

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
  timeout: 300000,
  maxRetries: 1,
})

// ============================================================
// AI BEHAVIORAL MODES
// ============================================================
const BEHAVIORAL_MODES = {
  professional: {
    label: 'Professional',
    prefix: 'Tone: Direct, efficient, business-like. Skip pleasantries. Get to the point.',
  },
  friendly: {
    label: 'Friendly',
    prefix: 'Tone: Warm, encouraging, casual. Use natural language, occasional light humor. Celebrate progress. Still be accurate and honest.',
  },
  teacher: {
    label: 'Teacher',
    prefix: 'Tone: Patient, thorough, explanatory. Explain WHY not just what. Assume the user is learning. Prefer clarity over brevity.',
  },
  concise: {
    label: 'Concise',
    prefix: 'Tone: Maximum brevity. Shortest accurate answer. No preamble, no filler.',
  },
  creative: {
    label: 'Creative',
    prefix: 'Tone: Curious, exploratory, suggestive. Offer multiple approaches. Highlight tradeoffs. Playful with names but technically rigorous.',
  },
}

function getBehavioralPrefix(mode) {
  const m = BEHAVIORAL_MODES[mode] || BEHAVIORAL_MODES.friendly
  return `\n\n## BEHAVIORAL MODE — ${m.label}\n${m.prefix}\n`
}

// ------------------------------------------------------------
// Retry wrapper
// ------------------------------------------------------------
async function callGroqWithRetry(params, maxAttempts = 3) {
  let lastErr
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await groq.chat.completions.create(params)
    } catch (err) {
      lastErr = err
      const isRetryable =
        err.status === 429 || err.status === 500 || err.status === 502 || err.status === 503 ||
        err.message?.includes('validate JSON') || err.message?.includes('rate_limit')
      if (!isRetryable || attempt === maxAttempts) throw err
      const retryAfter = err.headers?.['retry-after']
        ? parseInt(err.headers['retry-after']) * 1000
        : 1500 * attempt
      console.log(`[ai] attempt ${attempt} failed, retrying in ${retryAfter}ms`)
      await new Promise((r) => setTimeout(r, retryAfter))
    }
  }
  throw lastErr
}

const esbuildReady = true
console.log('✅ esbuild ready')

// ============================================================
// STATE
// ============================================================
const previewSessions = new Map()
const previewErrors = new Map()
const bundleCache = new Map()
const BUNDLE_CACHE_MS = 10 * 1000

setInterval(() => {
  const now = Date.now()
  for (const [id, session] of previewSessions.entries()) {
    if (now - session.updatedAt > 2 * 60 * 60 * 1000) previewSessions.delete(id)
  }
}, 5 * 60 * 1000)

// ============================================================
// HELPERS
// ============================================================
function buildConsoleShim(sessionId) {
  const sessionJson = JSON.stringify(sessionId || '')
  return [
    '(function() {',
    '  var SESSION = ' + sessionJson + ';',
    '  var send = function(level, args) {',
    '    try {',
    '      fetch("/api/preview/log", { method: "POST", headers: { "Content-Type": "application/json" },',
    '        body: JSON.stringify({ sessionId: SESSION, level: level,',
    '          text: args.map(function(a) { try { return typeof a === "string" ? a : JSON.stringify(a) } catch (e) { return String(a) } }).join(" ") })',
    '      }).catch(function() {})',
    '    } catch (e) {}',
    '  };',
    '  var origLog = console.log; var origErr = console.error; var origWarn = console.warn;',
    '  console.log = function() { send("log", Array.prototype.slice.call(arguments)); origLog.apply(console, arguments); };',
    '  console.error = function() { send("error", Array.prototype.slice.call(arguments)); origErr.apply(console, arguments); };',
    '  console.warn = function() { send("warn", Array.prototype.slice.call(arguments)); origWarn.apply(console, arguments); };',
    '  window.onerror = function(msg, src, line, col, err) { send("error", [msg + " (line " + line + ")"]) };',
    '  window.addEventListener("unhandledrejection", function(e) {',
    '    send("error", ["Unhandled promise rejection: " + (e.reason && e.reason.message || e.reason)])',
    '  });',
    '})()',
  ].join('\n')
}

function rewriteHtmlPaths(html, sessionId) {
  const prefix = `/preview/${sessionId}`
  html = html.replace(
    /(<link[^>]+href=["'])(?!https?:|\/\/|#|data:)([^"']+)(["'])/gi,
    (m, before, url, after) => `${before}${prefix}/${url.startsWith('/') ? url.slice(1) : url}${after}`
  )
  html = html.replace(
    /(<script[^>]+src=["'])(?!https?:|\/\/)([^"']+)(["'])/gi,
    (m, before, url, after) => {
      const clean = url.startsWith('/') ? url.slice(1) : url
      if (/\.(jsx?|tsx?|mjs)$/i.test(clean)) return `${before}${prefix}/bundle/${clean}${after}`
      return `${before}${prefix}/${clean}${after}`
    }
  )
  html = html.replace(
    /(<img[^>]+src=["'])(?!https?:|\/\/|data:)([^"']+)(["'])/gi,
    (m, before, url, after) => `${before}${prefix}/${url.startsWith('/') ? url.slice(1) : url}${after}`
  )
  return html
}

function stripViteInjections(html) {
  return html
    .replace(/<script[^>]*src=["'][^"']*@vite\/client[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script[^>]*src=["'][^"']*@react-refresh[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script[^>]*type=["']module["'][^>]*src=["'][^"']*\/src\/main\.[jt]sx?[^"']*["'][^>]*>\s*<\/script>/gi, '')
}

function buildPreviewHtml(files, activeFile, sessionId) {
  let htmlPath = null
  if (activeFile && files[activeFile] && activeFile.endsWith('.html')) htmlPath = activeFile
  if (!htmlPath) {
    htmlPath =
      Object.keys(files).find((p) => p === 'public/index.html') ||
      Object.keys(files).find((p) => p === 'index.html') ||
      Object.keys(files).find((p) => p.endsWith('.html'))
  }
  let html = htmlPath
    ? files[htmlPath].content
    : `<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>`
  html = stripViteInjections(html)
  html = rewriteHtmlPaths(html, sessionId)
  const shim = buildConsoleShim(sessionId)
  html = html.includes('</head>')
    ? html.replace('</head>', `<script>${shim}</script></head>`)
    : `<script>${shim}</script>${html}`
  return html
}

// ============================================================
// AI ENDPOINTS
// ============================================================

app.post('/api/chat', async (req, res) => {
  const { messages, code, language, model, thinking, behavior } = req.body
  const thinkingCost = THINKING_MULTIPLIERS[thinking] || THINKING_MULTIPLIERS.medium
  const limit = await checkLimit(req, thinkingCost)
  if (!limit.allowed) return res.status(429).json({ error: limit.message, tier: limit.tier })
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' })

  const behavioralSuffix = getBehavioralPrefix(behavior)
  const systemPrompt = `You are Stream, a coding assistant inside a browser-based editor.

## WHAT YOU DO
- Answer questions about code, explain concepts, help plan.
- If they ask you to build/change code, say: "Switch to Agent mode — I'll write it into your editor so you can review."
- Don't dump full files. Short snippets only (2-5 lines).

## TONE
Concise. Use \`code\` for identifiers. Honest if their code is buggy.

${language ? `## CURRENT FILE\nLanguage: ${language}` : ''}
${code ? `\n\`\`\`${language || ''}\n${code}\n\`\`\`` : ''}${behavioralSuffix}`

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await callGroqWithRetry({
      model: model || 'openai/gpt-oss-20b',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: true,
      temperature: 0.6,
      max_tokens: thinking === 'ultra' ? 4096 : thinking === 'high' ? 3072 : 2048,
    })
    let totalChars = 0
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) { totalChars += text.length; res.write(`data: ${JSON.stringify({ text })}\n\n`) }
    }
    if (totalChars === 0) res.write(`data: ${JSON.stringify({ error: 'AI returned empty response.' })}\n\n`)
    res.write('data: [DONE]\n\n')
    recordUsage(req, thinkingCost)
    res.end()
  } catch (err) {
    console.error('Chat error:', err)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

app.post('/api/edit', async (req, res) => {
  const { action, code, selection, language, instruction, model, thinking } = req.body
  const thinkingCost = THINKING_MULTIPLIERS[thinking] || THINKING_MULTIPLIERS.medium
  const limit = await checkLimit(req, thinkingCost)
  if (!limit.allowed) return res.status(429).json({ error: limit.message, tier: limit.tier })
  if (!action) return res.status(400).json({ error: 'action required' })

  const SYSTEM = `You are a code transformer. Return ONLY the resulting code. No prose. No fences. Preserve style exactly.`

  const prompts = {
    complete: `Complete this ${language} code. Return the FULL file.\n\n${code}`,
    fix: `Fix bugs in this ${language} code. Return the FULL corrected file.\n\n${code}`,
    refactor: `Refactor this ${language} code. Preserve behavior. Return the FULL refactored file.\n\n${code}`,
    comment: `Add comments to this ${language} code. Don't change logic.\n\n${code}`,
    explain: `Explain this ${language} code in max 3 short paragraphs.\n\n${code}`,
    custom: `Task: ${instruction}\n\nReturn the FULL modified ${language} file.\n\n${code}`,
    selection: selection && selection.trim()
      ? `Snippet from a ${language} file. Task: ${instruction || 'improve'}. Return ONLY the improved snippet.\n\n${selection}`
      : `Task: ${instruction || 'improve'}. Return the FULL ${language} file.\n\n${code || ''}`,
  }

  const userPrompt = prompts[action]
  if (!userPrompt) return res.status(400).json({ error: `unknown action: ${action}` })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await callGroqWithRetry({
      model: model || 'openai/gpt-oss-20b',
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt }],
      stream: true,
      temperature: 0.3,
      max_tokens: 4096,
    })
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`)
    }
    res.write('data: [DONE]\n\n')
    recordUsage(req, thinkingCost)
    res.end()
  } catch (err) {
    console.error('Edit error:', err)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

app.post('/api/agent', async (req, res) => {
  const { prompt, files, activeFile, history, model, thinking, behavior } = req.body
  const thinkingCost = THINKING_MULTIPLIERS[thinking] || THINKING_MULTIPLIERS.medium
  const limit = await checkLimit(req, thinkingCost)
  if (!limit.allowed) return res.status(429).json({ error: limit.message, tier: limit.tier })
  if (!prompt) return res.status(400).json({ error: 'prompt required' })

  const MAX_FILE_CHARS = 2000
  const MAX_TOTAL_CHARS = 8000

  const fileList = Object.entries(files || {})
    .filter(([p]) => !p.endsWith('.gitkeep') && !p.endsWith('.lock') && !p.endsWith('.log') && !p.startsWith('node_modules/'))
    .map(([p, f]) => {
      const content = (f.content || '').slice(0, MAX_FILE_CHARS)
      const truncated = (f.content || '').length > MAX_FILE_CHARS ? '\n…(truncated)' : ''
      return `--- ${p} ---\n${content}${truncated}`
    })
    .join('\n\n')
    .slice(0, MAX_TOTAL_CHARS)

  const SYSTEM = `You are Stream Agent, an autonomous coding agent.

You respond with ONLY a JSON object:

{
  "explanation": "one-line summary",
  "plan": ["step 1", "step 2"],
  "operations": [
    { "type": "create_file", "path": "src/New.jsx", "content": "..." },
    { "type": "write_file",  "path": "src/App.jsx", "content": "..." },
    { "type": "delete_file", "path": "src/Old.jsx" }
  ]
}

No markdown, no fences, no prose outside JSON.

## RULES
- Paths relative to project root ("src/App.jsx").
- FULL file content for write_file / create_file.
- Prefer editing existing files over creating new ones.
- No placeholders, no fake names.

## HTML + REACT RULES
Preview supports JSX/TS/React via esbuild.

Allowed: <script type="module" src="app.jsx"></script>, plain <script src="app.js"></script>, <link rel="stylesheet" href="styles.css">
NOT allowed: /@vite/client, /@react-refresh, absolute paths starting /src/ or /public/

For React:
- import React from 'https://esm.sh/react@18'
- import { createRoot } from 'https://esm.sh/react-dom@18/client'
- NEVER bare imports like import React from 'react'
- JSX in .jsx files. Entry: HTML with <div id="root"></div> + <script type="module" src="main.jsx"></script>${getBehavioralPrefix(behavior)}`

  const conversation = Array.isArray(history)
    ? history.slice(-20).map((m) => ({ role: m.role, content: m.text || m.content || '' }))
    : []

  const USER = `Project files:\n\n${fileList}\n\n${activeFile ? `User's open file: ${activeFile}\n` : ''}User request: ${prompt}`
  conversation.push({ role: 'user', content: USER })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await callGroqWithRetry({
      model: model || 'openai/gpt-oss-20b',
      messages: [{ role: 'system', content: SYSTEM }, ...conversation],
      stream: true,
      temperature: 0.2,
      max_tokens: thinking === 'ultra' ? 8000 : thinking === 'high' ? 6000 : 4096,
      reasoning_effort: thinking === 'ultra' || thinking === 'high' ? 'high' : thinking === 'low' ? 'low' : 'medium',
      response_format: { type: 'json_object' },
    })
    let totalChars = 0
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) { totalChars += text.length; res.write(`data: ${JSON.stringify({ text })}\n\n`) }
    }
    if (totalChars === 0) res.write(`data: ${JSON.stringify({ error: 'AI returned empty response.' })}\n\n`)
    res.write('data: [DONE]\n\n')
    recordUsage(req, thinkingCost)
    res.end()
  } catch (err) {
    console.error('Agent error:', err)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

app.post('/api/agent/plan', async (req, res) => {
  const { prompt, files, activeFile, history, model, thinking, behavior } = req.body
  const thinkingCost = THINKING_MULTIPLIERS[thinking] || THINKING_MULTIPLIERS.medium
  const limit = await checkLimit(req, thinkingCost)
  if (!limit.allowed) return res.status(429).json({ error: limit.message, tier: limit.tier })
  if (!prompt) return res.status(400).json({ error: 'prompt required' })

  const MAX_FILE_CHARS = 1000
  const MAX_TOTAL_CHARS = 3000

  const fileList = Object.entries(files || {})
    .filter(([p]) => !p.endsWith('.gitkeep') && !p.endsWith('.lock') && !p.endsWith('.log') && !p.startsWith('node_modules/'))
    .map(([p, f]) => {
      const content = (f.content || '').slice(0, MAX_FILE_CHARS)
      const truncated = (f.content || '').length > MAX_FILE_CHARS ? '\n…(truncated)' : ''
      return `--- ${p} ---\n${content}${truncated}`
    })
    .join('\n\n')
    .slice(0, MAX_TOTAL_CHARS)

  const SYSTEM = `You are Stream Planner, an expert software architect.

Produce a STEP-BY-STEP PLAN. Do NOT write code. ONLY plan.

Respond with ONLY a JSON object:

{
  "title": "Short title",
  "summary": "1-2 sentence overview",
  "estimatedFiles": 5,
  "steps": [
    { "id": 1, "title": "Create index.html", "description": "One sentence", "files": ["index.html"] }
  ]
}

## RULES
- 3-8 steps. Each step produces 1-3 files.
- Group related files into one step.
- Order: foundational → structure → logic.
- Steps must be small enough to fit ~4k tokens of code.
- Every file appears in exactly ONE step.
- No "review" or "test" step.

## CONTEXT
If files already exist, plan to EDIT them, not recreate them.

## TECHNOLOGY
Preview supports HTML/CSS/JS + React (via https://esm.sh/react@18 CDN imports).
- Simple sites → plain HTML/CSS/JS
- Interactive apps → React with CDN imports
- Games/3D → canvas/WebGL or Three.js from CDN

No markdown. No fences. No prose outside JSON.${getBehavioralPrefix(behavior)}`

  const conversation = Array.isArray(history)
    ? history.slice(-10).map((m) => ({ role: m.role, content: m.text || m.content || '' }))
    : []

  const USER = `Project files:\n\n${fileList}\n\n${activeFile ? `User's open file: ${activeFile}\n` : ''}User request: ${prompt}`
  conversation.push({ role: 'user', content: USER })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await callGroqWithRetry({
      model: model || 'openai/gpt-oss-20b',
      messages: [{ role: 'system', content: SYSTEM }, ...conversation],
      stream: true,
      temperature: 0.2,
      max_tokens: 2500,
      reasoning_effort: thinking === 'ultra' || thinking === 'high' ? 'high' : 'medium',
      response_format: { type: 'json_object' },
    })
    let totalChars = 0
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) { totalChars += text.length; res.write(`data: ${JSON.stringify({ text })}\n\n`) }
    }
    if (totalChars === 0) res.write(`data: ${JSON.stringify({ error: 'AI returned empty plan.' })}\n\n`)
    res.write('data: [DONE]\n\n')
    recordUsage(req, thinkingCost)
    res.end()
  } catch (err) {
    console.error('Plan error:', err)
    const msg = err.message?.includes('validate JSON')
      ? 'AI had trouble formatting the plan. Try again or rephrase.'
      : err.message || 'Planning failed'
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`)
    res.end()
  }
})

app.post('/api/agent/test', async (req, res) => {
  const { sessionId, files, activeFile } = req.body
  if (!sessionId || !files) return res.status(400).json({ error: 'sessionId and files required' })
  previewSessions.set(sessionId, { files, activeFile, updatedAt: Date.now() })
  previewErrors.set(sessionId, [])
  res.json({ ok: true, previewUrl: `/preview/${sessionId}` })
})

app.post('/api/agent/execute-step', async (req, res) => {
  const { step, plan, allSteps, files, activeFile, model, thinking, originalPrompt, behavior } = req.body
  const thinkingCost = THINKING_MULTIPLIERS[thinking] || THINKING_MULTIPLIERS.medium
  const limit = await checkLimit(req, thinkingCost)
  if (!limit.allowed) return res.status(429).json({ error: limit.message, tier: limit.tier })
  if (!step) return res.status(400).json({ error: 'step required' })

  const stepText = `${step.title} ${step.description} ${(step.files || []).join(' ')}`
  const stepComplexity = stepText.length
  const MAX_FILE_CHARS = stepComplexity > 200 ? 800 : 2000
  const MAX_TOTAL_CHARS = stepComplexity > 200 ? 2500 : 5000

  const fileList = Object.entries(files || {})
    .filter(([p]) => !p.endsWith('.gitkeep') && !p.endsWith('.lock') && !p.endsWith('.log') && !p.startsWith('node_modules/'))
    .map(([p, f]) => {
      const content = (f.content || '').slice(0, MAX_FILE_CHARS)
      const truncated = (f.content || '').length > MAX_FILE_CHARS ? '\n…(truncated)' : ''
      return `--- ${p} ---\n${content}${truncated}`
    })
    .join('\n\n')
    .slice(0, MAX_TOTAL_CHARS)

  const stepsSummary = Array.isArray(allSteps)
    ? allSteps.map((s) => `${s.id}. ${s.title} — ${s.description}`).join('\n')
    : ''

  const SYSTEM = `You are Stream Agent executing ONE STEP of a multi-step plan.

## THE FULL PLAN
${stepsSummary}

## YOUR CURRENT STEP
Step ${step.id}: ${step.title}
Description: ${step.description}
Files to produce: ${(step.files || []).join(', ')}

## YOUR JOB
Execute ONLY this step. Produce the files listed.

Respond with ONLY a JSON object:

{
  "explanation": "one-line summary",
  "operations": [
    { "type": "create_file", "path": "index.html", "content": "..." },
    { "type": "write_file",  "path": "styles.css", "content": "..." }
  ]
}

## RULES
- FULL file content for create_file / write_file. No snippets, no diffs.
- Match existing style and language.
- No placeholders, no "// TODO", no fake names.

## JSON ESCAPING — CRITICAL
- Newlines in content strings must be \\n (backslash-n), not literal newlines.
- Double quotes in content strings must be \\" (backslash-quote).
- Backslashes must be \\\\ (double backslash).
- No trailing commas.
- Never write literal "\\n" as text inside your generated code — it must be actual content.

## HTML + REACT RULES
Allowed in HTML: <script type="module" src="app.jsx"></script>, plain <script src="app.js"></script>.
NOT allowed: /@vite/client, /@react-refresh, absolute paths /src/ or /public/.

For React:
- import React from 'https://esm.sh/react@18'
- import { createRoot } from 'https://esm.sh/react-dom@18/client'
- NEVER use bare imports.
- JSX in .jsx files. HTML entry: <div id="root"></div> + <script type="module" src="main.jsx"></script>

No markdown. No fences. No prose outside JSON.${getBehavioralPrefix(behavior)}`

  const USER = `Original user request: ${originalPrompt || '(unknown)'}

Current project files:

${fileList}

${activeFile ? `User's open file: ${activeFile}\n` : ''}

Execute step ${step.id} only.`

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await callGroqWithRetry({
      model: model || 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER },
      ],
      stream: true,
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    })
    let totalChars = 0
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) { totalChars += text.length; res.write(`data: ${JSON.stringify({ text })}\n\n`) }
    }
    if (totalChars === 0) res.write(`data: ${JSON.stringify({ error: 'AI returned empty response. Try a simpler step.' })}\n\n`)
    res.write('data: [DONE]\n\n')
    recordUsage(req, thinkingCost)
    res.end()
  } catch (err) {
    console.error('Execute-step error:', err)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

app.post('/api/agent/diagnose', async (req, res) => {
  const { sessionId, files, activeFile, errors, originalPrompt, attempt, model } = req.body
  if (!files) return res.status(400).json({ error: 'files required' })

  const errorList = Array.isArray(errors) && errors.length > 0
    ? errors.map((e) => `[${e.level}] ${e.text}`).join('\n')
    : '(no console errors)'

  const fileList = Object.entries(files || {})
    .filter(([p]) => !p.endsWith('.gitkeep') && !p.endsWith('.log'))
    .map(([p, f]) => `--- ${p} ---\n${(f.content || '').slice(0, 2000)}`)
    .join('\n\n')
    .slice(0, 5000)

  const SYSTEM = `You are Stream Agent in TEST mode.

User asked: "${originalPrompt || '?'}"

Console output:
${errorList}

Decide:
- Fine → { "status": "ok", "summary": "short message" }
- Broken → { "status": "fix", "summary": "what's wrong", "operations": [...] }

Only fix REAL errors. console.log is not an error. Respond with ONLY JSON.`

  const USER = `Attempt ${attempt || 1}.

${fileList}

Console:
${errorList}`

  try {
    const completion = await callGroqWithRetry({
      model: model || 'openai/gpt-oss-20b',
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }],
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    })
    const raw = completion.choices[0]?.message?.content || '{}'
    let parsed
    try { parsed = JSON.parse(raw) } catch {
      return res.json({ status: 'ok', summary: 'Could not parse diagnosis; assuming OK.' })
    }
    res.json(parsed)
  } catch (err) {
    console.error('Diagnose error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ============================================================
// BUNDLER
// ============================================================
app.get('/api/preview/bundle/:id/*entry', async (req, res) => {
  const sessionId = req.params.id
  const rawEntry = req.params.entry
  const entry = Array.isArray(rawEntry) ? rawEntry.join('/') : (rawEntry || '')

  const session = previewSessions.get(sessionId)
  if (!session) return res.status(404).send('/* session not found */')
  if (!esbuildReady) return res.status(503).send('/* bundler not ready */')

  const cacheKey = `${sessionId}:${entry}`
  const cached = bundleCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < BUNDLE_CACHE_MS) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    return res.send(cached.code)
  }

  const candidates = [entry, `src/${entry}`, `public/${entry}`]
  let resolvedEntry = null
  for (const c of candidates) {
    if (session.files[c]) { resolvedEntry = c; break }
  }
  if (!resolvedEntry) return res.status(404).send(`/* entry not found: ${entry} */`)

  const sessionFiles = session.files

  try {
    const entryNorm = resolvedEntry

    const plugin = {
      name: 'session-files',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') return { path: entryNorm, namespace: 'session' }
          if (!args.path.startsWith('.') && !args.path.startsWith('/')) {
            return { path: args.path, external: true }
          }
          let resolved
          if (args.path.startsWith('/')) resolved = args.path.slice(1)
          else {
            const dir = args.importer ? path.dirname(args.importer) : '.'
            resolved = path.posix.normalize(path.posix.join(dir, args.path))
          }
          const tries = [
            resolved,
            `${resolved}.js`, `${resolved}.jsx`, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.mjs`,
            `${resolved}/index.js`, `${resolved}/index.jsx`, `${resolved}/index.ts`,
          ]
          for (const t of tries) {
            if (sessionFiles[t]) return { path: t, namespace: 'session' }
          }
          return { path: resolved, namespace: 'session' }
        })
        build.onLoad({ filter: /.*/, namespace: 'session' }, (args) => {
          const file = sessionFiles[args.path]
          if (!file) return { errors: [{ text: `File not found: ${args.path}` }] }
          const ext = args.path.split('.').pop()?.toLowerCase()
          const loaders = { js: 'jsx', jsx: 'jsx', ts: 'ts', tsx: 'tsx', css: 'css', json: 'json' }
          return { contents: file.content || '', loader: loaders[ext] || 'jsx', resolveDir: '/' }
        })
      },
    }

    const result = await esbuild.build({
      entryPoints: [entryNorm],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: ['es2020'],
      jsx: 'automatic',
      plugins: [plugin],
      define: { 'process.env.NODE_ENV': '"production"' },
      minify: false,
      sourcemap: false,
      logLevel: 'silent',
    })

    const code = result.outputFiles[0].text
    bundleCache.set(cacheKey, { code, timestamp: Date.now() })

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.send(code)
  } catch (err) {
    console.error('Bundle error:', err.message)
    const errors = err.errors?.map((e) => e.text).join('\n') || err.message
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.send(`/* Bundle error:\n${errors}\n*/`)
  }
})

// ============================================================
// PREVIEW
// ============================================================
app.post('/api/preview/session', (req, res) => {
  const { sessionId, files, activeFile } = req.body
  if (!files || typeof files !== 'object') return res.status(400).json({ error: 'files required' })
  let id = sessionId
  if (!id || !previewSessions.has(id)) id = crypto.randomBytes(8).toString('hex')
  previewSessions.set(id, { files, activeFile, updatedAt: Date.now() })
  res.json({ sessionId: id, url: `/preview/${id}` })
})

app.post('/api/preview/log', (req, res) => {
  const { sessionId, level, text } = req.body
  if (!sessionId) return res.json({ ok: true })
  const arr = previewErrors.get(sessionId) || []
  arr.push({ level, text, time: Date.now() })
  if (arr.length > 100) arr.shift()
  previewErrors.set(sessionId, arr)
  res.json({ ok: true })
})

app.get('/api/preview/errors/:id', (req, res) => {
  res.json({ errors: previewErrors.get(req.params.id) || [] })
})

app.delete('/api/preview/errors/:id', (req, res) => {
  previewErrors.delete(req.params.id)
  res.json({ ok: true })
})

app.get('/preview/:id', (req, res) => {
  const session = previewSessions.get(req.params.id)
  if (!session) {
    return res.status(404).send(`<html><body style="background:#0d1117;color:#e6edf3;font-family:sans-serif;padding:40px;text-align:center"><h1>Session not found</h1></body></html>`)
  }
  const html = buildPreviewHtml(session.files, session.activeFile, req.params.id)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.send(html)
})

app.get('/preview/:id/bundle/*entry', (req, res) => {
  const rawEntry = req.params.entry
  const entry = Array.isArray(rawEntry) ? rawEntry.join('/') : (rawEntry || '')
  res.redirect(307, `/api/preview/bundle/${req.params.id}/${entry}`)
})

app.get('/preview/:id/*filePath', (req, res) => {
  const session = previewSessions.get(req.params.id)
  if (!session) return res.status(404).send('Session not found')
  const rawPath = req.params.filePath
  const filePath = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '')
  if (!filePath) return res.status(404).send('File not found')

  const candidates = [filePath, `public/${filePath}`, `src/${filePath}`, `src/styles/${filePath}`]
  let file = null
  for (const c of candidates) if (session.files[c]) { file = session.files[c]; break }
  if (!file) {
    const stripped = filePath.replace(/^(public|src)\//, '')
    if (session.files[stripped]) file = session.files[stripped]
  }
  if (!file) {
    const name = filePath.split('/').pop()
    const key = Object.keys(session.files).find((p) => p.split('/').pop() === name)
    if (key) file = session.files[key]
  }
  if (!file) return res.status(404).send(`File not found: ${filePath}`)

  const ext = filePath.split('.').pop()?.toLowerCase()
  if (['js', 'jsx', 'ts', 'tsx', 'mjs'].includes(ext)) {
    return res.redirect(307, `/api/preview/bundle/${req.params.id}/${filePath}`)
  }

  const types = {
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', ico: 'image/x-icon',
    txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  }
  const contentType = types[ext] || 'text/plain; charset=utf-8'
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'no-cache')

  if (ext === 'html' || ext === 'htm') {
    let html = stripViteInjections(file.content || '')
    html = rewriteHtmlPaths(html, req.params.id)
    const shim = buildConsoleShim(req.params.id)
    html = html.includes('</head>')
      ? html.replace('</head>', `<script>${shim}</script></head>`)
      : `<script>${shim}</script>${html}`
    return res.send(html)
  }
  res.send(file.content || '')
})

// ============================================================
// SUBSCRIPTIONS
// ============================================================
const PLAN_CODES = {
  pro3x: process.env.PAYSTACK_PLAN_PRO3X || '',
  pro5x: process.env.PAYSTACK_PLAN_PRO5X || '',
  pro10x: process.env.PAYSTACK_PLAN_PRO10X || '',
}

app.post('/api/paystack/checkout', async (req, res) => {
  if (!req.isAuth || !req.user?.id) return res.status(401).json({ error: 'Sign in required' })
  if (!paystackConfigured()) return res.status(503).json({ error: 'Payments not configured' })
  const { tier } = req.body
  if (!PLAN_CODES[tier]) return res.status(400).json({ error: `Unknown tier: ${tier}` })
  const email = req.user.email
  if (!email) return res.status(400).json({ error: 'No email on account' })
  try {
    const AMOUNTS = { pro3x: 300000, pro5x: 500000, pro10x: 900000 }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    const { authorizationUrl, reference } = await initializeTransaction({
      email,
      amount: AMOUNTS[tier] || 1000,
      plan: PLAN_CODES[tier],
      callbackUrl: `${frontendUrl}/?payment=success`,
      metadata: { userId: req.user.id, tier },
    })
    res.json({ authorizationUrl, reference, tier })
  } catch (err) {
    console.error('Paystack checkout error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/subscription', async (req, res) => {
  if (!req.isAuth || !req.user?.id) return res.status(401).json({ error: 'Sign in required' })
  if (!subsConfigured()) return res.json({ subscription: null, note: 'Subscriptions not configured' })
  try {
    const sub = await getSubscription(req.user.id)
    res.json({ subscription: sub })
  } catch (err) {
    console.error('Get subscription error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/subscription/cancel', async (req, res) => {
  if (!req.isAuth || !req.user?.id) return res.status(401).json({ error: 'Sign in required' })
  if (!subsConfigured()) return res.status(503).json({ error: 'Subscriptions not configured' })
  try {
    const sub = await getSubscription(req.user.id)
    if (!sub) return res.status(404).json({ error: 'No subscription found' })
    if (sub.paystack_subscription_code && sub.paystack_email_token && paystackConfigured()) {
      try {
        await disableSubscription({ code: sub.paystack_subscription_code, emailToken: sub.paystack_email_token })
      } catch (err) { console.warn('Paystack disable failed:', err.message) }
    }
    const updated = await cancelSubscription(req.user.id)
    res.json({ subscription: updated })
  } catch (err) {
    console.error('Cancel subscription error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  res.status(200).send('ok')
  try {
    const signature = req.headers['x-paystack-signature']
    const rawBody = req.body.toString('utf8')
    const valid = await verifyWebhookSignature(rawBody, signature)
    if (!valid) return console.warn('Paystack webhook: invalid signature')
    const event = JSON.parse(rawBody)
    console.log('Paystack webhook:', event.event)
    const data = event.data
    const meta = data.metadata || {}
    const userId = meta.userId
    if (!userId) return
    if (event.event === 'charge.success') {
      await upsertSubscription(userId, {
        tier: meta.tier, status: 'active',
        paystack_customer_code: data.customer?.customer_code || null,
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
    }
    if (event.event === 'subscription.create') {
      await upsertSubscription(userId, {
        tier: meta.tier || 'pro3x', status: 'active',
        paystack_subscription_code: data.subscription_code || null,
        paystack_email_token: data.email_token || null,
        current_period_end: data.next_payment_date || null,
      })
    }
    if (event.event === 'subscription.disable' || event.event === 'subscription.not_renew') {
      await upsertSubscription(userId, { status: 'cancelled' })
    }
    if (event.event === 'invoice.payment_failed') {
      await upsertSubscription(userId, { status: 'past_due' })
    }
  } catch (err) {
    console.error('Webhook error:', err)
  }
})

// ============================================================
// HEALTH + USAGE
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasKey: !!process.env.GROQ_API_KEY })
})

app.get('/api/usage', async (req, res) => {
  const u = await getUsage(req)
  res.json(u)
})

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on port ${PORT}`)
})