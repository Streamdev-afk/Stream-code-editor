import { createPortal } from 'react-dom'
import Icon from './Icon'
import AiAnim from './AiAnim'
import RichText from './RichText'
import { getWeb, setWeb } from '../lib/web'
import { useState, useRef, useEffect } from 'react'
import { streamAgent, planTask, buildDigest, isOverviewQuestion, askQuestionsOn } from '../lib/ai'
import AskModal, { extractAsk, normalizeAsk } from './AskModal'
import ActivityLog from './ActivityLog'
import TeamPanel from './TeamPanel'
import { getTeamMembers, loadActivePersona } from '../lib/team'
import { loadSettings } from '../lib/settings'
import { API_BASE } from '../lib/api'
import { apiFetch } from '../lib/supabase'
import { fileToDataUrl } from '../lib/image'
import { createShell } from '../lib/shell'
import { usePlan, FEATURE_MIN, PLAN_NAME } from '../lib/plan'
import { crewResearch, crewAnalyze, crewPrompt } from '../lib/crew'
import { isCreationOnly, shouldExplore, buildIndex, runForAI, trimObservations, MAX_SHELL_ROUNDS } from '../lib/ai'
import ModelSwitcher from './ModelSwitcher'
import ThinkingSwitcher from './ThinkingSwitcher'
import BehaviorSwitcher from './BehaviorSwitcher'

// The chat AI asks to read code by replying with a <shell>...</shell> block
const looksLikeShell = (text) => {
  const t = text.trimStart().toLowerCase()
  return t.startsWith('<shell') || (t.length > 0 && '<shell>'.startsWith(t))
}

const parseShellRequest = (text) => {
  const m = text.trim().match(/^<shell>([\s\S]*?)(?:<\/shell>|$)/i)
  if (!m) return []
  return m[1].split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4)
}

