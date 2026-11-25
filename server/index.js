import './env.js'
import express from 'express'
import cors from 'cors'
import Groq from 'groq-sdk'
import crypto from 'crypto'
import path from 'path'
import * as esbuild from 'esbuild'
import { attachUser } from './auth.js'
import { byokMiddleware, getByok, byokCreate, byokError, readByok, listModels } from './byok.js'
import { getIonPlan } from './subscriptions.js'
import { planGate, projectGate } from './gate.js'
import registerMcp from './mcp.js'
import { CATALOG, PROVIDERS, entryFor, resolve, availableCatalog, autoPool } from './catalog.js'
import { resolveTier } from './usage.js'
import { checkLimit as _checkLimit, recordUsage as _recordUsage, getUsage, THINKING_MULTIPLIERS, issueTurn, useTurn } from './usage.js'
// Using your own key never counts against plan limits
const checkLimit = async (req, c) => (req.byok ? { allowed: true } : _checkLimit(req, c))
const recordUsage = (req, c) => (req.byok ? undefined : _recordUsage(req, c))
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
import createGithubRouter from './githubRoutes.js'
import { webSearch, webBlock } from './websearch.js'

const app = express()

// Keep the server alive: a bug in one request must never crash the process (Render would drop the
// connection, which the browser reports as a CORS error / "could not reach the server").
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e))
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e))
for (const verb of ['post', 'get', 'put', 'delete']) {
  const orig = app[verb].bind(app)
  app[verb] = (...args) => {
    if (verb === 'get' && args.length === 1) return orig(...args)
    return orig(...args.map((h) => typeof h !== 'function' ? h : async (req, res, next) => {
      try { await h(req, res, next) } catch (e) {
        console.error(`[route ${req.method} ${req.path}]`, e)
        const msg = typeof friendlyError === 'function' ? friendlyError(e) : (e?.message || 'Server error')
        try {
          if (!res.headersSent) res.status(500).json({ error: msg })
          else { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); res.end() }
        } catch {}
      }
    }))
  }
}
app.set('trust proxy', 1)
app.disable('x-powered-by')

// Security headers on every answer, and a gentle per-IP request limit against abuse.
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!req.path.startsWith('/preview/')) res.setHeader('X-Frame-Options', 'DENY') // previews must load inside the editor
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (!req.path.startsWith('/preview/')) res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
})
const ipHits = new Map()
app.use('/api', (req, res, next) => {
  if (req.path === '/paystack/webhook') return next()
  const now = Date.now()
  const k = req.ip
  const arr = (ipHits.get(k) || []).filter((t) => now - t < 60000)
  if (arr.length >= 600) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' })
  arr.push(now)
  ipHits.set(k, arr)
  if (ipHits.size > 20000) for (const [key, v] of ipHits) if (!v.length || now - v[v.length - 1] > 60000) ipHits.delete(key)
  next()
})

// Only your own sites may call this API from a browser.
// Add more (custom domain, preview links) in the ALLOWED_ORIGINS env var, separated by commas.
const clean = (u) => String(u || '').trim().replace(/\/+$/, '')
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:47831', // ION Qoders desktop app
  'https://stream-code-editor-tau.vercel.app',
  process.env.FRONTEND_URL,
  ...String(process.env.ALLOWED_ORIGINS || '').split(','),
].map(clean).filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // no Origin header = server to server (Paystack webhook, health checks): allowed
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(clean(origin))) return callback(null, true)
    return callback(null, false)
  },
  credentials: true,
}))

app.use((req, res, next) => {
  if (req.path === '/api/paystack/webhook') return next()
  return express.json({ limit: '5mb' })(req, res, next)
})

app.use(attachUser)
app.use(byokMiddleware)
app.use(planGate)
app.use(projectGate)

// Lists the models a user's own API key can use (so they pick instead of typing)
app.post('/api/byok/models', async (req, res) => {
  if (!req.isAuth) return res.status(401).json({ error: 'Sign in first.' })
  const cfg = readByok(req, false)
  if (!cfg) return res.status(400).json({ error: 'Enter your API key first.' })
  if (cfg.error) return res.status(400).json({ error: cfg.error })
  try {
    res.json(await listModels(cfg))
  } catch (e) {
    res.status(e.status === 401 || e.status === 403 ? 401 : 502).json({ error: byokError(e) })
  }
})

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

// Turn raw provider errors into messages a user can act on
function friendlyError(err) {
  if (getByok() && err?.message) return err.message
  const m = `${err?.message || ''} ${JSON.stringify(err?.error || '')}`
  if (err?.status === 429 || /rate.?limit/i.test(m)) return 'The AI is busy right now (rate limit). Wait a few seconds and send again, or switch to another model.'
  if (err?.status === 413 || /too large|context length|reduce the length|max.*tokens/i.test(m)) return 'This request is too big for the model. Try a shorter message, fewer/smaller files, or fewer images.'
  if (/decommission|model_not_found|does not exist|no access/i.test(m)) return 'No AI model could answer right now (' + String(err?.message || '').slice(0, 120) + '). Try another model in the model menu.'
  if (/tool choice is none|called a tool|tool_use_failed/i.test(m)) return 'The AI got confused and tried a tool. Please send again.'
  if (/generate JSON|validate JSON|failed_generation/i.test(m)) return 'The AI had trouble formatting its reply. Please send again.'
  if (err?.status === 401 || /api key|unauthor/i.test(m)) return 'The AI service key is invalid on the server. Check GROQ_API_KEY on Render.'
  if (/ECONN|ETIMEDOUT|fetch failed|network/i.test(m)) return 'Could not reach the AI service. Please try again.'
  return err?.message || 'Something went wrong. Please try again.'
}

// Streams a completion; if the model returns no visible text (reasoning ate the token budget),
// retries once with low reasoning effort and a bigger budget.
let _modelCache = { at: 0, ids: [] }
async function availableModels() {
  if (Date.now() - _modelCache.at < 3600e3 && _modelCache.ids.length) return _modelCache.ids
  try {
    const l = await groq.models.list()
    const ids = (l.data || []).map((m) => m.id).filter((id) => !/whisper|guard|tts|orpheus|embed|prompt|compound|safeguard/i.test(id))
    if (ids.length) _modelCache = { at: Date.now(), ids }
  } catch (e) { console.log('[ai] could not list models:', e.message) }
  return _modelCache.ids
}
const PREFERRED = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'llama-3.1-8b-instant']
async function fallbackModels(exclude, vision = false) {
  const ids = await availableModels()
  if (vision) {
    const v = ids.filter((m) => /scout|maverick|vision|-vl|qwen/i.test(m) && !exclude.has(m))
    return v.sort((a, b) => (/llama-4/.test(b) ? 1 : 0) - (/llama-4/.test(a) ? 1 : 0))
  }
  const pool = ids.length ? ids : PREFERRED
  const ordered = [...PREFERRED.filter((m) => pool.includes(m)), ...pool.filter((m) => !PREFERRED.includes(m) && !/vision|scout|maverick/i.test(m))]
  return ordered.filter((m) => !exclude.has(m))
}

