import './env.js'
import express from 'express'
import cors from 'cors'
import Groq from 'groq-sdk'
import crypto from 'crypto'
import path from 'path'
import * as esbuild from 'esbuild'
import { attachUser } from './auth.js'
import { checkLimit, recordUsage, getUsage, THINKING_MULTIPLIERS, issueTurn, useTurn } from './usage.js'
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
app.set('trust proxy', 1)

// Only your own sites may call this API from a browser.
// Add more (custom domain, preview links) in the ALLOWED_ORIGINS env var, separated by commas.
const clean = (u) => String(u || '').trim().replace(/\/+$/, '')
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
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
async function fallbackModels(exclude) {
  const ids = await availableModels()
  const pool = ids.length ? ids : PREFERRED
  const ordered = [...PREFERRED.filter((m) => pool.includes(m)), ...pool.filter((m) => !PREFERRED.includes(m) && !/vision|scout|maverick/i.test(m))]
  return ordered.filter((m) => !exclude.has(m))
}

// Streams a completion with automatic recovery: empty reply, tool-call confusion or an unavailable
// model move on to the next available model (only possible while no text has been sent yet).
async function* guardedStream(params) {
  const BAD = /tool choice is none|called a tool|tool_use_failed|tool_call|decommission|model_not_found|does not exist|not supported|not available|no access|permission/i
  const tried = new Set()
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
        cur = { ...cur, max_tokens: Math.min((cur.max_tokens || 4096) + 4000, 16000), reasoning_effort: 'low' }
        continue
      }
    } catch (err) {
      lastErr = err
      if (got) throw err
      const msg = `${err?.message || ''} ${JSON.stringify(err?.error || '')}`
      console.log(`[ai] ${cur.model} failed: ${msg.slice(0, 200)}`)
      if (!BAD.test(msg) && err?.status !== 404 && err?.status !== 400) throw err
    }
    const next = (await fallbackModels(tried))[0]
    if (!next) break
    console.log(`[ai] switching to ${next}`)
    const { reasoning_effort, reasoning_format, tools, tool_choice, ...rest } = cur
    cur = { ...rest, model: next, max_tokens: Math.min(cur.max_tokens || 4096, 8000) }
    if (/gpt-oss/.test(next)) cur.reasoning_effort = 'low'
  }
  if (lastErr) throw lastErr
}