// asking to run something, or to look at a terminal error: no plan, the agent answers directly and proposes the command
const RUN_ASK = /\b(run|execute|start|launch|install|build|test|serve|deploy|npm|npx|yarn|pnpm|node|python|pip|adb|terminal|command|dev server|compile)\b/i
// small talk or a plain question with no file work: the agent just answers like a person, no plan
const CASUAL = /^(?!.*\b(create|make|build|add|fix|change|edit|update|write|remove|delete|rename|implement|refactor|generate|design|style|convert|move|replace|install|run)\b)[\s\S]{0,160}$/i
const RUN_INTENT = /(\b(run|execute|start|launch|install)\b.*\b(npm|npx|yarn|pnpm|node|python|pip|git|adb|dev server|server|command|packages|dependencies)\b)|\bnpm (i|install|run|start|test|ci)\b|\b(look|check|see|read)\b.*\bterminal\b|\bterminal\b.*\b(error|output|failed|says|gave)\b|\b(gave|got|throws?|showing)\b.*\berror\b/i
const FIX_IT = /^\s*(yes|yeah|yep|ok(ay)?|sure|please|fix( it| them| that)?|try again|retry|continue|go ahead|do it|yes please)[\s.!]*$/i
const GO_AHEAD = /\b(start|begin|go ahead|get going|let'?s go|do it|build it|make it|continue|proceed|implement)\b/i

export default function AIChat({
  onFixFailed,
  pendingRequest,
  onRequestHandled,
  code,
  language,
  files,
  activeFile,
  messages: messagesProp,
  setMessages: setMessagesProp,
  sessionTitle,
  onFirstMessage,
  onApplyPlan,
  onAiActions,
  onPlanReady,
  fullAccess = false,
  onFullAccessToggle,
  model,
  thinking,
  behavior,
  onModelChange,
  onThinkingChange,
  onBehaviorChange,
  testAfterApply,
  onTestToggle,
  team,
  onTeamToggle,
  planningMode = true,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onDeleteSession,
}) {
  const [showSessions, setShowSessions] = useState(false)
  const [webOn, setWebOn] = useState(getWeb())
  const [showSearch, setShowSearch] = useState(false)
  const [sessionQuery, setSessionQuery] = useState('')
  const [mode, setMode] = useState('chat')
  const plan = usePlan()
  const lockedMsg = (name, f) => window.dispatchEvent(new CustomEvent('qoders-toast', { detail: `${name} needs the ${PLAN_NAME[FEATURE_MIN[f]]} plan. Buy it in the ION app (Plans page) with the same login.` }))
  const [crewOn, setCrewOn] = useState(() => { try { return localStorage.getItem('qoders-crew') === '1' } catch { return false } })
  const toggleCrew = (v) => { setCrewOn(v); try { localStorage.setItem('qoders-crew', v ? '1' : '0') } catch { /* ignore */ } }
  const [offer, setOffer] = useState(null) // { text } - "switch to agent mode?" pop-up
  const [ask, setAsk] = useState(null) // question the AI wants answered: { question, options, multi, mode, original }
  const [showTeam, setShowTeam] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [images, setImages] = useState([]) // data URLs waiting to be sent (max 2)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [imageError, setImageError] = useState('')
  const fileInputRef = useRef(null)

  // If parent supplies messages (session-backed), use those.
  // Otherwise fall back to internal state (backward compat).
  const [localMessages, setLocalMessages] = useState(() => [
    {
      role: 'assistant',
      text: "Hey! I'm Qoders. Ask me anything, or switch to Agent mode to make changes to your files.",
      time: Date.now(),
    },
  ])
  const messages = messagesProp ?? localMessages
  const setMessages = setMessagesProp ?? setLocalMessages
  const [input, setInput] = useState('')
  const [copiedIdx, setCopiedIdx] = useState(-1)
  const [listening, setListening] = useState(false)
  const recogRef = useRef(null)
  const [resendTick, setResendTick] = useState(0)
  const SpeechAPI = typeof window !== 'undefined' && !window.desktop?.isDesktop ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

  const copyMsg = async (text, i) => {
    try { await navigator.clipboard.writeText(text || '') } catch {
      const t = document.createElement('textarea'); t.value = text || ''; document.body.appendChild(t); t.select(); try { document.execCommand('copy') } catch {} t.remove()
    }
    setCopiedIdx(i); setTimeout(() => setCopiedIdx(-1), 1400)
  }
  const resend = (text) => { if (streaming) return; setInput(text); setResendTick((n) => n + 1) }
  // runs after the box has been filled by "resend"
  useEffect(() => { if (resendTick) send() }, [resendTick])

  // voice to text (browser speech recognition; not available in the desktop app)
  const toggleMic = () => {
    if (!SpeechAPI) return
    if (listening) { recogRef.current?.stop(); return }
    const r = new SpeechAPI()
    r.lang = navigator.language || 'en-US'
    r.interimResults = false
    r.continuous = true
    let base = input
    r.onresult = (e) => {
      let add = ''
      for (let k = e.resultIndex; k < e.results.length; k++) if (e.results[k].isFinal) add += e.results[k][0].transcript
      if (add) { base = (base ? base.replace(/\s*$/, ' ') : '') + add.trim(); setInput(base) }
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    recogRef.current = r
    setListening(true)
    try { r.start() } catch { setListening(false) }
  }
  const [streaming, setStreaming] = useState(false)
  const sendAgentRef = useRef(null)
  // the message box grows with what you type (up to about 8 lines), then scrolls inside itself
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 210) + 'px'
  }, [input])
  const [crewDone, setCrewDone] = useState([])
  const [cmdBusyUi, setCmdBusyUi] = useState(false)
  useEffect(() => {
    const h = (e) => setCmdBusyUi(!!e.detail?.busy)
    window.addEventListener('qoders-cmd-state', h)
    const st = () => { setStreaming(false) }
    window.addEventListener('qoders-stop', st)
    return () => { window.removeEventListener('qoders-cmd-state', h); window.removeEventListener('qoders-stop', st) }
  }, [])
  useEffect(() => { window.dispatchEvent(new CustomEvent('qoders-ai-state', { detail: { streaming } })) }, [streaming])
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addImageFiles = async (fileList) => {
    const picked = Array.from(fileList || []).filter((f) => f && f.type?.startsWith('image/'))
    if (!picked.length) return
    setImageError('')
    try {
      const room = Math.max(0, 2 - images.length)
      if (picked.length > room) setImageError('You can attach up to 2 images.')
      const urls = []
      for (const f of picked.slice(0, room)) urls.push(await fileToDataUrl(f))
      if (urls.length) setImages((prev) => [...prev, ...urls].slice(0, 2))
    } catch (e) {
      setImageError(e.message || 'Could not read that image.')
    }
  }