// Streams a completion with automatic recovery: empty reply, tool-call confusion or an unavailable
// model move on to the next available model (only possible while no text has been sent yet).
// Free models served through OpenRouter (the key lives in the OPENROUTER_API_KEY setting on this server)
const OR_BASE = 'https://openrouter.ai/api/v1'
const isOrModel = (m) => /:free$/.test(String(m || ''))
// streams one OpenAI-compatible provider; throws if nothing useful arrives (before any text was sent) so the caller can move on
async function* compatStream(params, cfg, st, ms = 25000) {
  const ctl = new AbortController()
  const it = (await byokCreate(params, { ...cfg, abort: ctl.signal }))[Symbol.asyncIterator]()
  let timer
  let first = await Promise.race([it.next(), new Promise((r) => { timer = setTimeout(() => r('slow'), ms) })])
  clearTimeout(timer)
  if (first === 'slow') { ctl.abort(); throw new Error(`no answer within ${ms / 1000}s`) }
  while (!first.done) {
    const d = first.value.choices?.[0]?.delta
    if (d?.content || d?.tool_calls) st.got = true
    yield first.value
    first = await it.next()
  }
  if (!st.got) throw new Error('empty reply')
}
let autoN = 0
async function* guardedStream(params) {
  // Auto: switch between the free models in turn, skip any that fail, finish on Groq
  if (!getByok() && params.model === 'auto') {
    const { reasoning_effort, reasoning_format, ...rest } = params
    const pool = await autoPool()
    const start = autoN++ % pool.length
    const st = { got: false }
    let useGroq = false
    for (let k = 0; k < pool.length; k++) {
      const c = pool[(start + k) % pool.length]
      if (c.groq) { useGroq = true; break }
      try {
        yield* compatStream({ ...rest, model: c.real }, { key: process.env[PROVIDERS[c.p].env], model: c.real, base: PROVIDERS[c.p].base }, st)
        return
      } catch (err) {
        if (st.got) throw err
        console.log(`[auto] ${c.p}/${c.real} failed: ${String(err?.message || err).slice(0, 140)}`)
      }
    }
    params = { ...params, model: PREFERRED[0] }
  }
  // catalog models (Fireworks, Cerebras, Together): try each provider that has a key, then fall back to the Groq models below
  if (!getByok() && /^cat::/.test(String(params.model || ''))) {
    const e = entryFor(params.model)
    const st = { got: false }
    if (e) {
      const { reasoning_effort, reasoning_format, ...rest } = params
      for (const p of e.providers) {
        const real = await resolve(e, p)
        if (!real) continue
        try {
          yield* compatStream({ ...rest, model: real }, { key: process.env[PROVIDERS[p].env], model: real, base: PROVIDERS[p].base }, st)
          return
        } catch (err) {
          if (st.got) throw err
          console.log(`[ai] ${p}/${real} failed: ${String(err?.message || err).slice(0, 160)}`)
        }
      }
    }
    const { reasoning_effort, reasoning_format, tools, tool_choice, ...rest2 } = params
    params = { ...rest2, model: PREFERRED[0] }
  }
  if (!getByok() && process.env.OPENROUTER_API_KEY && isOrModel(params.model)) {
    let got = false
    const ctl = new AbortController()
    try {
      const it = (await byokCreate(params, { key: process.env.OPENROUTER_API_KEY, model: params.model, base: OR_BASE, abort: ctl.signal }))[Symbol.asyncIterator]()
      // free models can queue for a long time: if nothing arrives in 20 seconds, move on to a faster model
      let first = await Promise.race([it.next(), new Promise((r) => setTimeout(() => r('slow'), 20000))])
      if (first === 'slow') { ctl.abort(); throw new Error('no answer within 20s') }
      while (!first.done) {
        const chunk = first.value
        if (chunk.choices?.[0]?.delta?.content) got = true
        yield chunk
        first = await it.next()
      }
      if (got) return
      console.log(`[ai] empty reply from ${params.model}`)
    } catch (e) {
      if (got) throw e
      console.log(`[ai] ${params.model} failed: ${String(e?.message || e).slice(0, 160)}`)
    }
    // the free model failed or was busy: carry on with the normal Groq models
    const { reasoning_effort, reasoning_format, tools, tool_choice, ...rest } = params
    params = { ...rest, model: PREFERRED[1] }
  }
  { // your own key: one straight attempt, no model hopping
    const b = getByok()
    if (b) {
      try {
        for await (const chunk of await byokCreate(params, b)) yield chunk
        return
      } catch (e) { const err = new Error(byokError(e)); err.status = e.status; throw err }
    }
  }
  const BAD = /tool choice is none|called a tool|tool_use_failed|tool_call|decommission|model_not_found|does not exist|not supported|not available|no access|permission/i
  const tried = new Set()
  if (!/gpt-oss/.test(params.model || '') && params.reasoning_effort) { const { reasoning_effort, ...r } = params; params = r }
  let cur = params
  let lastErr
  for (let i = 0; i < 5; i++) {
    let got = false
    tried.add(cur.model)
    try {
      const stream = await callGroqWithRetry(cur)
      for await (const chunk of stream) {
        if (chunk.choices?.[0]?.delta?.content) got = true
        yield chunk
      }
      if (got) return
      console.log(`[ai] empty reply from ${cur.model}`)
      // first empty reply: same model with a bigger budget and low reasoning; after that switch model
      if (i === 0 && /gpt-oss/.test(cur.model || '') && !cur.reasoning_format) {
        cur = { ...cur, max_tokens: Math.min((cur.max_tokens || 4096) + 8000, 32000), reasoning_effort: 'low' }
        continue
      }
    } catch (err) {
      lastErr = err
      if (got) throw err
      const msg = `${err?.message || ''} ${JSON.stringify(err?.error || '')}`
      console.log(`[ai] ${cur.model} failed: ${msg.slice(0, 200)}`)
      if (!BAD.test(msg) && err?.status !== 404 && err?.status !== 400) throw err
    }
    const hasImg = JSON.stringify(cur.messages || '').includes('"image_url"')
    let next = (await fallbackModels(tried, hasImg))[0]
    if (!next && hasImg) {
      // no vision model left: answer from the text alone rather than failing
      console.log('[ai] no vision model available, dropping images')
      cur = { ...cur, messages: cur.messages.map((m) => Array.isArray(m.content)
        ? { ...m, content: m.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') + '\n\n(The user attached an image but it could not be processed. Tell them briefly that the image could not be read and ask them to describe it.)' }
        : m) }
      next = (await fallbackModels(tried, false))[0]
    }
    if (!next) break
    console.log(`[ai] switching to ${next}`)
    const { reasoning_effort, reasoning_format, tools, tool_choice, ...rest } = cur
    cur = { ...rest, model: next, max_tokens: Math.min(cur.max_tokens || 4096, 16000) }
    if (/gpt-oss/.test(next)) cur.reasoning_effort = 'low'
  }
  if (lastErr) throw lastErr
}

// ------------------------------------------------------------
// Retry wrapper
// ------------------------------------------------------------
async function callGroqWithRetry(params, maxAttempts = 4) {
  if (params.model === 'auto') params = { ...params, model: PREFERRED[0] }
  let lastErr
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const b0 = getByok()
      if (b0) return await byokCreate(params, b0)
      if (/^cat::/.test(String(params.model || ''))) {
        const e = entryFor(params.model)
        for (const p of e?.providers || []) {
          const real = await resolve(e, p)
          if (!real) continue
          try { const { reasoning_effort, reasoning_format, ...rest } = params; return await byokCreate({ ...rest, model: real }, { key: process.env[PROVIDERS[p].env], model: real, base: PROVIDERS[p].base }) } catch (e2) { console.log(`[ai] ${p} failed: ${String(e2?.message || e2).slice(0, 120)}`) }
        }
        params = { ...params, model: PREFERRED[0] }
      }
      if (!b0 && process.env.OPENROUTER_API_KEY && isOrModel(params.model)) {
        try { return await byokCreate(params, { key: process.env.OPENROUTER_API_KEY, model: params.model, base: OR_BASE }) } catch (e) { params = { ...params, model: 'openai/gpt-oss-20b' } }
      }
      { const { __fb, ...p } = params; return await groq.chat.completions.create(p) }
    } catch (err) {
      lastErr = err
      // Model tried to call a tool while tools are disabled: retry without tools on a fallback model
      if (/tool choice is none|called a tool|tool_use_failed/i.test(`${err.message} ${JSON.stringify(err.error || '')}`)) {
        const { tools, tool_choice, ...rest } = params
        params = { ...rest, model: attempt === 1 ? params.model : 'llama-3.3-70b-versatile' }
        if (attempt < maxAttempts) { console.log('[ai] tool-choice error, retrying without tools'); continue }
      }
      // JSON mode failed (common with images / long outputs): retry in plain mode,
      // the client already extracts + repairs JSON from the text.
      if (params.response_format && /generate JSON|failed_generation|validate JSON/i.test(`${err.message} ${JSON.stringify(err.error || '')}`)) {
        const { response_format, ...rest } = params
        params = rest
        if (attempt < maxAttempts) { console.log('[ai] JSON mode failed, retrying without response_format'); continue }
      }
      const isRetryable =
        err.status === 429 || err.status === 500 || err.status === 502 || err.status === 503 ||
        err.message?.includes('validate JSON') || err.message?.includes('rate_limit')
      const modelProblem = /decommission|model_not_found|does not exist/i.test(`${err.message}`)
      if ((modelProblem || (err.status === 429 && attempt >= maxAttempts - 1)) && !params.__fb && !/vision|llama-4|scout|maverick/i.test(params.model || '')) {
        console.log('[ai] falling back to llama-3.3-70b-versatile')
        params = { ...params, model: 'llama-3.3-70b-versatile', __fb: true }
        const { reasoning_format, __fb, ...clean } = params
        params = { ...clean, __fb: true }
        continue
      }
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
// GitHub router needs supabaseAdmin for token storage
import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null

if (supabaseAdmin) {
  app.use('/api/github', createGithubRouter({ supabaseAdmin }))
} else {
  console.warn('⚠️  GitHub routes disabled — missing service role key')
}

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
    '  window.addEventListener("load", function() { setTimeout(function() {',
    '    try {',
    '      var b = document.body; var txt = (b && b.innerText || "").trim();',
    '      var root = document.getElementById("root") || document.getElementById("app");',
    '      if (root && root.children.length === 0) send("error", ["RENDER CHECK: #" + root.id + " is empty, the app did not render (check the console for the cause)"]);',
    '      else if (b && !txt && b.querySelectorAll("img,canvas,svg,video,input,button").length === 0) send("error", ["RENDER CHECK: the page is blank (no visible text or elements)"]);',
    '      var bad = Array.prototype.filter.call(document.images, function(i) { return i.complete && i.naturalWidth === 0 && i.src });',
    '      if (bad.length) send("warn", ["RENDER CHECK: " + bad.length + " image(s) failed to load, e.g. " + bad[0].src]);',
    '      send("log", ["RENDER CHECK: ok, " + document.querySelectorAll("*").length + " elements, " + txt.length + " chars of text"]);',
    '    } catch (e) {}',
    '  }, 600) });',
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

// Vision model for questions that include a screenshot (override with the VISION_MODEL env var)
const VISION_MODEL = process.env.VISION_MODEL || 'qwen/qwen3.8-27b'

// Only small, real image data URLs, at most 2
function cleanImages(images) {
  if (!Array.isArray(images)) return []
  return images
    .filter((u) => typeof u === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(u) && u.length < 2_000_000)
    .slice(0, 2)
}

// Text + images in the shape the vision model wants
function withImages(text, images) {
  if (!images.length) return text
  return [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
}

// "Read with the terminal" mode: the client sends a file index and the outputs of commands
// the AI asked for earlier, instead of file contents.
function exploreContext(body) {
  if (!body || body.explore !== true || !Array.isArray(body.fileIndex)) return null
  const index = body.fileIndex.slice(0, 200)
    .map((f) => `${String(f.path).slice(0, 200)} (${Number(f.lines) || 0} lines, ${Number(f.chars) || 0} chars)`)
    .join('\n')
  const obs = (Array.isArray(body.observations) ? body.observations : []).slice(-12)
    .map((o) => `$ ${String(o.cmd).slice(0, 300)}\n${String(o.output).slice(0, 3000)}`)
    .join('\n\n')
  return { index, obs, lastRound: body.lastRound === true, noShell: body.noShell === true }
}

const SHELL_RULES = (lastRound) => `

## READING THE PROJECT WITH THE TERMINAL
You do NOT get file contents up front, only a file index and the output of commands you ran so far.
Use the terminal ONLY when you must read existing code that you will change or need to understand. If the task is to create new files, folders or pages (even with an image as reference), or the answer does not need existing code, do NOT run any command: answer with the final JSON straight away.
To read code, reply with ONLY this JSON (and nothing else):
{"shell": ["grep -rn \"handleSave\" src", "sed -n '40,90p' src/App.jsx"]}
Allowed read-only commands: ls, tree, find <text> / find . -name "*.jsx", cat -n <file>, head -n N <file>, tail -n N <file>, sed -n 'A,Bp' <file>, grep -rn [-i] <text> [path], wc -l <file>.
- At most 4 commands per turn. Start with grep -rn to locate things, then sed -n on the exact range (30 to 60 lines). Never cat a big file.
- The outputs are limited in size, so be specific.
${lastRound
  ? '- THIS IS YOUR LAST TURN: you must now answer with the final JSON. No more shell commands.'
  : '- When you have what you need, reply with the final JSON answer instead of a shell request.'}`

const CHAT_SHELL_RULES = (lastRound) => `

## READING THE PROJECT WITH THE TERMINAL
Only if answering truly needs existing code you cannot see (never for general questions or new code), reply with ONLY a shell block (nothing before or after it):
<shell>
grep -rn "handleSave" src
sed -n '40,90p' src/App.jsx
</shell>
Allowed read-only commands: ls, tree, find <text>, find . -name "*.jsx", cat -n <file>, head -n N <file>, tail -n N <file>, sed -n 'A,Bp' <file>, grep -rn [-i] <text> [path], wc -l <file>.
- At most 4 commands. Use grep -rn first, then sed -n on the exact range (30 to 60 lines). Never cat a big file.
${lastRound
  ? '- THIS IS YOUR LAST TURN: answer now with what you know. Do not request more commands.'
  : '- If the question does not need code, or you already have what you need, just answer normally.'}`


// ---------------------------------------------------------------------------
// Shared quality guide: makes the agent understand requests, follow the project and ship working code
// ---------------------------------------------------------------------------
const NO_SHELL_NOTE = `

## PROJECT FILE INDEX
The list of existing files above is only so you do not clash with their names. This is a CREATION task: do NOT run any command, do NOT read files. Answer directly with the final JSON.`

const shellPart = (ex) => (!ex ? '' : ex.noShell ? NO_SHELL_NOTE : SHELL_RULES(ex.lastRound))

const QUALITY_GUIDE = `
NEVER call tools or functions (no browser, python, search tools). Answer only in the requested text/JSON format; web results, if any, are already provided in the prompt.


## SELF-CHECK BEFORE ANSWERING
- Re-read your output: valid JSON, every file path unique, every import/export/id/class matches, no leftover placeholders, nothing the user did not ask for.
- If something is impossible or unclear, say so in one sentence instead of guessing silently.

## HOW TO WORK (important)
UNDERSTAND FIRST
- Work out what the user really wants, including what they did not say (a "landing page" needs a hero, sections, footer, responsive layout, working links).
- Do exactly what was asked. If they asked for new files or a new folder, only create them: do not edit, rename or "tidy" other files, and do not read the project.
- Use the terminal ONLY when the task needs existing code that you must change or understand. Never for creating new files, for general questions, or when an attached image or the message already tells you enough.
- If the user attached an image, study it carefully: layout, sections, colors, fonts, spacing, icons, border radius, shadows, text. Rebuild that look faithfully with real HTML/CSS. If they say it is only inspiration, keep the style and mood but make it original.
- If the request is ambiguous, pick the most likely meaning, build it, and mention the assumption in the explanation (one short sentence).

FOLLOW THE PROJECT
- Match the existing code style, naming, libraries and folder structure. Reuse existing components, CSS variables and helpers. Do not add a library unless it is needed.
- Never break existing features. When editing, change the smallest part that does the job.

WRITE CODE THAT RUNS THE FIRST TIME
- You can also just talk. If the user greets you, makes small talk, thanks you or asks a question that needs no file changes, answer like a friendly person in "explanation" (a few natural sentences, you may ask them something back), with "operations" empty. Do not refuse, do not say you can only edit files, and do not create files they did not ask for.
- In Agent mode ALL code goes into "operations" (files created or edited). NEVER paste code or file contents into "explanation" or the reply text; the explanation is one or two plain sentences.
- FORMAT code like a human developer: one statement or property per line, 2-space indentation, every HTML tag/CSS rule/JS block on its own lines, blank line between sections. NEVER minify or put code on one line.\n- Complete, working code. No TODO, no "...", no placeholder functions, no lorem ipsum unless asked.
- NEVER reference local files that do not exist (images/photo.jpg, logo.png...). For pictures use inline SVG, CSS gradients, emoji, or https://picsum.photos/seed/<word>/600/400 so nothing shows as broken.
- Every id, class, import, script src and link must match something that exists. Check this before you answer.
- Make pages responsive (viewport meta, flex/grid, no fixed widths that overflow on phones), accessible (alt text, labels, contrast, semantic tags) and handle empty, loading and error states.
- Escape JSON correctly: inside "content" strings use \\n for newlines and \\" for quotes.
- If you are not sure about a library API or version, use the stable well-known form. If LIVE WEB RESULTS are given below, trust them over your memory.

WRITE CLEAN TEXT
- The field "explanation" is what the user reads in the chat: write it like a friendly developer. Short paragraphs separated by blank lines (write them as \\n\\n inside the JSON string), "- " bullet lists for several items or steps, **bold** for file names and key words, plain names for code. Never one long block of text. "plan", "title", "summary" and "description" stay short plain sentences.

BE HONEST IN WHAT YOU SAY
- The "explanation" must describe ONLY what your operations really do (which files, what they now contain or do). Never claim you tested, ran, checked, fixed or verified anything, and never mention a file, feature or fix that is not in your operations.
- Write it as a short plain explanation a friend would give: what you changed and why, in 1-3 sentences.`

const CHAT_GUIDE = `

## HOW TO ANSWER
- Understand the real question first, then answer directly. Lead with the answer or the fix, then a short why.
- Be accurate: if unsure about an API or version, say so instead of guessing. Use the LIVE WEB RESULTS when they are given.
- Show code when it helps (up to about 40 lines, in a fenced block with the language). Explain what to change and where. For whole features or new files, tell the user to switch to Agent mode.
- Use light formatting: short paragraphs, bullet lists for steps, **bold** only for key terms. Never leave stray symbols.
- If the question is unclear and you cannot reasonably guess, follow the QUESTIONS rules below.
- For comparisons use a proper markdown table (header row, then a |---|---| row). Never draw tables or lines with plain characters.
- Do NOT use the terminal unless you must read existing code to answer.`

const EDIT_FILE_RULES = `
- For a change inside an EXISTING file use edit_file: { "type": "edit_file", "path": "src/App.jsx", "edits": [ { "find": "exact old text", "replace": "new text" } ] }.
  "find" must be copied exactly from the file (without line numbers), be short (1 to 6 lines) and appear only once. Several edits per file are fine. This is far cheaper than rewriting the file.
- Use write_file / create_file only for new files or when most of a file changes.`

app.post('/api/chat', async (req, res) => {
  const { messages, code, language, model, thinking, behavior, activeFile } = req.body
  const images = cleanImages(req.body.images)
  const ex = exploreContext(req.body)
  // overview questions ("how does it look?"): the client sends a compact digest of EVERY file, so no terminal is needed
  const digest = typeof req.body.digest === 'string' ? req.body.digest.slice(0, 14000) : ''
  // terminal-read follow-ups of the same question are free; the first round is charged
  const followUp = !!ex && useTurn(req, req.body.turn)
  const thinkingCost = followUp ? 0 : (THINKING_MULTIPLIERS[thinking] || THINKING_MULTIPLIERS.medium) + (images.length ? 1 : 0)
  if (!followUp) {
    const limit = await checkLimit(req, thinkingCost)
    if (!limit.allowed) return res.status(429).json({ error: limit.message, tier: limit.tier })
  }
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' })

  const behavioralSuffix = getBehavioralPrefix(behavior) + personaBlock(req.body.persona) + rulesBlock(req) + askBlock(req, 'chat')
  // Sending a whole big file with every message burns tokens: cap it
  const MAX_CHAT_CODE = 6000
  const codeForPrompt = code && code.length > MAX_CHAT_CODE
    ? code.slice(0, MAX_CHAT_CODE) + `\n// ...(file continues, ${code.length - MAX_CHAT_CODE} more characters not shown. For work on other parts, use Agent mode, which reads exactly the lines it needs.)`
    : code
  const systemPrompt = `You are ION Qoders, a coding assistant inside a browser-based editor.

## WHAT YOU DO
- Answer questions about code, explain concepts, help plan.
- If they ask you to build/change code, say: "Switch to Agent mode — I'll write it into your editor so you can review."
- Don't dump whole files, show the relevant part.

## HOW TO ANSWER
- Answer the actual question first, in the first sentence. Then explain the why, briefly. Add a short example only if it helps.
- Ground answers in THEIR code: name the real file, function or line you mean. If you are not sure, say what you are unsure about instead of guessing.
- You can only talk in this panel. Never say you changed, created, ran, fixed or tested anything: only Agent mode changes files.
- For a bug: say what is wrong, why it happens, and show the smallest fix. For a design choice: give a recommendation and the main trade-off.
- If the question is vague, answer the most likely meaning. Only if the answer would change completely, follow the QUESTIONS rules below.

## TONE
Concise and friendly. Use \`code\` for identifiers. Honest if their code is buggy.

${language ? `## CURRENT FILE\nLanguage: ${language}` : ''}
${codeForPrompt ? `\n\`\`\`${language || ''}\n${codeForPrompt}\n\`\`\`` : ''}${ex ? `\n## PROJECT (file index; contents are NOT shown)\n${ex.index}\n${activeFile ? `Open file: ${activeFile}\n` : ''}${ex.obs ? `\n## COMMAND OUTPUTS SO FAR\n${ex.obs}\n` : ''}${ex.noShell ? '' : CHAT_SHELL_RULES(ex.lastRound)}` : ''}${CHAT_GUIDE}${behavioralSuffix}`

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const webCtx = followUp ? '' : await webBlock(req, String(lastUserMsg?.content || lastUserMsg?.text || '').slice(0, 300)).catch(() => '')

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  if (ex && !followUp) res.write(`data: ${JSON.stringify({ turn: issueTurn(req) })}\n\n`)

  try {
    // attach screenshots to the newest user message
    const chatMessages = messages.map((m) => ({ role: m.role, content: m.content }))
    if (images.length) {
      for (let i = chatMessages.length - 1; i >= 0; i--) {
        if (chatMessages[i].role === 'user') {
          chatMessages[i].content = withImages(String(chatMessages[i].content || 'What do you think of this image?'), images)
          break
        }
      }
    }
    const stream = guardedStream({
      model: images.length ? VISION_MODEL : (model || 'auto'),
      messages: [{ role: 'system', content: systemPrompt + (digest ? `\n\n## PROJECT OVERVIEW (a digest of every file you have access to: structure, key lines and the start of each file)\nAnswer from this. Do not claim you cannot see the files. If you need exact lines of one file, say which file and ask the user to request that specific change.\n${digest}\n` : '') + (webCtx || '') }, ...chatMessages],
      stream: true,
      temperature: 0.6,
      max_tokens: thinking === 'ultra' ? 8192 : thinking === 'high' ? 6144 : 4096,
      ...(images.length ? { reasoning_format: 'hidden' } : {}),
    })
    let totalChars = 0
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) { totalChars += text.length; res.write(`data: ${JSON.stringify({ text })}\n\n`) }
    }
    if (totalChars === 0) res.write(`data: ${JSON.stringify({ error: 'AI returned empty response.' })}\n\n`)
    res.write('data: [DONE]\n\n')
    if (!followUp && totalChars > 0) recordUsage(req, thinkingCost)
    res.end()
  } catch (err) {
    console.error('Chat error:', err)
    res.write(`data: ${JSON.stringify({ error: friendlyError(err) })}\n\n`)
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
    const stream = guardedStream({
      model: model || 'auto',
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
    res.write(`data: ${JSON.stringify({ error: friendlyError(err) })}\n\n`)
    res.end()
  }
})

app.post('/api/agent', async (req, res) => {
  if (req.body && req.body.forceFiles) req.body.prompt = String(req.body.prompt || '') + '\n\n(IMPORTANT: your last answer pasted code into the reply. Put ALL code into operations as created or edited files. The explanation must be plain words with no code.)'
  const { prompt, files, activeFile, history, model, thinking, behavior } = req.body
  const team = req.body.team === true
  const teamSize = Math.min(8, Math.max(2, Number(req.body.teamSize) || 3))
  const images = cleanImages(req.body.images)
  const ex = exploreContext(req.body)
  // later rounds of the same question (terminal reads) are free; the first round is charged
  const followUp = !!ex && useTurn(req, req.body.turn)
  const thinkingCost = followUp ? 0 : (THINKING_MULTIPLIERS[thinking] || THINKING_MULTIPLIERS.medium) + (images.length ? 1 : 0)
  if (!followUp) {
    const limit = await checkLimit(req, thinkingCost)
    if (!limit.allowed) return res.status(429).json({ error: limit.message, tier: limit.tier })
  }
  if (!prompt) return res.status(400).json({ error: 'prompt required' })

  const MAX_FILE_CHARS = 2000
  const MAX_TOTAL_CHARS = 8000

  const fileList = fileDigest(files, activeFile, prompt, 12000, 3500)

  const SYSTEM = `You are the ION Qoders Agent, an autonomous coding agent.

You respond with ONLY a JSON object:

{
  "explanation": "one-line summary",
  "plan": ["step 1", "step 2"],
  "operations": [
    { "type": "create_file", "path": "src/New.jsx" },
    { "type": "write_file",  "path": "src/App.jsx" },
    { "type": "edit_file",   "path": "src/App.jsx", "edits": [ { "find": "exact old text", "replace": "new text" } ] },
    { "type": "delete_file", "path": "src/Old.jsx" },
    { "type": "rename_file", "path": "src/Old.jsx", "newPath": "src/New.jsx" }
  ],
  "actions": [ { "type": "github_push", "message": "Add pricing page" }, { "type": "run_command", "command": "npm install", "message": "Installs the packages package.json lists" } ],
  "ask": { "question": "...", "options": ["...", "..."], "multi": false }
}
"ask" is OPTIONAL: see QUESTIONS below. Leave it out unless you truly need an answer.

"actions" is OPTIONAL. Leave it out unless the user explicitly asked for one of these. The user must approve every action, you can never run them yourself:
- github_push: (when the user wants a NEW repo, add "newRepo": true and a short "repo" name suggestion; the user can change it in a window)  the user wants the project saved/pushed to GitHub (opens the push dialog). "message" = a git commit message for what changed (imperative, max 72 characters, plain text)
- github_import: the user wants to import a GitHub repo (opens the import dialog); optional "repo": "owner/name" (only if the user named it)
- run_preview: the user wants to see the project running (opens the live preview)
- run_tests: the user wants the project checked for errors
- github_deploy: the user asked to deploy, publish or put the project online (opens the Deploy window with hosting links after a push). "message" = a short note
- run_command: a terminal command the project needs to work, for example npm install, npm run dev, npx something, python script.py. Put the exact command in "command" (one line) and why in "message". The user chooses: run it and test, just run it, or cancel and run it themselves. Use it ONLY when the user asked you to run, install, start or test something. If they did not ask, never add a run_command: write the commands they would need as a short copyable code block at the end of your message ("To run it: ...") and stop. Never claim it ran.
When the user asks you to run something (install, start, test, a script, adb), do NOT write a README or a how-to file: answer with a run_command action holding the exact command. When the user says a command failed or to look at the terminal, read the Terminal part of RECENT LOGS in the app context, name the cause in one or two sentences, fix the files if the fix is in the project, and propose the corrected run_command. Never claim you ran it yourself.
Never say you pushed, imported or ran something. Say it is waiting for their approval. If the user only asks for these actions, "operations" can be an empty list.

## RULES
- Paths relative to project root ("src/App.jsx").
- FULL file content for write_file / create_file.${EDIT_FILE_RULES}
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
- JSX in .jsx files. Entry: HTML with <div id="root"></div> + <script type="module" src="main.jsx"></script>${QUALITY_GUIDE}${shellPart(ex)}${getBehavioralPrefix(behavior)}${personaBlock(req.body.persona)}${rulesBlock(req)}${askBlock(req, 'json')}${FILE_BLOCKS}`

  const conversation = Array.isArray(history)
    ? history.slice(-20).map((m) => ({ role: m.role, content: m.text || m.content || '' }))
    : []

  const USER = ex
    ? `File index (contents are NOT shown${ex.noShell ? ', names only so you do not clash with them' : ', read what you need with the shell'}):\n${ex.index}\n\n${activeFile ? `User's open file: ${activeFile}\n` : ''}${ex.obs ? `\nCommand outputs so far:\n${ex.obs}\n\n` : ''}User request: ${prompt}`
    : `Project files:\n\n${fileList}\n\n${activeFile ? `User's open file: ${activeFile}\n` : ''}User request: ${prompt}`
  const webCtx = followUp ? '' : await webBlock(req, String(prompt || '').slice(0, 300)).catch(() => '')
  conversation.push({ role: 'user', content: withImages(USER + webCtx, images) })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  if (ex && !followUp) res.write(`data: ${JSON.stringify({ turn: issueTurn(req) })}\n\n`)

  try {
    const stream = guardedStream({
      model: images.length ? VISION_MODEL : (model || 'auto'),
      messages: [{ role: 'system', content: SYSTEM }, ...conversation],
      stream: true,
      temperature: 0.2,
      max_tokens: thinking === 'ultra' ? 16000 : thinking === 'high' ? 12000 : 8000,
      ...(images.length
        ? { reasoning_format: 'hidden' }
        : {
            reasoning_effort: thinking === 'ultra' || thinking === 'high' ? 'high' : thinking === 'low' ? 'low' : 'medium',
          }),
    })
    let totalChars = 0
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) { totalChars += text.length; res.write(`data: ${JSON.stringify({ text })}\n\n`) }
    }
    if (totalChars === 0) res.write(`data: ${JSON.stringify({ error: 'AI returned empty response.' })}\n\n`)
    res.write('data: [DONE]\n\n')
    if (!followUp) recordUsage(req, thinkingCost)
    res.end()
  } catch (err) {
    console.error('Agent error:', err)
    res.write(`data: ${JSON.stringify({ error: friendlyError(err) })}\n\n`)
    res.end()
  }
})

// A character from the ION app lends its voice to the answer text. It never changes the code or the JSON format.

// How and when the AI may ask the user a question (shown as a pop-up with options)
// File contents are NOT put inside the JSON: each file goes in its own block after it, so code needs no escaping
// Builds the file section for the agent: ALL file names, then contents for the most relevant files that fit.
function fileDigest(files, activeFile, prompt, maxTotal, maxFile) {
  const SKIP = /(^|\/)(node_modules|\.git|dist|build|\.next|\.cache)\//
  const txt = (f) => f?.content ?? (typeof f === 'string' ? f : '') ?? ''
  const all = Object.entries(files || {}).filter(([p]) => !SKIP.test(p) && !/\.(gitkeep|lock|log)$/.test(p) && !/package-lock\.json$/.test(p))
  const words = String(prompt || '').toLowerCase().match(/[a-z0-9_-]{3,}/g) || []
  const score = ([p, f]) => (p === activeFile ? 1000 : 0) + (words.some((w) => p.toLowerCase().includes(w)) ? 100 : 0) - Math.min(txt(f).length / 1000, 50)
  const names = all.slice(0, 400).map(([p, f]) => `${p} (${txt(f).split('\n').length} lines)`).join('\n')
  let used = 0
  const shown = []
  for (const [p, f] of [...all].sort((a, b) => score(b) - score(a))) {
    const t = txt(f)
    const block = `--- ${p} ---\n${t.slice(0, maxFile)}${t.length > maxFile ? '\n…(truncated)' : ''}`
    if (used + block.length > maxTotal) continue
    used += block.length
    shown.push(block)
  }
  const hidden = all.length - shown.length
  return `ALL FILES IN THE PROJECT (${all.length}):\n${names}\n\n${hidden > 0 ? `(${hidden} file(s) above are not shown in full to save space. They DO exist. Do not assume what is inside them or that they are missing.)\n\n` : ''}${shown.join('\n\n')}`
}

const INTENT_RULES = `

## BUILD OR ANSWER
- The user may write in any language or in casual short words. Work out what they mean.
- Change files only when they ask to build, change, fix, add, rename or remove something, however they word it ("work on it", "make it", "abeg add").
- A question, an answer to a question you asked, an opinion or chat gets a reply in "explanation" with an EMPTY operations list. Never turn an answer into a file edit.
- Check ALL FILES before saying a page or file is missing or before making a new one that may already exist. Link to the real file names.
- To rename or move a file use {"type":"rename_file","path":"old","newPath":"new"}. Never create a new file and delete the old one.
- Never open, list or write node_modules, dist, build or lock files: it wastes credits and time.
- In code, always use real line breaks. Never type the two characters \\ and n as a newline.`

const FILE_BLOCKS = `

## REPLY FORMAT (strict)
1. First one small JSON object with the explanation and the list of operations. It has NO file contents.
2. Then, for every create_file / write_file operation, the file content in its own block, exactly like this:

<<<FILE src/New.jsx>>>
the full file content, written as normal code. No escaping, no quotes around it.
<<<END>>>

Rules: the path after FILE must match the operation's path. Always close each block with <<<END>>> on its own line. Do not wrap anything in markdown fences. The "explanation" may use simple markdown (short paragraphs, - bullet lists, **bold**). If the work is big, write fewer files and say what is left in "explanation" instead of cutting a file off.${INTENT_RULES}`

const JSON_ONLY = '\n\n## REPLY FORMAT (strict)\nYour whole reply is exactly ONE JSON object. Start with { and end with }. No markdown fences, no text before or after, no thinking out loud. Escape newlines inside strings as \\n and quotes as \\\". If a file would be very long, split the work across fewer, shorter files instead of cutting the JSON off.' + INTENT_RULES

function rulesBlock(req, lite) {
  const b = req.body || {}
  const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  const r = clip(b.rules, 6000)
  let out = r ? `\n\n## PROJECT RULES (written by the user for this project - always follow them)\n${r}` : ''
  const mem = clip(b.memoryContext, 4500)
  if (mem) out += `\n\n${mem}`
  if (Array.isArray(b.mcp) && b.mcp.length) {
    const tl = b.mcp.slice(0, 40)
    const lines = tl.map((t) => `- ${clip(String(t.server), 40)} / ${clip(String(t.name), 80)}(${clip(String(t.schema), 200)}${Array.isArray(t.required) && t.required.length ? `; required: ${t.required.slice(0, 8).map((x) => clip(String(x), 40)).join(', ')}` : ''}): ${clip(String(t.description), 200)}`)
    const uses = [...new Map(tl.filter((t) => t.use).map((t) => [String(t.server), `- ${clip(String(t.server), 40)}: ${clip(String(t.use), 240)}`])).values()]
    out += `\n\n## CONNECTED TOOLS (extensions the user added)
You can use these with an "mcp_call" action: {"type":"mcp_call","server":"<server>","tool":"<tool>","args":{...},"message":"why"}.
- Use one when it clearly helps (current docs, the user's own data, an outside service). Do not use one for something you can just write yourself.
- Propose ONE call at a time. You cannot see its result in the same reply: say what you expect from it. The user approves it, the result appears in the chat, and you carry on from it in the next turn.
- Use the exact server and tool names and the argument names from the schema. If a required argument is missing, ask the user for it instead of guessing.
- Never claim a tool ran or invent what it returned.
${uses.length ? `How to use each extension:\n${uses.join('\n')}\n` : ''}Tools:
${lines.join('\n')}`
  }
  out += `\n\n## HOW TO TALK (always follow)
- Write your reply as flowing sentences that blend the idea with what you actually did, for example "I built the login page with a green header and wired the form to the new /api/login route". Never an idea paragraph first and then a separate list of what you did.
- Finish with one short checkpoint line in plain words: what is done and what you are doing or suggesting next, for example "Done: the header and the form. Next: I'm adding validation." Only say what really happened.
- If the chat shows the user declined something (a plan, a file change or an action), do not redo it or argue. Say briefly what you did get done and that the declined part was declined, and only offer to continue with it if they want it.
`
  if (b.fullAccess === true) {
    out += `\n\n## FULL ACCESS MODE (the user is away and trusts you)
- Nobody will approve anything. Do the whole job yourself and keep going until it works.
- Never ask questions or offer options. Decide, and say in one short line what you chose.
- WRITE THE FILES FIRST. Run a command only if the job truly needs one (installing packages, a build step, starting a dev server, or the user asked for it). A plain HTML/CSS/JS site needs NO command: write the files, say it is done and that they can open the preview. Never run commands just because you have full access.
- Keep every command SIMPLE: one short command per run_command action, the plain form (for example "npm install", not a long command with many flags or several things chained together). Never chain with && or ;. Do not add "cd" when the terminal is already in the project folder; use "cd" only to a folder you can see in the WORKSPACE listing.
- One command at a time. After a command the app sends you ONLY that command's result. Wait for it. If it worked and another command is really needed, send the next one. If it failed, read its error, fix the files, then run that same command again. Never go back to older errors or old output, and never start something new while a command is unfinished.
- Do not repeat a command that already succeeded unless the files it depends on changed.
- You cannot see the page. Say so once at the end and ask the user to tell you if something looks wrong.`
  }
  if (!lite) {
    out += `\n\n## PROJECT FOLDERS (always follow)
- The editor session already IS the project. Put files at its root (index.html, src/..., package.json). Do NOT wrap them in an extra main folder and do not scaffold a new project inside the existing one, unless the existing files already all live inside one folder (then keep using it).
- Editing or rewriting an existing file means writing that SAME path again. Never create a second copy of it in a new folder.
- Terminal commands run in the project's folder on the user's computer (see WORKSPACE in the editor context). Only use "cd" to a folder that is listed there.
- A project with a package.json (Vite, React, Next, TypeScript, 3D) cannot show in the plain inline preview. After writing its files, tell the user the commands (npm install, then npm run dev) in a copyable code block and that the Local tab will show the running site. Only add run_command actions if the user asked to run it.`
    const ctx = clip(b.appContext, 7000)
    if (ctx) out += `\n\n## ABOUT THE EDITOR AND THE USER\n${ctx}`
  }
  return out
}

function askBlock(req, mode) {
  if (req.body?.allowQuestions === false) {
    return `\n\n## QUESTIONS\nDo NOT ask the user any questions. Make sensible assumptions and say in one line what you assumed.`
  }
  if (mode === 'chat') {
    return `\n\n## QUESTIONS\nIn chat mode never open a question pop-up. If you really need an answer, ask it in plain words at the end of your reply and wait for the user to write back.`
  }
  const how = `Return it in the JSON field "ask" like {"question":"Which style do you want?","options":["Minimal","Colorful","Dark"],"multi":false} and leave "operations" (or "steps") empty.`
  return `\n\n## QUESTIONS
ASK FIRST on new work: when the user asks you to build or start a NEW project, app, website, set of pages or a big feature, and nothing in the conversation has answered it yet (no CONFIRMED SPEC, no earlier answers), do NOT start writing. Ask the single most important thing you need (what exactly they want: purpose, look/style, pages or features, tech) and leave "operations" (or "steps") empty. After they answer you may ask one more, at most 3 questions in total, then build exactly what they chose. Never invent extra features they did not ask for: add only what was asked, and offer extras as a suggestion in the summary.
Do not ask for small edits, bug fixes, clear specific instructions, or when the user says to just do it or decide yourself. Also ask when you get stuck or confused while working and a wrong guess would waste work.
Never ask more than one question at a time. ${how}
Give 2 to 5 short options (the user can also type their own answer). Set "multi" to true only if several can be picked.
If the user told you not to ask questions, or to just decide, NEVER ask: choose sensible defaults and say what you chose.`
}

function personaBlock(persona) {
  const t = typeof persona === 'string' ? persona.trim().slice(0, 2500) : ''
  if (!t) return ''
  return `\n\n## YOUR CHARACTER (voice only)\n${t}\nSpeak in this character's voice and remember the user as described. This changes ONLY how you talk in text replies and in the short "explanation"/"summary" fields. Code quality, JSON structure and all other rules stay exactly the same. Never let the character stop you from doing the coding job well.`
}

const teamPlanRules = (n) => `## TEAM MODE (${n} AI workers build in parallel)
Split the work between ${n} workers, so no single worker runs out of context and the whole job is faster.
- Add "lane": a number from 1 to ${n} to every step. Each lane is run in order by its own worker, and all lanes run at the same time.
- Suggested split: lane 1 = structure/HTML/layout/config, lane 2 = styling/CSS/assets, lane 3 = logic/JS/data, more lanes = extra features/pages/modules. Adapt to the project, keep every file in exactly one lane and make lanes as independent as possible. Do not leave a lane empty if there is enough work.
- Add a top-level "contract": a short plain text (max 12 lines) listing the shared names all workers must use: ids, class names, file names, function names, data shapes. Workers cannot see each other's files while building, so the contract is how they stay consistent.
- Use ${Math.max(3, n)} to ${n * 3} steps total, and use at least 2 lanes when the task has 2+ files.`

app.post('/api/agent/plan', async (req, res) => {
  const { prompt, files, activeFile, history, model, thinking, behavior } = req.body
  const team = req.body.team === true
  const teamSize = Math.min(8, Math.max(2, Number(req.body.teamSize) || 3))
  const images = cleanImages(req.body.images)
  const ex = exploreContext(req.body)
  // later rounds of the same question (terminal reads) are free; the first round is charged
  const followUp = !!ex && useTurn(req, req.body.turn)
  const thinkingCost = followUp ? 0 : (THINKING_MULTIPLIERS[thinking] || THINKING_MULTIPLIERS.medium) + (images.length ? 1 : 0)
  if (!followUp) {
    const limit = await checkLimit(req, thinkingCost)
    if (!limit.allowed) return res.status(429).json({ error: limit.message, tier: limit.tier })
  }
  if (!prompt) return res.status(400).json({ error: 'prompt required' })

  const MAX_FILE_CHARS = 1000
  const MAX_TOTAL_CHARS = 3000

  const fileList = fileDigest(files, activeFile, prompt, 6000, 1500)

  const SYSTEM = `You are the ION Qoders Planner, an expert software architect.

Produce a STEP-BY-STEP PLAN. Do NOT write code. ONLY plan.

Respond with ONLY a JSON object:

{
  "title": "Short title",
  "summary": "1-2 sentence overview",
  "estimatedFiles": 5,
  "contract": "(team mode only) shared ids, classes, file and function names",
  "steps": [
    { "id": 1, "title": "Create index.html", "description": "One sentence", "files": ["index.html"], "lane": 1 }
  ]
}

${team ? teamPlanRules(teamSize) : ''}

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

No markdown. No fences. No prose outside JSON.${QUALITY_GUIDE}${shellPart(ex)}${getBehavioralPrefix(behavior)}${personaBlock(req.body.persona)}${rulesBlock(req)}${askBlock(req, 'json')}${JSON_ONLY}${req.body.strict ? '\n\nThe last answer had no usable steps. This time the "steps" array MUST contain at least one step with an id, title, description and files.' : ''}`

  const conversation = Array.isArray(history)
    ? history.slice(-10).map((m) => ({ role: m.role, content: m.text || m.content || '' }))
    : []

  const USER = ex
    ? `File index (contents are NOT shown${ex.noShell ? ', names only so you do not clash with them' : ', read what you need with the shell'}):\n${ex.index}\n\n${activeFile ? `User's open file: ${activeFile}\n` : ''}${ex.obs ? `\nCommand outputs so far:\n${ex.obs}\n\n` : ''}User request: ${prompt}`
    : `Project files:\n\n${fileList}\n\n${activeFile ? `User's open file: ${activeFile}\n` : ''}User request: ${prompt}`
  const webCtx = followUp ? '' : await webBlock(req, String(prompt || '').slice(0, 300)).catch(() => '')
  conversation.push({ role: 'user', content: withImages(USER + webCtx, images) })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  if (ex && !followUp) res.write(`data: ${JSON.stringify({ turn: issueTurn(req) })}\n\n`)

  try {
    const stream = guardedStream({
      model: images.length ? VISION_MODEL : (model || 'auto'),
      messages: [{ role: 'system', content: SYSTEM }, ...conversation],
      stream: true,
      ...(getByok() ? {} : { response_format: { type: 'json_object' } }), // makes the model answer with one JSON object
      temperature: 0.2,
      max_tokens: 8000,
      ...(images.length
        ? { reasoning_format: 'hidden' }
        : {
            reasoning_effort: thinking === 'ultra' || thinking === 'high' ? 'high' : 'medium',
          }),
    })
    let totalChars = 0
    let acc = ''
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) { totalChars += text.length; acc += text; res.write(`data: ${JSON.stringify({ text })}\n\n`) }
    }
    if (totalChars === 0) res.write(`data: ${JSON.stringify({ error: 'AI returned empty plan.' })}\n\n`)
    res.write('data: [DONE]\n\n')
    // credits are only used for a plan that has steps (or a question / a read request), never for an empty answer
    const usable = /"steps"\s*:\s*\[\s*\{/.test(acc) || /"ask"\s*:/.test(acc) || /"shell"\s*:\s*\[/.test(acc)
    if (!followUp && usable) recordUsage(req, thinkingCost)
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
  const teamNote = req.body.team === true
    ? `\n\n## TEAM MODE\nYou are worker ${Number(req.body.lane) || 1} of ${Math.min(8, Number(req.body.teamSize) || 3)} building in parallel. Other workers write the other files at the same time and you cannot see them. Use EXACTLY the shared names from this contract (ids, classes, files, functions):\n${String(req.body.contract || plan?.contract || '(none)').slice(0, 1500)}\nWrite only your own files.`
    : ''
  const ex = exploreContext(req.body)
  const followUp = !!ex && useTurn(req, req.body.turn)
  const thinkingCost = followUp ? 0 : (THINKING_MULTIPLIERS[thinking] || THINKING_MULTIPLIERS.medium)
  if (!followUp) {
    const limit = await checkLimit(req, thinkingCost)
    if (!limit.allowed) return res.status(429).json({ error: limit.message, tier: limit.tier })
  }
  if (!step) return res.status(400).json({ error: 'step required' })

  const stepText = `${step.title} ${step.description} ${(step.files || []).join(' ')}`
  const stepComplexity = stepText.length
  // small projects are sent whole (the client only sends files in full when they fit);
  // bigger ones arrive as a file index and are read with the terminal instead
  const MAX_FILE_CHARS = 6000
  const MAX_TOTAL_CHARS = 6000

  const fileList = fileDigest(files, '', `${step.title} ${step.description}`, 8000, 4000)

  const stepsSummary = Array.isArray(allSteps)
    ? allSteps.map((s) => `${s.id}. ${s.title} — ${s.description}`).join('\n')
    : ''

  const SYSTEM = `You are the ION Qoders Agent executing ONE STEP of a multi-step plan.

## THE FULL PLAN
${stepsSummary}

## YOUR CURRENT STEP
Step ${step.id}: ${step.title}
Description: ${step.description}
Files to produce: ${(step.files || []).join(', ')}

## YOUR JOB
Execute ONLY this step. Produce the files listed.${teamNote}

Respond with ONLY a JSON object:

{
  "explanation": "one-line summary",
  "operations": [
    { "type": "create_file", "path": "index.html" },
    { "type": "write_file",  "path": "styles.css" },
    { "type": "edit_file",   "path": "src/App.jsx", "edits": [ { "find": "exact old text", "replace": "new text" } ] }
  ]
}

## RULES
- FULL file content for create_file / write_file. No snippets, no diffs.${EDIT_FILE_RULES}
- Match existing style and language.
- No placeholders, no "// TODO", no fake names.

## HTML + REACT RULES
Allowed in HTML: <script type="module" src="app.jsx"></script>, plain <script src="app.js"></script>.
NOT allowed: /@vite/client, /@react-refresh, absolute paths /src/ or /public/.

For React:
- import React from 'https://esm.sh/react@18'
- import { createRoot } from 'https://esm.sh/react-dom@18/client'
- NEVER use bare imports.
- JSX in .jsx files. HTML entry: <div id="root"></div> + <script type="module" src="main.jsx"></script>

${QUALITY_GUIDE}${shellPart(ex)}${getBehavioralPrefix(behavior)}${personaBlock(req.body.persona)}${rulesBlock(req, true)}${FILE_BLOCKS}${req.body.strict ? '\n\n## IMPORTANT\nYour previous answer could not be read. Follow the REPLY FORMAT exactly: small JSON first, then one <<<FILE path>>> ... <<<END>>> block per file. No thinking out loud. Keep every file as short as it can be while still working.' : ''}\n\nFiles that already exist in the project are listed below. Never write a file again unless this step needs to change it.`

  const USER = (ex
    ? `Original user request: ${originalPrompt || '(unknown)'}\n\nFile index (contents are NOT shown${ex.noShell ? ', names only so you do not clash with them' : ', read what you need with the shell'}):\n${ex.index}\n${ex.obs ? `\nCommand outputs so far:\n${ex.obs}\n` : ''}`
    : `Original user request: ${originalPrompt || '(unknown)'}\n\nCurrent project files:\n\n${fileList}\n`)
    + `\n${activeFile ? `User's open file: ${activeFile}\n` : ''}\nExecute step ${step.id} only.`

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  if (ex && !followUp) res.write(`data: ${JSON.stringify({ turn: issueTurn(req) })}\n\n`)

  try {
    const stream = guardedStream({
      model: model || 'auto',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER },
      ],
      stream: true,
      temperature: 0.2,
      max_tokens: 14000,
    })
    let totalChars = 0
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) { totalChars += text.length; res.write(`data: ${JSON.stringify({ text })}\n\n`) }
    }
    if (totalChars === 0) res.write(`data: ${JSON.stringify({ error: 'AI returned empty response. Try a simpler step.' })}\n\n`)
    res.write('data: [DONE]\n\n')
    if (!followUp) recordUsage(req, thinkingCost)
    res.end()
  } catch (err) {
    console.error('Execute-step error:', err)
    res.write(`data: ${JSON.stringify({ error: friendlyError(err) })}\n\n`)
    res.end()
  }
})