// ------------------------------------------------------------
// Retry wrapper
// ------------------------------------------------------------
async function callGroqWithRetry(params, maxAttempts = 4) {
  let lastErr
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
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
- Complete, working code. No TODO, no "...", no placeholder functions, no lorem ipsum unless asked.
- NEVER reference local files that do not exist (images/photo.jpg, logo.png...). For pictures use inline SVG, CSS gradients, emoji, or https://picsum.photos/seed/<word>/600/400 so nothing shows as broken.
- Every id, class, import, script src and link must match something that exists. Check this before you answer.
- Make pages responsive (viewport meta, flex/grid, no fixed widths that overflow on phones), accessible (alt text, labels, contrast, semantic tags) and handle empty, loading and error states.
- Escape JSON correctly: inside "content" strings use \\n for newlines and \\" for quotes.
- If you are not sure about a library API or version, use the stable well-known form. If LIVE WEB RESULTS are given below, trust them over your memory.

WRITE CLEAN TEXT
- The fields "explanation", "plan", "title", "summary" and "description" are plain sentences: no markdown, no asterisks, no backticks, no emoji.`

const CHAT_GUIDE = `

## HOW TO ANSWER
- Understand the real question first, then answer directly. Lead with the answer or the fix, then a short why.
- Be accurate: if unsure about an API or version, say so instead of guessing. Use the LIVE WEB RESULTS when they are given.
- Show code when it helps (up to about 40 lines, in a fenced block with the language). Explain what to change and where. For whole features or new files, tell the user to switch to Agent mode.
- Use light formatting: short paragraphs, bullet lists for steps, **bold** only for key terms. Never leave stray symbols.
- If the question is unclear, ask ONE short clarifying question.
- Do NOT use the terminal unless you must read existing code to answer.`

const EDIT_FILE_RULES = `
- For a change inside an EXISTING file use edit_file: { "type": "edit_file", "path": "src/App.jsx", "edits": [ { "find": "exact old text", "replace": "new text" } ] }.
  "find" must be copied exactly from the file (without line numbers), be short (1 to 6 lines) and appear only once. Several edits per file are fine. This is far cheaper than rewriting the file.
- Use write_file / create_file only for new files or when most of a file changes.`

app.post('/api/chat', async (req, res) => {
  const { messages, code, language, model, thinking, behavior, activeFile } = req.body
  const images = cleanImages(req.body.images)
  const ex = exploreContext(req.body)
  // terminal-read follow-ups of the same question are free; the first round is charged
  const followUp = !!ex && useTurn(req, req.body.turn)
  const thinkingCost = followUp ? 0 : (THINKING_MULTIPLIERS[thinking] || THINKING_MULTIPLIERS.medium) + (images.length ? 1 : 0)
  if (!followUp) {
    const limit = await checkLimit(req, thinkingCost)
    if (!limit.allowed) return res.status(429).json({ error: limit.message, tier: limit.tier })
  }
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' })

  const behavioralSuffix = getBehavioralPrefix(behavior)
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
      model: images.length ? VISION_MODEL : (model || 'openai/gpt-oss-20b'),
      messages: [{ role: 'system', content: systemPrompt + (webCtx || '') }, ...chatMessages],
      stream: true,
      temperature: 0.6,
      max_tokens: thinking === 'ultra' ? 4096 : thinking === 'high' ? 3072 : 2048,
      ...(images.length ? { reasoning_format: 'hidden' } : {}),
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
    res.write(`data: ${JSON.stringify({ error: friendlyError(err) })}\n\n`)
    res.end()
  }
})

app.post('/api/agent', async (req, res) => {
  const { prompt, files, activeFile, history, model, thinking, behavior } = req.body
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

  const fileList = Object.entries(files || {})
    .filter(([p]) => !p.endsWith('.gitkeep') && !p.endsWith('.lock') && !p.endsWith('.log') && !p.startsWith('node_modules/'))
    .map(([p, f]) => {
      const content = (f.content || '').slice(0, MAX_FILE_CHARS)
      const truncated = (f.content || '').length > MAX_FILE_CHARS ? '\n…(truncated)' : ''
      return `--- ${p} ---\n${content}${truncated}`
    })
    .join('\n\n')
    .slice(0, MAX_TOTAL_CHARS)

  const SYSTEM = `You are the ION Qoders Agent, an autonomous coding agent.

You respond with ONLY a JSON object:

{
  "explanation": "one-line summary",
  "plan": ["step 1", "step 2"],
  "operations": [
    { "type": "create_file", "path": "src/New.jsx", "content": "..." },
    { "type": "write_file",  "path": "src/App.jsx", "content": "..." },
    { "type": "edit_file",   "path": "src/App.jsx", "edits": [ { "find": "exact old text", "replace": "new text" } ] },
    { "type": "delete_file", "path": "src/Old.jsx" }
  ],
  "actions": [ { "type": "github_push", "message": "Add pricing page" } ]
}

"actions" is OPTIONAL. Leave it out unless the user explicitly asked for one of these. The user must approve every action, you can never run them yourself:
- github_push: the user wants the project saved/pushed to GitHub (opens the push dialog). "message" = a git commit message for what changed (imperative, max 72 characters, plain text)
- github_import: the user wants to import a GitHub repo (opens the import dialog); optional "repo": "owner/name" (only if the user named it)
- run_preview: the user wants to see the project running (opens the live preview)
- run_tests: the user wants the project checked for errors
Never say you pushed, imported or ran something. Say it is waiting for their approval. If the user only asks for these actions, "operations" can be an empty list.

No markdown, no fences, no prose outside JSON.

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
- JSX in .jsx files. Entry: HTML with <div id="root"></div> + <script type="module" src="main.jsx"></script>${QUALITY_GUIDE}${shellPart(ex)}${getBehavioralPrefix(behavior)}`

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
      model: images.length ? VISION_MODEL : (model || 'openai/gpt-oss-20b'),
      messages: [{ role: 'system', content: SYSTEM }, ...conversation],
      stream: true,
      temperature: 0.2,
      max_tokens: thinking === 'ultra' ? 8000 : thinking === 'high' ? 6000 : 4096,
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

app.post('/api/agent/plan', async (req, res) => {
  const { prompt, files, activeFile, history, model, thinking, behavior } = req.body
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

  const fileList = Object.entries(files || {})
    .filter(([p]) => !p.endsWith('.gitkeep') && !p.endsWith('.lock') && !p.endsWith('.log') && !p.startsWith('node_modules/'))
    .map(([p, f]) => {
      const content = (f.content || '').slice(0, MAX_FILE_CHARS)
      const truncated = (f.content || '').length > MAX_FILE_CHARS ? '\n…(truncated)' : ''
      return `--- ${p} ---\n${content}${truncated}`
    })
    .join('\n\n')
    .slice(0, MAX_TOTAL_CHARS)

  const SYSTEM = `You are the ION Qoders Planner, an expert software architect.

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

No markdown. No fences. No prose outside JSON.${QUALITY_GUIDE}${shellPart(ex)}${getBehavioralPrefix(behavior)}`

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
      model: images.length ? VISION_MODEL : (model || 'openai/gpt-oss-20b'),
      messages: [{ role: 'system', content: SYSTEM }, ...conversation],
      stream: true,
      temperature: 0.2,
      max_tokens: 4000,
      ...(images.length
        ? { reasoning_format: 'hidden' }
        : {
            reasoning_effort: thinking === 'ultra' || thinking === 'high' ? 'high' : 'medium',
          }),
    })
    let totalChars = 0
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) { totalChars += text.length; res.write(`data: ${JSON.stringify({ text })}\n\n`) }
    }
    if (totalChars === 0) res.write(`data: ${JSON.stringify({ error: 'AI returned empty plan.' })}\n\n`)
    res.write('data: [DONE]\n\n')
    if (!followUp) recordUsage(req, thinkingCost)
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

  const SYSTEM = `You are the ION Qoders Agent executing ONE STEP of a multi-step plan.

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
    { "type": "write_file",  "path": "styles.css", "content": "..." },
    { "type": "edit_file",   "path": "src/App.jsx", "edits": [ { "find": "exact old text", "replace": "new text" } ] }
  ]
}