useEffect(() => {
  const handler = (e) => {
    const { status, summary, attempt } = e.detail
    const prefix = status === 'ok' ? '✅' : status === 'fix' ? '🔧' : '⚠️'
    setMessages((m) => [...m, {
      role: 'assistant',
      text: `${prefix} ${summary}`,
      time: Date.now(),
    }])
  }
  window.addEventListener('stream-test-result', handler)
  return () => window.removeEventListener('stream-test-result', handler)
}, [])

  const sendChat = async (text, imgs = []) => {
    const userMsg = { role: 'user', text, time: Date.now(), ...(imgs.length ? { imageCount: imgs.length } : {}) }

    // Build the full conversation including the new message
    const newMessages = [...messages, userMsg]

    // Update the session in ONE call so nothing gets overwritten
    setMessages([
      ...newMessages,
      { role: 'assistant', text: '', time: Date.now() },
    ])
    setStreaming(true)

    const setLast = (t) =>
      setMessages((m) => {
        const c = [...m]
        c[c.length - 1] = { role: 'assistant', text: t, time: Date.now() }
        return c
      })

    try {
      const persona = await loadActivePersona().catch(() => '')
      const apiMessages = newMessages
        .filter((m) => !(m.role === 'assistant' && /^Hey! I'm (Stream|Qoders)/.test(m.text)))
        .map((m) => ({ role: m.role, content: m.text }))

      // Bigger projects: the AI is not sent the files. It asks for terminal commands
      // (grep -rn, sed -n ...) and gets back only the lines it needs.
      // Creating new things never needs the terminal: skip reading entirely
      const creation = isCreationOnly(text, imgs.length > 0)
      // "how does it look?": read EVERY file through a cached digest, no terminal needed
      const overview = !creation && isOverviewQuestion(text) && Object.keys(files || {}).length > 0
      const digest = overview ? buildDigest(files, activeFile) : ''
      const explore = shouldExplore(files) && !overview
      const shell = explore ? createShell(files, '/') : null
      const index = explore ? buildIndex(files) : null
      const observations = []
      let turn = null

      for (let round = 0; round <= MAX_SHELL_ROUNDS; round++) {
        const lastRound = creation || round === MAX_SHELL_ROUNDS
        const body = explore
          ? {
              messages: apiMessages, language, activeFile, model, thinking, behavior, images: imgs, web: getWeb(), persona,
              explore: true, noShell: creation, fileIndex: index, observations, turn, lastRound,
            }
          : { messages: apiMessages, code, language, model, thinking, behavior, activeFile, images: imgs, web: getWeb(), persona, ...(digest ? { digest } : {}) }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 60000)
        let res
        try {
          res = await apiFetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timeoutId)
        }
        if (!res.ok) {
          let errorMsg = `HTTP ${res.status}`
          try {
            const errorData = await res.json()
            if (errorData.error) errorMsg = errorData.error
          } catch {}
          throw new Error(errorMsg)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let full = ''
        // typing pacer: reveals text at a readable speed instead of in big bursts
        let shown = 0, timer = null
        const tick = () => {
          const back = full.length - shown
          if (back <= 0) return
          shown += Math.max(1, Math.min(back, Math.ceil(back / SPEED.div)))
          setLast(full.slice(0, shown))
        }
        const SPEED = ({ slow: { div: 90, ms: 36 }, fast: { div: 25, ms: 22 } })[loadSettings().typingSpeed] || { div: 55, ms: 30 }
        const startPacer = () => { if (!timer) timer = setInterval(tick, SPEED.ms) }
        const finishPacer = async () => {
          while (shown < full.length) { tick(); await new Promise((r) => setTimeout(r, SPEED.ms)) }
          clearInterval(timer); timer = null
        }

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
              if (parsed.error) {
                setLast(`⚠️ ${parsed.error}`)
                continue
              }
              if (parsed.turn) turn = parsed.turn
              if (parsed.text) {
                full += parsed.text
                // a terminal request is not an answer: show a status instead of the raw command
                if (explore && !lastRound && looksLikeShell(full)) { shown = full.length; setLast('🔎 Reading your code…') }
                else startPacer()
              }
            } catch {}
          }
        }

        if (!(explore && !lastRound && looksLikeShell(full))) await finishPacer(); else { clearInterval(timer); timer = null }

        if (explore && !lastRound) {
          const cmds = parseShellRequest(full)
          if (cmds.length) {
            for (const c of cmds) {
              setLast(`🔎 Reading: ${c}`)
              observations.push({ cmd: c, output: runForAI(shell, c) })
            }
            trimObservations(observations)
            setLast('🔎 Thinking…')
            continue
          }
        }
        break
      }
    } catch (err) {
      const stopped = err.name === 'AbortError' && Date.now() - (window.__qodersStopped || 0) < 8000
      const msg = stopped ? 'Stopped.' : err.name === 'AbortError'
        ? 'Request timed out after 60s. Try a shorter question.'
        : err.message
      setLast(stopped ? msg : `⚠️ ${msg}`)
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }

  // Agent crew: Researcher -> Analyst -> you confirm -> Planner + Builder (+ test loop as Reviewer)
  const runCrew = async (text) => {
    const setLast = (t) => setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: 'assistant', text: t, time: Date.now(), _status: true }; return c })
    setMessages([...messages, { role: 'user', text, time: Date.now() }, { role: 'assistant', text: 'Researcher: starting…', time: Date.now(), _status: true }])
    setStreaming(true)
    try {
      const { notes, sources } = await crewResearch({ prompt: text, files, model, behavior, onStatus: setLast })
      const spec = await crewAnalyze({ prompt: text, notes, files, activeFile, model, behavior, onStatus: setLast })
      const links = sources.slice(0, 4).map((s) => `- [${s.title || s.url}](${s.url})`).join('\n')
      setMessages((m) => {
        const c = [...m]
        c[c.length - 1] = {
          role: 'assistant', time: Date.now(), _crew: { prompt: text, spec, notes, done: false },
          text: `**Researcher notes**\n${notes}${links ? `\n\n**Sources**\n${links}` : ''}\n\n**Analyst: what I will build (please confirm)**\n${spec}`,
        }
        return c
      })
    } catch (err) {
      const stopped = err.name === 'AbortError'
      setLast(stopped ? 'Stopped.' : `The crew could not finish: ${err.message}. You can turn Agent crew off in the ⋯ menu and ask again.`)
    } finally {
      setStreaming(false)
    }
  }
  const confirmCrew = (idx, msg) => {
    setCrewDone((d) => [...d, msg.time])
    sendAgentRef.current?.(crewPrompt(msg._crew.prompt, msg._crew.spec, msg._crew.notes), [], null, true)
  }

  const sendAgent = async (text, imgs = [], shown, noCrew) => {
    // commands only run (or pop up) when the user asked for it; an automatic fix round or the crew spec counts as asked
    window.__qodersRunOk = shown === null || RUN_ASK.test(text.split('\n\nCONFIRMED SPEC')[0])
    const cmds = [] // terminal commands the AI ran to read your code this turn
    const acts = (extra = []) => [...cmds.map((c) => ({ kind: 'terminal', title: 'Read your code in the terminal', detail: c })), ...extra]
    // shows which terminal command the AI is running to read your code
    const showReading = (cmd) => {
      cmds.push(cmd)
      setMessages((m) => {
        const c = [...m]
        c[c.length - 1] = { role: 'assistant', text: `🔎 Reading: ${cmd}`, time: Date.now(), _status: true }
        return c
      })
    }
    setMessages([
      ...messages,
      ...(shown === null ? [] : [{ role: 'user', text: shown ?? text, time: Date.now(), ...(imgs.length ? { imageCount: imgs.length } : {}) }]),
      { role: 'assistant', text: 'Analyzing project…', time: Date.now(), _status: true },
    ])
    setStreaming(true)

    try {
      // If planning mode is on, plan first
      if (planningMode && onPlanReady && !RUN_INTENT.test(text) && !CASUAL.test(text)) {
        let planResult = null
        try { planResult = await planTask(
  { prompt: text, files, activeFile, history: messages, model, thinking, behavior, images: imgs, team: !!team, teamSize: getTeamMembers().length, onStatus: showReading },
          (_chunk, full) => {
            let hint = 'Analyzing project…'
            if (full.length > 200) hint = 'Drafting plan…'
            if (full.length > 600) hint = 'Almost ready…'
            setMessages((m) => {
              const c = [...m]
              c[c.length - 1] = { role: 'assistant', text: hint, time: Date.now(), _status: true }
              return c
            })
          }
        ) } catch (pe) { if (!pe.planFailed && !/formatting the plan|validate JSON|empty plan|Planning failed/i.test(pe.message || '')) throw pe }

        if (!planResult) {
          // the planner gave nothing usable: say so and work on it directly instead of opening an empty plan
          setMessages((m) => {
            const c = [...m]
            c[c.length - 1] = { role: 'assistant', text: 'The planner could not make a plan for this, so I am working on it directly instead.', time: Date.now(), _status: true }
            return c
          })
        } else {
        const stepCount = Array.isArray(planResult.steps) ? planResult.steps.length : 0
        const planAsk = askQuestionsOn() ? normalizeAsk(planResult.ask) : null
        if (planAsk && !stepCount) {
          setMessages((m) => {
            const c = [...m]
            c[c.length - 1] = { role: 'assistant', text: planAsk.question, time: Date.now(), ...(cmds.length ? { activity: acts() } : {}) }
            return c
          })
          setAsk({ ...planAsk, mode: 'agent', original: text })
          setStreaming(false)
          return
        }
        setMessages((m) => {
          const c = [...m]
          c[c.length - 1] = {
            role: 'assistant',
            text: `Here is my plan${planResult.title ? ` for "${planResult.title}"` : ''}. Nothing has been changed yet.\n\n${(planResult.steps || []).map((st, i) => `${i + 1}. ${st.title}${st.description ? ': ' + st.description : ''}`).join('\n')}\n\nCheck the steps in the window and press Execute when you are happy, or edit them first.`,
            time: Date.now(),
            activity: acts([{ kind: 'plan', title: `Planned ${stepCount} step${stepCount === 1 ? '' : 's'}`, detail: (planResult.steps || []).map((st, i) => `${i + 1}. ${st.title}`).join('\n') }]),
          }
          return c
        })

        onPlanReady(planResult, text)
        setStreaming(false)
        return
        }
      }

      // Fallback: direct agent (no planning)
      const plan = await streamAgent(
  { prompt: text, files, activeFile, history: messages, model, thinking, behavior, images: imgs, onStatus: showReading },
  (_chunk, full) => {
          let hint = 'Analyzing project…'
          if (full.length > 200) hint = 'Planning changes…'
          if (full.length > 600) hint = 'Writing code…'
          setMessages((m) => {
            const c = [...m]
            c[c.length - 1] = { role: 'assistant', text: hint, time: Date.now(), _status: true }
            return c
          })
        }
      )

      const agentAsk = askQuestionsOn() ? normalizeAsk(plan.ask) : null
      if ((!plan.operations || plan.operations.length === 0) && agentAsk) {
        setMessages((m) => {
          const c = [...m]
          c[c.length - 1] = { role: 'assistant', text: plan.explanation || agentAsk.question, time: Date.now(), ...(cmds.length ? { activity: acts() } : {}) }
          return c
        })
        setAsk({ ...agentAsk, mode: 'agent', original: text })
        return
      }
      if (!plan.operations || plan.operations.length === 0) {
        const hasActions = Array.isArray(plan.actions) && plan.actions.length > 0
        setMessages((m) => {
          const c = [...m]
          c[c.length - 1] = {
            role: 'assistant',
            text: (plan.explanation || 'No changes needed.') + (hasActions ? '\n\nWaiting for your approval below.' : ''),
            time: Date.now(),
            ...(cmds.length ? { activity: acts() } : {}),
          }
          return c
        })
        if (hasActions) onAiActions?.(plan.actions)
        return
      }
      if (Array.isArray(plan.actions) && plan.actions.length > 0) onAiActions?.(plan.actions)

      const planLines = Array.isArray(plan.plan) && plan.plan.length > 0
  ? '\n\n' + plan.plan.map((s, i) => `${i + 1}. ${s}`).join('\n')
  : ''
const opsLine = `\n\nI have not applied anything yet. Review ${plan.operations.length} proposed change(s) in the window and accept the ones you want.`

setMessages((m) => {
  const c = [...m]
  c[c.length - 1] = {
    role: 'assistant',
    text: `${plan.explanation}${planLines}${opsLine}`,
    time: Date.now(),
    activity: acts([{ kind: 'plan', title: `Proposed ${plan.operations.length} file change${plan.operations.length === 1 ? '' : 's'}`, detail: plan.operations.map((o) => `${o.type === 'delete_file' ? 'delete' : o.type === 'edit_file' ? 'edit  ' : 'write '} ${o.path}`).join('\n') }]),
  }
  return c
})
      onApplyPlan?.(plan, text)
    } catch (err) {
      setMessages((m) => {
        const c = [...m]
        c[c.length - 1] = { role: 'assistant', text: `⚠️ ${err.message}`, time: Date.now() }
        return c
      })
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }

  // The AI asked something in a chat reply: lift the [[ASK]] block out and open the pop-up
  useEffect(() => {
    if (streaming) return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || last._askDone || !/\[\[ASK\]\]/.test(last.text || '')) return
    const { text, ask: q } = extractAsk(last.text)
    setMessages((m) => { const c = [...m]; c[c.length - 1] = { ...last, text, _askDone: true }; return c })
    // chat mode is just chatting: no question pop-up (the question stays in the text)
    if (q) setMessages((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], text: (text + '\n\n' + q.question + (q.options && q.options.length ? '\n' + q.options.map((o) => '- ' + o).join('\n') : '')).trim(), _askDone: true }; return c })
  }, [streaming, messages])

  // "Select" in the preview: run the described change as an agent request
  useEffect(() => {
    if (!pendingRequest || streaming) return
    onRequestHandled?.()
    setMode('agent')
    sendAgent(pendingRequest.prompt, [], pendingRequest.shown)
  }, [pendingRequest])

  const answerAsk = (answer) => {
    const a = ask
    setAsk(null)
    if (!a || !answer) return
    if (a.mode === 'agent') sendAgent(`${a.original}\n\n(My answer to your question "${a.question}": ${answer})`, [], answer)
    else sendChat(answer, [])
  }

  sendAgentRef.current = sendAgent
  const send = () => {
    if ((!input.trim() && images.length === 0) || streaming) return
    const imgs = images
    const text = input.trim() || 'Look at the attached image.'
    setInput('')
    setImages([])
    setImageError('')

    // Auto-title on first user message
    const userMsgCount = messages.filter((m) => m.role === 'user').length
    if (userMsgCount === 0 && onFirstMessage) {
      onFirstMessage(text)
    }

    // after a failed step: a short yes / "fix it" re-runs only the failed steps
    if (onFixFailed && FIX_IT.test(text) && onFixFailed()) {
      setMessages([...messages, { role: 'user', text, time: Date.now() }, { role: 'assistant', text: 'On it. I will redo only the part that failed.', time: Date.now() }])
      return
    }
    // "start working" while chatting: offer to switch to agent mode instead of just replying
    if (mode === 'chat' && messages.length >= 2 && !imgs.length && GO_AHEAD.test(text) && text.length < 120) {
      setMessages([...messages, { role: 'user', text, time: Date.now() }])
      setOffer({ text })
      return
    }
    if (mode === 'agent' && crewOn && plan.can('crew') && !imgs.length && text.length > 25 && !RUN_INTENT.test(text)) runCrew(text)
    else if (mode === 'agent') sendAgent(text, imgs)
    else sendChat(text, imgs)
  }

  const fmtTime = (t) =>
    new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div
      className={`aichat ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        addImageFiles(e.dataTransfer?.files)
      }}
    >
            <div className="panel-header aichat-header">
        <div className="aichat-header-row">
          <div className="mode-switch">
            <button
              className={`mode-btn ${mode === 'chat' ? 'active' : ''}`}
              onClick={() => setMode('chat')}
            >
              <span className="mode-dot" /> Chat
            </button>
            <button
              className={`mode-btn ${mode === 'agent' ? 'active' : ''}`}
              onClick={() => setMode('agent')}
            >
              <span className="mode-dot agent" /> Agent
            </button>
          </div>
          <div className="aichat-header-actions">
            <div className="aichat-more-wrap">
              <button className={`aichat-icon-btn ${showMore ? 'active' : ''}`} onClick={() => setShowMore((v) => !v)} title="More options">
                <Icon name="dots" size={16} />
              </button>
              {showMore && createPortal(
                <div className="modal-backdrop" onClick={() => setShowMore(false)}>
                  <div className="modal more-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <div className="modal-title-group"><h3>AI options</h3></div>
                      <button className="modal-close" onClick={() => setShowMore(false)} aria-label="Close"><Icon name="close" size={16} /></button>
                    </div>
                    <div className="more-list">
                      {mode === 'agent' && (
                        <label className="more-row">
                          <span>Test after applying</span>
                          <input type="checkbox" checked={!!testAfterApply} onChange={(e) => onTestToggle?.(e.target.checked)} />
                        </label>
                      )}
                      {mode === 'agent' && (
                        <label className="more-row">
                          <span>{plan.can('team') ? '' : '👑 '}Team ({getTeamMembers().length} AIs)</span>
                          <input type="checkbox" checked={!!team && plan.can('team')} onChange={(e) => { if (!plan.can('team')) return lockedMsg('Team mode', 'team'); onTeamToggle?.(e.target.checked) }} />
                        </label>
                      )}
                      {mode === 'agent' && (
                        <label className="more-row">
                          <span>{plan.can('crew') ? '' : '👑 '}Agent crew (research, confirm, build)</span>
                          <input type="checkbox" checked={crewOn && plan.can('crew')} onChange={(e) => { if (!plan.can('crew')) return lockedMsg('Agent crew', 'crew'); toggleCrew(e.target.checked) }} />
                        </label>
                      )}
                      <label className="more-row full-access-row">
                        <span>{plan.can('fullAccess') ? '' : '👑 '}Full access mode</span>
                        <input type="checkbox" checked={!!fullAccess && plan.can('fullAccess')} onChange={(e) => { if (!plan.can('fullAccess')) return lockedMsg('Full access mode', 'fullAccess'); onFullAccessToggle?.(e.target.checked) }} />
                        <span className="full-access-tip" role="tooltip">
                          Warning: this gives the AI full access to your files and terminal. It edits files and runs commands by itself, with no confirmation, and keeps fixing errors until it works. Uses more tokens.
                        </span>
                      </label>
                      <label className="more-row">
                        <span>Web search</span>
                        <input type="checkbox" checked={webOn} onChange={() => { setWeb(!webOn); setWebOn(!webOn) }} />
                      </label>
                      <button className="more-row more-link" type="button" onClick={() => { setShowMore(false); setShowTeam(true) }}>
                        <span>Team &amp; characters…</span>
                        <Icon name="chevronRight" size={13} />
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}
            </div>
            <BehaviorSwitcher value={behavior} onChange={onBehaviorChange} disabled={streaming} compact />
            <button
              className={`aichat-icon-btn ${showSearch ? 'active' : ''}`}
              onClick={() => {
                setShowSearch((s) => !s)
                setShowSessions(true)
              }}
              title="Search sessions"
            >
              <Icon name="search" size={16} />
            </button>
            <button
              className={`aichat-icon-btn ${showSessions ? 'active' : ''}`}
              onClick={() => {
                setShowSessions((s) => !s)
                if (showSessions) setShowSearch(false)
              }}
              title={showSessions ? 'Close sessions' : 'Show sessions'}
            >
              <Icon name="expand" size={15} />
            </button>
          </div>
        </div>
      </div>

      {showTeam && <TeamPanel onClose={() => setShowTeam(false)} />}
            {showSessions && (
        <div className="aichat-sessions-overlay">
          <div className="aichat-sessions-header">
            <div className="aichat-sessions-title">Sessions</div>
            <button
              className="aichat-sessions-new"
              onClick={() => {
                onNewSession?.()
                setShowSessions(false)
              }}
              title="New session"
            >
              <Icon name="plus" size={17} />
            </button>
          </div>

          {showSearch && (
            <div className="aichat-sessions-search">
              <input
                className="aichat-sessions-search-input"
                placeholder="Search sessions…"
                value={sessionQuery}
                onChange={(e) => setSessionQuery(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="aichat-sessions-list">
            {(() => {
              const list = Array.isArray(sessions) ? sessions : []
              const q = sessionQuery.trim().toLowerCase()
              const filtered = q
                ? list.filter((s) => (s.title || '').toLowerCase().includes(q))
                : list

              if (filtered.length === 0) {
                return (
                  <div className="aichat-sessions-empty">
                    {q ? 'No matches' : 'No sessions yet — tap + to create one'}
                  </div>
                )
              }

              return filtered.map((s) => {
                const msgCount = Array.isArray(s.messages)
                  ? s.messages.filter((m) => m.role === 'user').length
                  : 0
                const fileCount = s.files ? Object.keys(s.files).length : 0
                const isActive = s.id === activeSessionId

                return (
                  <div
                    key={s.id}
                    className={`aichat-session-item ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      onSelectSession?.(s.id)
                      setShowSessions(false)
                      setShowSearch(false)
                      setSessionQuery('')
                    }}
                  >
                    <div className="aichat-session-icon"><Icon name="chat" size={16} /></div>
                    <div className="aichat-session-body">
                      <div className="aichat-session-name">{s.title || 'Untitled'}</div>
                      <div className="aichat-session-meta">
                        {msgCount} msg · {fileCount} files
                      </div>
                    </div>
                    {confirmDelete === s.id ? (
                      <div className="aichat-session-confirm" onClick={(e) => e.stopPropagation()}>
                        <span>Delete?</span>
                        <button
                          className="aichat-session-yes"
                          onClick={() => {
                            setConfirmDelete(null)
                            onDeleteSession?.(s.id)
                          }}
                        >
                          Yes
                        </button>
                        <button className="aichat-session-no" onClick={() => setConfirmDelete(null)}>
                          No
                        </button>
                      </div>
                    ) : (
                      <>
                        {isActive && <div className="aichat-session-active-dot" />}
                        {onDeleteSession && (
                          <button
                            className="aichat-session-del"
                            title="Delete this session"
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmDelete(s.id)
                            }}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}

      <div className="chat-messages">
        {messages.map((msg, i) => {
          const isUser = msg.role === 'user'
          const isLast = i === messages.length - 1
          const showTyping = streaming && isLast && !msg._status && !msg.text

          return (
            <div key={i} className={`chat-msg ${isUser ? 'user' : 'assistant'}`}>
              <div className="chat-avatar">
                {isUser ? <Icon name="user" size={14} /> : <Icon name="diamond" size={12} />}
              </div>
              <div className="chat-body">
                <div className="chat-meta">
                  <span className="chat-author">{isUser ? 'You' : 'Qoders'}</span>
                  <span className="chat-time">{fmtTime(msg.time || Date.now())}</span>
                </div>
                {(msg.text || showTyping || isUser || msg._status || !msg.activity) && (
                <div className={`chat-text ${msg._status ? 'chat-status' : ''}`}>
                  {showTyping ? (
                    <span className="typing-dots" aria-label="thinking"><i /><i /><i /></span>
                  ) : (
                    isUser || msg._status
                      ? <>{msg._status && streaming && isLast && <AiAnim name={/run|command|test|install|terminal/i.test(msg.text || '') ? 'running' : 'writing'} size={26} />}{msg.text || (streaming && isLast ? '▍' : '')}</>
                      : <>
                          <RichText text={extractAsk(msg.text).text} />
                          {streaming && isLast && <span className="rt-caret">▍</span>}
                        </>
                  )}
                </div>
                )}
                {msg.text && !msg._status && !(streaming && isLast) && (
                  <div className="msg-actions">
                    <button className="msg-act" onClick={() => copyMsg(extractAsk(msg.text).text, i)} title="Copy">
                      <Icon name="copy" size={12} /> {copiedIdx === i ? 'Copied' : 'Copy'}
                    </button>
                    {isUser && !streaming && (
                      <button className="msg-act" onClick={() => resend(msg.text)} title="Send this message again">
                        <Icon name="refresh" size={12} /> Resend
                      </button>
                    )}
                  </div>
                )}
                {!isUser && msg.activity && <ActivityLog items={msg.activity} />}
                {!isUser && msg._crew && !crewDone.includes(msg.time) && !streaming && i === messages.length - 1 && (
                  <div className="crew-actions">
                    <button className="action-btn" onClick={() => confirmCrew(i, msg)}>Looks right, build it</button>
                    <button className="topbar-btn small" onClick={() => { setInput(`Change the spec: `); inputRef.current?.focus() }}>Change something</button>
                  </div>
                )}
                {msg.imageCount > 0 && (
                  <div className="chat-image-chip">🖼 {msg.imageCount} image{msg.imageCount > 1 ? 's' : ''} attached</div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {offer && createPortal(
        <div className="modal-backdrop" onClick={() => setOffer(null)}>
          <div className="modal offer-modal" role="dialog" aria-label="Switch to agent mode" onClick={(e) => e.stopPropagation()}>
            <div className="offer-body">
              <span className="offer-icon"><Icon name="bot" size={20} /></span>
              <h3>Ready to start?</h3>
              <p>Switch to Agent mode so I can write the files and start working on what we planned.</p>
            </div>
            <div className="offer-btns">
              <button className="agent-offer-no" onClick={() => setOffer(null)}>Cancel</button>
              <button className="agent-offer-yes" autoFocus onClick={() => {
                const t = offer.text
                setOffer(null)
                setMode('agent')
                sendAgent(`${t}\n\nStart working now on what we agreed in our conversation above.`, [], t)
              }}>Allow</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {ask && <AskModal ask={ask} onAnswer={answerAsk} onSkip={() => setAsk(null)} />}

      <div className="chat-input-wrap">
        {images.length > 0 && (
          <div className="chat-attachments">
            {images.map((src, i) => (
              <div className="chat-attach" key={i}>
                <img src={src} alt="attachment" />
                <button
                  className="chat-attach-x"
                  title="Remove"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Icon name="close" size={12} strokeWidth={2.4} />
                </button>
              </div>
            ))}
          </div>
        )}
        {imageError && <div className="chat-image-error">{imageError}</div>}
        <div className={`chat-composer mode-${mode}`}>
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={
              streaming ? 'ION Qoders is working...'
                : mode === 'agent' ? 'Tell Qoders what to build or change...'
                : 'Ask Qoders anything... (paste or drop a screenshot)'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'))
              if (files.length) {
                e.preventDefault()
                addImageFiles(files)
              }
            }}
            disabled={streaming}
            rows={1}
            style={{ display: 'block', minHeight: 88, maxHeight: 210, overflowY: 'auto', boxSizing: 'border-box' }}
          />
          <div className="composer-bar">
            <div className="composer-tools">
              <button
                className="composer-icon"
                title="Attach an image (or paste / drop one)"
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming || images.length >= 2}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="4" />
                  <circle cx="9" cy="9.5" r="1.6" />
                  <path d="M21 16l-5-5-8 8" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  addImageFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                className={`composer-icon ${webOn ? 'web-on' : ''}`}
                title={webOn ? 'Web search on: Qoders looks things up when needed (click to turn off)' : 'Web search off (click to turn on)'}
                onClick={() => { setWeb(!webOn); setWebOn(!webOn) }}
                disabled={streaming}
              ><Icon name="globe" size={15} /></button>
              {SpeechAPI && (
                <button
                  className={`composer-icon ${listening ? 'mic-on' : ''}`}
                  title={listening ? 'Listening… click to stop' : 'Talk instead of typing'}
                  onClick={toggleMic}
                  disabled={streaming}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                </button>
              )}
              <ModelSwitcher value={model} onChange={onModelChange} disabled={streaming} compact up />
              <ThinkingSwitcher value={thinking} onChange={onThinkingChange} disabled={streaming} compact up />
            </div>
            {(streaming || cmdBusyUi) && (
              <button className="chat-send chat-stop" onClick={() => window.dispatchEvent(new CustomEvent('qoders-stop-all'))} title="Stop the AI and everything it is running">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>
              </button>
            )}
            <button
              className="chat-send"
              style={streaming || cmdBusyUi ? { display: 'none' } : undefined}
              onClick={send}
              disabled={streaming || (!input.trim() && images.length === 0)}
              title={mode === 'agent' ? 'Plan changes' : 'Send'}
            >
              {streaming ? <Icon name="dots" size={18} /> : mode === 'agent' ? <Icon name="bolt" size={17} /> : <Icon name="arrowUp" size={18} strokeWidth={2.4} />}
            </button>
          </div>
        </div>
        <div className="chat-hint">
          {mode === 'agent'
            ? 'Agent mode — Qoders reads only the lines it needs, then proposes changes you can review'
            : 'Chat mode — ask questions. Switch to Agent to edit files.'}
        </div>
      </div>
    </div>
  )
}