// Plain-language explanation of changes that were really applied. It only sees the real changes,
// so it cannot describe work that did not happen.
app.post('/api/agent/summarize', async (req, res) => {
  try {
    const { originalPrompt, changes: rawChanges, model, behavior } = req.body || {}
    const changes = Array.isArray(rawChanges) ? rawChanges : []
    const failed = Array.isArray(req.body?.failed) ? req.body.failed.slice(0, 8).map((f) => String(f).slice(0, 200)) : []
    if (!changes.length && !failed.length) return res.status(400).json({ error: 'changes required' })
    const list = changes.slice(0, 12).map((c) =>
      `- ${String(c.kind).slice(0, 12)} ${String(c.path).slice(0, 120)}${c.note ? ` (${String(c.note).slice(0, 80)})` : ''}\n${String(c.excerpt || '').slice(0, 900)}`
    ).join('\n\n')
    const SYSTEM = `You explain code changes to the person who asked for them, like a friendly developer finishing a job.
Rules:
- Use ONLY the CHANGES below. Describe what each file now does or what was changed in it. Never mention anything that is not in CHANGES.
- Never say you ran, tested, previewed or verified anything. If something should be checked, say what to check in one short sentence.
- Format it nicely with markdown: a short opening sentence, then a blank line, then "- " bullets (one per file or change, file names in **bold**), then a blank line and one closing sentence. Never one long block. No emoji, no code blocks.
- Say what the user will see or can now do, not just file names.
- If a FAILED list is given: first say what did get done, then in the same message say plainly "but I could not finish" each failed item and why, in simple words. Never say a failed item worked. End by asking if they want you to fix only that part, and tell them they can just reply "fix it". When FAILED exists you may use up to 7 sentences.${getBehavioralPrefix(behavior)}${personaBlock(req.body.persona)}`
    const USER = `The user asked: ${String(originalPrompt || '(not given)').slice(0, 600)}\n\nCHANGES THAT WERE APPLIED:\n${list || '(nothing was applied)'}${failed.length ? `\n\nFAILED (NOT done):\n${failed.map((f) => '- ' + f).join('\n')}` : ''}`
    let text = ''
    const stream = guardedStream({
      model: model || 'auto',
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }],
      stream: true,
      temperature: 0.3,
      max_tokens: 500,
    })
    for await (const chunk of stream) text += chunk.choices[0]?.delta?.content || ''
    text = text.replace(/[*`#]/g, '').trim()
    if (!text) return res.status(502).json({ error: 'empty' })
    res.json({ text })
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) })
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
    .map(([p, f]) => `--- ${p} ---\n${(f?.content ?? (typeof f === 'string' ? f : '') ?? '').slice(0, 2000)}`)
    .join('\n\n')
    .slice(0, 5000)

  const SYSTEM = `You are the ION Qoders Agent in TEST mode.

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
      model: model || 'auto',
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }],
      temperature: 0.2,
      max_tokens: 3000,
    })
    const raw = completion.choices[0]?.message?.content || '{}'
    let parsed
    try { parsed = JSON.parse(raw) } catch {
      return res.json({ status: 'ok', summary: 'Could not parse diagnosis; assuming OK.' })
    }
    res.json(parsed)
  } catch (err) {
    console.error('Diagnose error:', err)
    res.status(500).json({ error: friendlyError(err) })
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
            return { path: /^https?:/.test(args.path) ? args.path : `https://esm.sh/${args.path}`, external: true }
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
  // keep memory bounded: drop the oldest previews once there are too many
  if (previewSessions.size >= 500 && !previewSessions.has(id)) {
    const oldest = previewSessions.keys().next().value
    previewSessions.delete(oldest)
  }
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

// Plans are bought in the ION app (live payments there). The editor just follows that plan.
app.post('/api/paystack/checkout', (req, res) => res.status(410).json({ error: 'Plans are bought in the ION app (Plans page). Use the same login and your editor plan updates by itself.' }))

app.get('/api/subscription', async (req, res) => {
  if (!req.isAuth || !req.user?.id) return res.status(401).json({ error: 'Sign in required' })
  try {
    const ion = await getIonPlan(req.user.id)
    if (ion) return res.json({ subscription: { tier: ion.plan, multiplier: ion.multiplier, status: ion.renewing ? 'active' : 'ending', current_period_end: ion.periodEnd, source: 'ion' } })
    if (!subsConfigured()) return res.json({ subscription: null })
    res.json({ subscription: await getSubscription(req.user.id) })
  } catch (err) {
    console.error('Get subscription error:', err)
    res.status(500).json({ error: friendlyError(err) })
  }
})

app.post('/api/subscription/cancel', async (req, res) => {
  if (!req.isAuth || !req.user?.id) return res.status(401).json({ error: 'Sign in required' })
  if (await getIonPlan(req.user.id)) return res.status(409).json({ error: 'Your plan is managed in the ION app. Open ION, then Plans, to cancel or change it.' })
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
    res.status(500).json({ error: friendlyError(err) })
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
// Web searches have their own daily cap per plan (separate from AI credits). Resets each UTC day.
const SEARCH_CAP = { anonymous: 3, free: 5, go: 40, plus: 60, pro3x: 60, pro: 250, pro5x: 250, pro10x: 250, max: 1200, max2: 1200, max3: 1200, max5: 1200 }
const searchUse = new Map()
app.post('/api/search', async (req, res) => {
  const who = req.user?.id || req.ip || 'anon'
  const day = new Date().toISOString().slice(0, 10)
  let tier = 'anonymous'
  try { tier = await resolveTier(req) } catch { /* keep anonymous cap */ }
  const cap = SEARCH_CAP[tier] ?? 5
  const u = searchUse.get(who)
  const used = u && u.day === day ? u.n : 0
  if (used >= cap) return res.status(429).json({ error: `Daily web search limit reached (${cap}). It resets at midnight UTC.`, results: [] })
  searchUse.set(who, { day, n: used + 1 })
  if (searchUse.size > 5000) for (const [k, v] of searchUse) if (v.day !== day) searchUse.delete(k)
  const results = await webSearch(req.body?.query, Math.min(Number(req.body?.maxResults) || 5, 8))
  res.json({ results })
})

app.get('/api/models/catalog', async (req, res) => {
  try { res.json({ models: await availableCatalog() }) } catch { res.json({ models: [] }) }
})

// Tab autocomplete: a short, fast completion at the cursor. Go plan and up, rate limited, uses a small fast model.
const acHits = new Map()
app.post('/api/complete', async (req, res) => {
  if (!req.isAuth || !req.user?.id) return res.status(401).json({ error: 'Sign in required' })
  try {
    const tier = await resolveTier(req)
    if (tier === 'free' || tier === 'anonymous') return res.status(403).json({ error: 'Autocomplete needs the Go plan or higher' })
  } catch { return res.status(403).json({ error: 'plan check failed' }) }
  const now = Date.now()
  const hits = (acHits.get(req.user.id) || []).filter((t) => now - t < 60000)
  if (hits.length >= 40) return res.status(429).json({ error: 'slow down' })
  hits.push(now); acHits.set(req.user.id, hits)
  const { prefix = '', suffix = '', language = 'code' } = req.body || {}
  if (typeof prefix !== 'string' || prefix.trim().length < 3) return res.json({ text: '' })
  try {
    let out = ''
    const stream = guardedStream({
      model: 'llama-3.1-8b-instant',
      stream: true,
      temperature: 0.1,
      max_tokens: 96,
      messages: [
        { role: 'system', content: `You are an inline code completion engine for ${String(language).slice(0, 20)}. Continue the code exactly at the cursor, between <prefix> and <suffix>. Output ONLY the text to insert: no explanation, no markdown fences, no repeating the prefix. Keep it short (the rest of the line, or at most a few lines). If nothing sensible, output nothing.` },
        { role: 'user', content: `<prefix>\n${prefix.slice(-1800)}\n</prefix>\n<suffix>\n${String(suffix).slice(0, 600)}\n</suffix>` },
      ],
    })
    for await (const c of stream) { out += c.choices?.[0]?.delta?.content || ''; if (out.length > 500) break }
    out = out.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '')
    res.json({ text: out.trimEnd() })
  } catch { res.json({ text: '' }) }
})

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
// Last stop for errors: never show internals (stack traces, file paths) to the browser.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too big.' })
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' })
  console.error('server error:', err?.message || err)
  res.status(500).json({ error: 'Something went wrong. Try again.' })
})

registerMcp(app)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on port ${PORT}`)
  // Keep Render's free tier awake (it sleeps after ~15 min without traffic)
  // Daily cleanup of stale usage rows (keeps the table small)
  const cleanup = () => supabaseAdmin?.from('stream_usage').delete().lt('updated_at', new Date(Date.now() - 30 * 864e5).toISOString()).then(() => {}, () => {})
  cleanup(); setInterval(cleanup, 24 * 60 * 60 * 1000)
  const self = process.env.RENDER_EXTERNAL_URL
  if (self) setInterval(() => fetch(self + '/api/health').catch(() => {}), 10 * 60 * 1000)
})