## RULES
- FULL file content for create_file / write_file. No snippets, no diffs.${EDIT_FILE_RULES}
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

No markdown. No fences. No prose outside JSON.${QUALITY_GUIDE}${shellPart(ex)}${getBehavioralPrefix(behavior)}`

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
      model: model || 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER },
      ],
      stream: true,
      temperature: 0.2,
      max_tokens: 6000,
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
      model: model || 'openai/gpt-oss-20b',
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
    res.status(500).json({ error: friendlyError(err) })
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
    res.status(500).json({ error: friendlyError(err) })
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
app.post('/api/search', async (req, res) => {
  const results = await webSearch(req.body?.query, Math.min(Number(req.body?.maxResults) || 5, 8))
  res.json({ results })
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on port ${PORT}`)
  // Keep Render's free tier awake (it sleeps after ~15 min without traffic)
  // Daily cleanup of stale usage rows (keeps the table small)
  const cleanup = () => supabaseAdmin?.from('stream_usage').delete().lt('updated_at', new Date(Date.now() - 30 * 864e5).toISOString()).then(() => {}, () => {})
  cleanup(); setInterval(cleanup, 24 * 60 * 60 * 1000)
  const self = process.env.RENDER_EXTERNAL_URL
  if (self) setInterval(() => fetch(self + '/api/health').catch(() => {}), 10 * 60 * 1000)
})