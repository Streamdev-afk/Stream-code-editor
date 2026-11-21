// The agent crew: a Researcher and an Analyst work first, the user confirms the spec,
// then the normal Planner + Builder (+ the test loop as Reviewer) do the work with that spec in hand.
import { postStream, searchWeb, buildDigest } from './ai'

const ask = async (content, { model, behavior, onChunk }) => {
  const { full } = await postStream('/api/chat', { messages: [{ role: 'user', content }], model, thinking: 'low', behavior, noShell: true }, onChunk)
  return String(full || '').trim()
}

export async function crewResearch({ prompt, model, behavior, onStatus }) {
  let sources = []
  try {
    onStatus?.('Researcher: searching the web…')
    const r = await searchWeb(String(prompt).slice(0, 140))
    sources = (Array.isArray(r?.results) ? r.results : []).slice(0, 5)
  } catch { /* the notes can still be written without search results */ }
  const found = sources.map((s) => `- ${s.title || s.url}: ${String(s.snippet || s.content || '').slice(0, 220)} (${s.url})`).join('\n')
  onStatus?.('Researcher: writing notes…')
  const notes = await ask(
    `You are the RESEARCHER on a coding team. Do not write code. For this task, write short notes (max 180 words, bullets): the libraries/APIs/versions to use, how they work in one line each, common mistakes to avoid, and anything that may have changed recently. Use only what you know or the search results below; say "not sure" instead of guessing. Keep source links when you use a result.\n\nTASK: ${prompt}\n\nSEARCH RESULTS:\n${found || '(none found)'}`,
    { model, behavior },
  )
  return { notes, sources }
}

export async function crewAnalyze({ prompt, notes, files, activeFile, model, behavior, onStatus }) {
  onStatus?.('Analyst: matching the request with the research and your project…')
  let digest = ''
  try { digest = buildDigest(files, activeFile, 3500) } catch { /* optional */ }
  return ask(
    `You are the ANALYST on a coding team. Do not write code. Compare the user's request with the research notes and the existing project, then reply in exactly this format, short and plain:\n\nSPEC:\n- (3 to 7 bullets: what will be built, which files are touched or created, which tools are used)\n\nMATCH WITH RESEARCH:\n- (what in the notes the build depends on, and any conflict with the request)\n\nQUESTIONS:\n- (only things you truly cannot decide; write "none" if clear)\n\nREQUEST: ${prompt}\n\nRESEARCH NOTES:\n${notes}\n\nEXISTING PROJECT:\n${digest || '(empty project)'}`,
    { model, behavior },
  )
}

export const crewPrompt = (prompt, spec, notes) =>
  `${prompt}\n\nCONFIRMED SPEC (agreed with the user, follow it exactly):\n${spec}\n\nRESEARCH NOTES (use them, they were checked against web results):\n${notes}`
