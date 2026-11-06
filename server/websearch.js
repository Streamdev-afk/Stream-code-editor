// Web search for the AI: Groq's built-in search (groq/compound-mini) first, then Tavily/DuckDuckGo as fallbacks.
const cache = new Map() // query -> { at, results }
const TTL = 10 * 60 * 1000

const NEEDS_WEB = /\b(latest|newest|current(ly)?|recent|today|20(2[4-9]|3\d)|docs?|documentation|version|release|changelog|deprecated|breaking|api|sdk|npm|package|library|framework|install|how (do|to|can)|error|exception|price|pricing|news|search|look ?up|google|compare|best way|best practice)\b/i

export function wantsWeb(req, text) {
  const w = req.body?.web
  if (w === false || w === 'off') return false
  if (/\b(search the web|search online|look (it )?up|google it|browse)\b/i.test(text || '')) return true
  return NEEDS_WEB.test(text || '')
}

async function tavily(query, max) {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: max, search_depth: 'basic' }),
    signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) throw new Error(`tavily ${r.status}`)
  const j = await r.json()
  return (j.results || []).map((x) => ({ title: x.title, url: x.url, snippet: (x.content || '').slice(0, 500) }))
}

// Groq's built-in web search (compound models search the web themselves, no extra key needed)
async function groqSearch(query, max) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: process.env.WEB_MODEL || 'groq/compound-mini',
      messages: [{ role: 'user', content: `Search the web and answer with the most current, accurate facts for this developer question. Be brief (under 250 words), include exact versions/APIs/errors fixes, and list source URLs.\n\nQuestion: ${query}` }],
      max_tokens: 700,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(20000),
  })
  if (!r.ok) throw new Error(`groq search ${r.status}`)
  const j = await r.json()
  const msg = j.choices?.[0]?.message || {}
  const found = (msg.executed_tools || []).flatMap((t) => t.search_results?.results || [])
  const out = []
  if (msg.content) out.push({ title: 'Summary from live web search', url: '', snippet: String(msg.content).slice(0, 1800) })
  for (const x of found.slice(0, max - out.length)) out.push({ title: x.title, url: x.url, snippet: String(x.content || '').slice(0, 300) })
  return out
}

function decodeHtml(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

async function ddg(query, max) {
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IONQoders/1.0)' },
    signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) throw new Error(`ddg ${r.status}`)
  const html = await r.text()
  const out = []
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let m
  while ((m = re.exec(html)) && out.length < max) {
    let url = m[1]
    const u = url.match(/uddg=([^&]+)/)
    if (u) url = decodeURIComponent(u[1])
    out.push({ title: decodeHtml(m[2]), url, snippet: decodeHtml(m[3]).slice(0, 500) })
  }
  return out
}

export async function webSearch(query, max = 5) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 250)
  if (!q) return []
  const hit = cache.get(q)
  if (hit && Date.now() - hit.at < TTL) return hit.results
  let results = []
  try {
    results = await groqSearch(q, max)
  } catch (e) {
    console.log('[web] groq search failed:', e.message)
    try { results = process.env.TAVILY_API_KEY ? await tavily(q, max) : await ddg(q, max) } catch (e2) { console.log('[web] fallback failed:', e2.message) }
  }
  if (cache.size > 200) cache.delete(cache.keys().next().value)
  cache.set(q, { at: Date.now(), results })
  return results
}

// Text block to append to a prompt ('' when no search is needed or nothing was found)
export async function webBlock(req, text) {
  if (!wantsWeb(req, text)) return ''
  const results = await webSearch(text)
  if (!results.length) return ''
  const body = results.slice(0, 5).map((r, i) => `[${i + 1}] ${r.title}${r.url ? '\n' + r.url : ''}\n${r.snippet}`).join('\n\n').slice(0, 3800)
  return `\n\n## LIVE WEB RESULTS (searched just now for: "${String(text).slice(0, 80)}")\nThese are newer than your training data. Prefer them for versions, APIs, docs and errors. Mention the source URL when you rely on one. If they are irrelevant, ignore them.\n${body}\n`
}
