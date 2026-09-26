import './env.js'
import express from 'express'
import cors from 'cors'
import Groq from 'groq-sdk'
import crypto from 'crypto'
import { attachUser } from './auth.js'
import { checkLimit, recordUsage, getUsage } from './usage.js'

const app = express()

// Allow localhost during dev + the deployed frontend in production
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
app.use(express.json())
// Attach user info to every request (auth optional)
app.use(attachUser)

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
  timeout: 120000,
  maxRetries: 1,
})

// ============================================================
// IN-MEMORY STATE
// ============================================================

const previewSessions = new Map()
const previewErrors = new Map()

setInterval(() => {
  const now = Date.now()
  for (const [id, session] of previewSessions.entries()) {
    if (now - session.updatedAt > 2 * 60 * 60 * 1000) {
      previewSessions.delete(id)
    }
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
    '      fetch("/api/preview/log", {',
    '        method: "POST",',
    '        headers: { "Content-Type": "application/json" },',
    '        body: JSON.stringify({',
    '          sessionId: SESSION,',
    '          level: level,',
    '          text: args.map(function(a) {',
    '            try { return typeof a === "string" ? a : JSON.stringify(a) } catch (e) { return String(a) }',
    '          }).join(" ")',
    '        })',
    '      }).catch(function() {})',
    '    } catch (e) {}',
    '  };',
    '  var origLog = console.log;',
    '  var origErr = console.error;',
    '  var origWarn = console.warn;',
    '  console.log = function() { send("log", Array.prototype.slice.call(arguments)); origLog.apply(console, arguments); };',
    '  console.error = function() { send("error", Array.prototype.slice.call(arguments)); origErr.apply(console, arguments); };',
    '  console.warn = function() { send("warn", Array.prototype.slice.call(arguments)); origWarn.apply(console, arguments); };',
    '  window.onerror = function(msg, src, line, col, err) {',
    '    send("error", [msg + " (line " + line + ")"])',
    '  };',
    '  window.addEventListener("unhandledrejection", function(e) {',
    '    send("error", ["Unhandled promise rejection: " + (e.reason && e.reason.message || e.reason)])',
    '  });',
    '})()',
  ].join('\n')
}

function buildPreviewHtml(files, activeFile, sessionId) {
  let htmlPath = null
   
  if (activeFile && files[activeFile] && activeFile.endsWith('.html')) {
    htmlPath = activeFile
  }
  if (!htmlPath) {
    htmlPath =
      Object.keys(files).find((p) => p === 'public/index.html') ||
      Object.keys(files).find((p) => p === 'index.html') ||
      Object.keys(files).find((p) => p.endsWith('.html'))
  }

  let html = htmlPath
    ? files[htmlPath].content
    : `<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>`

      // Strip any Vite dev-server injections that may have leaked into the HTML.
  // These scripts only work in the Vite dev server and break our preview.
  html = html
    .replace(/<script[^>]*src=["'][^"']*@vite\/client[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script[^>]*src=["'][^"']*@react-refresh[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script[^>]*type=["']module["'][^>]*src=["'][^"']*\/src\/main\.[jt]sx?[^"']*["'][^>]*>\s*<\/script>/gi, '')

  const cssFiles = Object.entries(files).filter(([p]) => p.endsWith('.css'))
  const cssBlock = cssFiles.map(([p, f]) => `/* ${p} */\n${f.content}`).join('\n\n')

  const jsFiles = Object.entries(files).filter(
    ([p]) => (p.endsWith('.js') || p.endsWith('.jsx')) && !p.endsWith('.config.js')
  )
  const jsBlock = jsFiles.map(([p, f]) => `// ${p}\n${f.content}`).join('\n\n')

  const hasOwnStructure = /<html[\s>]/i.test(html)

  if (hasOwnStructure) {
    const shim = buildConsoleShim(sessionId)
    html = html.includes('</head>')
      ? html.replace('</head>', `<script>${shim}</script></head>`)
      : `<script>${shim}</script>${html}`
    return html
  }

  if (cssBlock) {
    html = html.includes('</head>')
      ? html.replace('</head>', `<style>${cssBlock}</style></head>`)
      : `<style>${cssBlock}</style>` + html
  }

  const scriptBlock = `<script>${buildConsoleShim(sessionId)}\n${jsBlock}</script>`
  html = html.includes('</body>')
    ? html.replace('</body>', `${scriptBlock}</body>`)
    : html + scriptBlock

  return html
}

// ============================================================
// API ROUTES
// ============================================================

app.post('/api/chat', async (req, res) => {
  const limit = checkLimit(req)
  if (!limit.allowed) {
    return res.status(429).json({ error: limit.message, tier: limit.tier })
  }

  const { messages, code, language, model } = req.body

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' })
  }

  const systemPrompt = `You are Stream, a knowledgeable coding assistant inside a browser-based code editor.

## WHO YOU ARE
You are the user's pair-programmer. Think of yourself as a senior dev sitting next to them.
You help them understand their code, plan features, debug problems, and make decisions.
You are honest — if their approach has problems, say so. You are encouraging — point out what's working too.

## WHAT YOU DO IN THIS MODE
- Answer questions about the code they're writing
- Explain concepts, patterns, and tradeoffs
- Help them plan what to build next
- Diagnose why something might not work
- Suggest approaches without writing the full implementation

## WHAT YOU DON'T DO IN THIS MODE
- You don't write code for them. That's Agent mode.
- If they ask you to build / add / change / create / fix code, say:
  "That's a job for Agent mode — switch the toggle at the top and ask me there. I'll write it into your editor so you can review the diff."
- You don't dump full files. If a 3-line snippet illustrates a point, fine. But full rewrites? No.

## HOW TO READ THEIR CODE
When the user has a file open, you'll see it below. Look at it carefully:
- What is this file trying to do? (Look at names, structure, comments.)
- What pattern are they using? (Functional? OOP? React hooks?)
- What's their style? (Semicolons? Quotes? Indentation?)
- Is anything obviously broken?

When they ask "how do I fix X?", reference the ACTUAL code they have. Don't give generic advice.
When they ask "what does this do?", explain THEIR specific code, not a textbook definition.

## HOW TO READ THEIR PROJECT CONTEXT
You only see the currently open file. If a question depends on other files (imports, config, etc.), ask them what those files look like, or tell them to switch to Agent mode where you can see the whole project.

## TONE
- Concise. No filler. No "great question!" openers.
- Direct. Use code formatting when referring to identifiers: \`myVar\`, \`useState\`.
- Honest. If their code is buggy, say so plainly — but constructively.
- Adaptive. If they're a beginner, explain more. If they're experienced, skip the basics.

## OUTPUT FORMAT
- Plain prose. Markdown allowed (\`code\`, **bold**, lists).
- Short snippets OK — always fenced with language tag.
- No emoji spam. An occasional ✅ or ⚠️ for clarity is fine.

${language ? `## CURRENT FILE\nLanguage: ${language}` : ''}
${code ? `\n\`\`\`${language || ''}\n${code}\n\`\`\`` : ''}`

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await groq.chat.completions.create({
      model: model || 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      stream: true,
      temperature: 0.6,
      max_tokens: 2048,
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`)
      }
    }

    res.write('data: [DONE]\n\n')
    recordUsage(req)
    res.end()
  } catch (err) {
    console.error('Groq error:', err)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

app.post('/api/edit', async (req, res) => {
  const limit = checkLimit(req)
  if (!limit.allowed) {
    return res.status(429).json({ error: limit.message, tier: limit.tier })
  }

  const { action, code, selection, language, instruction, model } = req.body

  if (!action) {
    return res.status(400).json({ error: 'action required' })
  }

  const SYSTEM = `You are Stream's code transformer. You take code in, you return code out. Nothing else.

## OUTPUT RULES (CRITICAL)
- Return ONLY the resulting code. No prose. No explanation. No preamble. No "here's the fixed version".
- NEVER wrap output in \`\`\` fences. The response IS the code.
- NEVER add comments explaining what you changed. If comments belong in the code, add them naturally — but no meta-commentary.
- Preserve the user's style EXACTLY:
  - Same quote style (single vs double)
  - Same semicolon usage
  - Same indentation (spaces vs tabs, width)
  - Same naming conventions (camelCase vs snake_case)
  - Same level of comments

## HOW TO READ THE CODE
Before making changes, understand:
- What language? (JS, TS, Python, HTML, etc.)
- What is this code doing?
- What's the user's intent? (A bug fix? A refactor? Adding a feature?)
- What conventions does this codebase already use?

## TASK-SPECIFIC BEHAVIOR
- **complete**: Continue the code naturally from where it ends. Keep the same style. Return the FULL file (original + your completion).
- **fix**: Find real bugs. Fix them minimally. Don't refactor unrelated code. Return the FULL corrected file.
- **refactor**: Improve readability and idiomatic-ness, but PRESERVE behavior. Don't change the API. Return the FULL refactored file.
- **comment**: Add useful comments. Do NOT change logic, variable names, or structure. Return the FULL commented file.
- **explain**: Return a short comment block at the top of the file explaining it. Do NOT change the actual code below.
- **custom**: Do exactly what the instruction says. Nothing more, nothing less.
- **selection**: You're given a snippet. Return ONLY the modified snippet. Same scope. Don't wrap it in the rest of the file.

## QUALITY BAR
- If you're fixing a bug, the fix must actually work — don't just move code around.
- If you're completing code, the completion must be plausible and useful, not filler.
- If the input is already fine, return it unchanged. Don't invent problems.`

  const prompts = {
    complete: `Complete the following ${language} code. Continue naturally from where it ends. Return the FULL file (original + completion).\n\nCODE:\n${code}`,
    fix: `Find and fix bugs/errors in this ${language} code. Return the FULL corrected file.\n\nCODE:\n${code}`,
    refactor: `Refactor this ${language} code to be cleaner and more idiomatic. Return the FULL refactored file.\n\nCODE:\n${code}`,
    comment: `Add helpful comments to this ${language} code. Return the FULL commented file. Don't change logic, just add comments.\n\nCODE:\n${code}`,
    explain: `Explain what this ${language} code does. Be concise (max 3 short paragraphs). Respond in plain text, not code.\n\nCODE:\n${code}`,
    custom: `Task: ${instruction}\n\nReturn the FULL modified ${language} file.\n\nCODE:\n${code}`,
    selection: selection && selection.trim()
      ? `Here is a snippet selected in a larger ${language} file. Task: ${instruction || 'improve this code'}. Return ONLY the improved snippet — same scope, do not include the rest of the file.\n\nSNIPPET:\n${selection}`
      : `Task: ${instruction || 'improve this file'}. Return the FULL improved ${language} file.\n\nCODE:\n${code || ''}`,
  }

  const userPrompt = prompts[action]
  if (!userPrompt) return res.status(400).json({ error: `unknown action: ${action}` })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await groq.chat.completions.create({
      model: model || 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 4096,
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`)
    }

    res.write('data: [DONE]\n\n')
    recordUsage(req)
    res.end()
  } catch (err) {
    console.error('Edit error:', err)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

app.post('/api/agent', async (req, res) => {
  const limit = checkLimit(req)
  if (!limit.allowed) {
    return res.status(429).json({ error: limit.message, tier: limit.tier })
  }

  const { prompt, files, activeFile, history, model } = req.body

  if (!prompt) return res.status(400).json({ error: 'prompt required' })

  const MAX_FILE_CHARS = 4000
  const MAX_TOTAL_CHARS = 20000

  const fileList = Object.entries(files || {})
    .filter(([path]) => {
      if (path.endsWith('.gitkeep')) return false
      if (path.endsWith('.lock')) return false
      if (path.endsWith('.log')) return false
      if (path.startsWith('node_modules/')) return false
      return true
    })
    .map(([path, f]) => {
      const content = (f.content || '').slice(0, MAX_FILE_CHARS)
      const truncated = (f.content || '').length > MAX_FILE_CHARS ? '\n…(truncated)' : ''
      return `--- ${path} ---\n${content}${truncated}`
    })
    .join('\n\n')
    .slice(0, MAX_TOTAL_CHARS)

 const SYSTEM = `You are Stream Agent, an autonomous coding agent working inside a browser-based code editor.

You receive a request and the current state of the user's project. You respond with ONLY a JSON object.

## RESPONSE FORMAT (STRICT)

{
  "explanation": "one-line summary of what you did",
  "plan": ["step 1", "step 2", "step 3"],
  "operations": [
    { "type": "create_file", "path": "src/NewFile.jsx", "content": "..." },
    { "type": "write_file",  "path": "src/App.jsx",     "content": "..." },
    { "type": "delete_file", "path": "src/Old.jsx" }
  ]
}

- No markdown. No code fences. No prose outside the JSON.
- "plan" is optional. Include it when the task has 2+ logical steps.

## HOW TO APPROACH EVERY REQUEST

### Step 1 — Understand the project
Before you write anything, look at the files you were given:
- What language / framework? (Plain HTML? React? Vue? Node?)
- What folder structure?
- What's the user's code style? (Semicolons? Quotes? Indentation? Comments?)
- Are there existing utilities, components, or helpers you should reuse?

### Step 2 — Understand the request IN CONTEXT
- What is the user literally asking for?
- What files would this require?
- Is this a follow-up to a previous turn? (Check the conversation history.)
  - If yes: EXTEND what's already there. Don't start over.
  - "Add X to the login page" means: find the login page, add X to it.
  - "Fix the header" means: find the header, fix it. Don't rewrite the whole file.
- What is the user ACTUALLY trying to build? (If they say "make a signup page", they probably mean a complete page — form, styling, structure — not just an HTML skeleton.)

### Step 3 — Plan the minimal change
- Only touch files that MUST change. Nothing else.
- Don't "clean up" or "improve" code the user didn't ask about.
- Don't re-create files that already exist.
- Prefer EDITING an existing file over creating a new one.
- If a request would break existing functionality, either handle it or ask first.

### Step 4 — Write good code
- Match the codebase's conventions.
- No placeholders. No "// TODO". No fake function names.
- All imports must reference files that exist OR that you're creating in the same response.
- If creating React components: they must render. No dangling references.
- If HTML: full valid document, no Vite-only scripts (see below).

## HARD RULES

- Paths are relative to project root (e.g. "src/App.jsx", NEVER "/src/App.jsx").
- For write_file and create_file: return the FULL file content, not a diff or snippet.
- Never create_file AND write_file for the same path in one response — just one.
- Only use delete_file when the user explicitly asks.
- For React: components in src/components/, hooks in src/hooks/, utils in src/utils/.
- For plain HTML projects: work with the .html/.css/.js files already present.

## HTML FILES — VERY IMPORTANT

If you create or edit any .html file:
- NEVER include <script type="module" src="/src/main.jsx"></script> or similar Vite/React entry scripts.
- NEVER include <script src="/@vite/client"></script> or /@react-refresh.
- These are injected by the dev server at runtime and break static previews.
- For a static page: use plain <script src="somename.js"></script> or inline <script>...</script> only.
- If the page needs React: put the JSX in .jsx files and wire it into the existing React app — don't put React entry scripts in a standalone HTML file.

## WHEN TO DECLINE

- **Request is unclear** → operations: [], explanation politely asks for clarification. Example: "What should the button do when clicked?"
- **Request is impossible given the setup** → operations: [], explanation says why. Example: "This project is React, but you're asking for a Python backend — I'd need a Node.js backend which we don't have here."
- **Already done** → operations: [], explanation says "This already exists in src/components/Header.jsx — nothing to change."
- **Would break the project** → operations: [], explanation explains the tradeoff and suggests an alternative.

Never invent a solution to a problem you don't understand. Asking is better than guessing.

## QUALITY CHECKLIST (RUN BEFORE RESPONDING)

- [ ] Did I read the existing files, not just skim them?
- [ ] Did I match their code style?
- [ ] Are all my imports valid?
- [ ] Are my operations the MINIMUM needed?
- [ ] Does my JSON parse? (No stray commas. No escaped quotes.)
- [ ] Did I avoid adding Vite-only scripts to HTML?`

  const conversation = Array.isArray(history)
    ? history.slice(-20).map((m) => ({
        role: m.role,
        content: m.text || m.content || '',
      }))
    : []

  const USER = `Project files:

${fileList}

${activeFile ? `User's currently open file: ${activeFile}\n` : ''}
User request: ${prompt}`

  conversation.push({ role: 'user', content: USER })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await groq.chat.completions.create({
      model: model || 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: SYSTEM },
        ...conversation,
      ],
      stream: true,
      temperature: 0.2,
      max_tokens: 8192,
      reasoning_effort: 'medium',
      response_format: { type: 'json_object' },
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`)
    }
    res.write('data: [DONE]\n\n')
    recordUsage(req)
    res.end()
  } catch (err) {
    console.error('Agent error:', err)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

app.post('/api/agent/test', async (req, res) => {
  const { sessionId, files, activeFile } = req.body

  if (!sessionId || !files) {
    return res.status(400).json({ error: 'sessionId and files required' })
  }

  previewSessions.set(sessionId, {
    files,
    activeFile,
    updatedAt: Date.now(),
  })

  previewErrors.set(sessionId, [])

  res.json({
    ok: true,
    previewUrl: `/preview/${sessionId}`,
  })
})

app.post('/api/agent/diagnose', async (req, res) => {
  const { sessionId, files, activeFile, errors, originalPrompt, attempt, model } = req.body

  if (!files) return res.status(400).json({ error: 'files required' })

  const errorList = Array.isArray(errors) && errors.length > 0
    ? errors.map((e) => `[${e.level}] ${e.text}`).join('\n')
    : '(no console errors reported)'

  const fileList = Object.entries(files || {})
    .filter(([p]) => !p.endsWith('.gitkeep') && !p.endsWith('.log'))
    .map(([path, f]) => `--- ${path} ---\n${(f.content || '').slice(0, 3000)}${(f.content || '').length > 3000 ? '\n…(truncated)' : ''}`)
    .join('\n\n')
    .slice(0, 18000)

  const SYSTEM = `You are Stream Agent in TEST mode. You just applied changes and now you're checking whether they broke anything.

## CONTEXT
The user originally asked: "${originalPrompt || '(unknown)'}"

The current project files are below. The preview was loaded and produced this console output:

${errorList}

## YOUR JOB

Look at the console output AND the current code. Decide one of three things:

### 1. Everything looks fine → status: "ok"
Respond: { "status": "ok", "summary": "short success message" }
Use this when:
- No error-level messages
- Only console.log / info from user code
- The change matches what was asked

### 2. Something is broken → status: "fix"
Respond: { "status": "fix", "summary": "what's wrong", "operations": [...] }
Use this when:
- You see error-level messages ("Uncaught", "TypeError", "is not defined", etc.)
- The code clearly has a bug (missing imports, undefined variables, broken syntax)
- The change broke something the user didn't ask to break

### 3. Console has noise but nothing is wrong → status: "ok"
Respond: { "status": "ok", "summary": "notes about what you observed" }
Use this when:
- The "errors" are informational (CORS warnings about dev servers, ad-blocker messages, etc.)
- The project has no HTML files (nothing to preview)
- The messages are from a different origin than the preview itself

## RULES FOR PROPOSING FIXES

If status is "fix":
- Only fix REAL errors, not style preferences.
- Fix the MINIMUM needed. Don't rewrite unrelated code.
- Never propose the same fix that was already applied (check the previous attempts context).
- If you've already tried a fix and it didn't work, try a DIFFERENT approach — don't repeat yourself.
- The operations format is the same as the agent: create_file, write_file, delete_file.

## WHAT'S NOT AN ERROR

- console.log output from user code
- Warnings about favicon.ico not found
- Deprecation warnings from libraries
- 404s from other origins (like dev server scripts)
- "Failed to load resource" for URLs that aren't part of the user's project

## OUTPUT FORMAT (STRICT)

{
  "status": "ok" | "fix",
  "summary": "short message",
  "operations": [ ... ]   // ONLY if status === "fix"
}

No markdown. No code fences. No commentary.`

  const USER = `Attempt: ${attempt || 1}
Active file: ${activeFile || '(unknown)'}

Project files:

${fileList}

Console output:

${errorList}`

  try {
    const completion = await groq.chat.completions.create({
      model: model || 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER },
      ],
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    })

    const raw = completion.choices[0]?.message?.content || '{}'
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return res.json({ status: 'ok', summary: 'Could not parse AI diagnosis; assuming OK.' })
    }

    res.json(parsed)
  } catch (err) {
    console.error('Diagnose error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ---------- Preview endpoints ----------

app.post('/api/preview/session', (req, res) => {
  const { sessionId, files, activeFile } = req.body
  if (!files || typeof files !== 'object') {
    return res.status(400).json({ error: 'files required' })
  }

  let id = sessionId
  if (!id || !previewSessions.has(id)) {
    id = crypto.randomBytes(8).toString('hex')
  }

  previewSessions.set(id, {
    files,
    activeFile,
    updatedAt: Date.now(),
  })

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
  const errors = previewErrors.get(req.params.id) || []
  res.json({ errors })
})

app.delete('/api/preview/errors/:id', (req, res) => {
  previewErrors.delete(req.params.id)
  res.json({ ok: true })
})

app.get('/preview/:id', (req, res) => {
  const session = previewSessions.get(req.params.id)
  if (!session) {
    return res.status(404).send(`
      <html><body style="background:#0d1117;color:#e6edf3;font-family:sans-serif;padding:40px;text-align:center">
        <h1>Session not found</h1>
        <p>This preview session expired or was never created. Go back to Stream and click "Open preview URL" again.</p>
      </body></html>
    `)
  }

  const html = buildPreviewHtml(session.files, session.activeFile, req.params.id)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.send(html)
})
// Serve files inside a preview session (CSS, JS, HTML sub-pages, images, etc.)
app.get('/preview/:id/*filePath', (req, res) => {
  const session = previewSessions.get(req.params.id)
  if (!session) {
    return res.status(404).send('Session not found')
  }

  // Express 5 returns wildcard params as an array of segments
  const rawPath = req.params.filePath
  const filePath = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '')
  if (!filePath) return res.status(404).send('File not found')

  // Try a few variations — the browser might request "styles.css"
  // while the file lives at "public/styles.css" or "src/styles.css"
  const candidates = [
    filePath,
    `public/${filePath}`,
    `src/${filePath}`,
    `src/styles/${filePath}`,
  ]

  let file = null
  for (const candidate of candidates) {
    if (session.files[candidate]) {
      file = session.files[candidate]
      break
    }
  }

  // Also try: strip leading "public/" or "src/" from the request
  if (!file) {
    const stripped = filePath.replace(/^(public|src)\//, '')
    if (session.files[stripped]) file = session.files[stripped]
  }

  if (!file) {
    // Last resort: fuzzy match by basename
    const requestedName = filePath.split('/').pop()
    const matchKey = Object.keys(session.files).find(
      (p) => p.split('/').pop() === requestedName
    )
    if (matchKey) file = session.files[matchKey]
  }

  if (!file) {
    return res.status(404).send(`File not found: ${filePath}`)
  }

  // Serve with the right content type
  const ext = filePath.split('.').pop()?.toLowerCase()
  const types = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    ico: 'image/x-icon',
    txt: 'text/plain; charset=utf-8',
    md: 'text/plain; charset=utf-8',
  }

  const contentType = types[ext] || 'text/plain; charset=utf-8'
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'no-cache')

  // If it's HTML, inject the console shim
  if (ext === 'html' || ext === 'htm') {
    let html = file.content || ''

    // Strip Vite/React-refresh injections
    html = html
      .replace(/<script[^>]*src=["'][^"']*@vite\/client[^"']*["'][^>]*>\s*<\/script>/gi, '')
      .replace(/<script[^>]*src=["'][^"']*@react-refresh[^"']*["'][^>]*>\s*<\/script>/gi, '')
      .replace(/<script[^>]*type=["']module["'][^>]*src=["'][^"']*\/src\/main\.[jt]sx?[^"']*["'][^>]*>\s*<\/script>/gi, '')

    const shim = buildConsoleShim(req.params.id)
    html = html.includes('</head>')
      ? html.replace('</head>', `<script>${shim}</script></head>`)
      : `<script>${shim}</script>${html}`
    return res.send(html)
  }

  res.send(file.content || '')
})

// ---------- Health check ----------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasKey: !!process.env.GROQ_API_KEY })
})
app.get('/api/usage', (req, res) => {
  const u = getUsage(req)
  res.json(u)
})

// ---------- Start server ----------
const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on port ${PORT}`)
})