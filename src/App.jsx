import Icon from './components/Icon'
import ActionCard from './components/ActionCard'
import { useState, useRef, useEffect, useMemo } from 'react'
import Editor from './components/Editor'
import FileTree from './components/FileTree'
import Tabs from './components/Tabs'
import AIChat from './components/AIChat'
import BottomPanel from './components/BottomPanel'
import DiffModal from './components/DiffModal'
import AgentModal from './components/AgentModal'
import Preview from './components/Preview'
import LanguageSelect from './components/LanguageSelect'
import { streamEdit, streamAgent } from './lib/ai'
import { resolveOp } from './lib/ops'
import ProjectMenu from './components/ProjectMenu'
import './App.css'
import './modern.css'
import './mobile.css'
import MobileLayout from './components/MobileLayout'
import InputModal from './components/InputModal'
import {
  loadFiles, saveFiles, resetFiles, getLanguageFromPath, DEFAULT_FILES,
  createFile, createFolder, renamePath, deletePath,
} from './lib/fs'
import AIDropdown from './components/AIDropdown'
import CommandPalette from './components/CommandPalette'
import SearchPanel from './components/SearchPanel'
import SettingsModal from './components/SettingsModal'
import { loadSettings, saveSettings } from './lib/settings'
import { applyTheme } from './lib/theme'
import HistoryPanel from './components/HistoryPanel'
import ImportModal from './components/ImportModal'
import { exportProjectToZip, downloadBlob, importZipToFiles } from './lib/zip'
import { syncPreview, getPreviewUrl, getSessionId } from './lib/previewSession'
import { loadTeam } from './lib/team'
import LinkPanel from './components/LinkPanel'
import { pendingActions, markAction, countLinks } from './lib/links'
import { setCtx, saveCheckpoint, loadCheckpoint, clearCheckpoint } from './lib/appContext'
import { getGitHubStatus } from './lib/github'
import { updatePreviewSession, fetchPreviewErrors, clearPreviewErrors, diagnose, executeStep, summarizeChanges, setAskQuestions, setProjectRules } from './lib/ai'
import PlanningModal from './components/PlanningModal'
import { useMobile } from './lib/useMobile'
import { AuthProvider, useAuth } from './lib/auth'
import {
  loadSessions,
  saveSessions,
  addSession,
  deleteSession,
  renameSession,
  updateSession,
  setActiveSession,
  getActiveSession,
  generateTitle,
  hasMergedGuestSessions,
  markGuestSessionsMerged,
} from './lib/sessions'
import {
  isSyncAvailable,
  loadRemoteSessions,
  saveRemoteSession,
  deleteRemoteSession,
  uploadSessionBatch,
} from './lib/syncSessions'
import LoginModal from './components/LoginModal'
import UserMenu from './components/UserMenu'
import UsageDropdown from './components/UsageDropdown'
import { startCheckout, redirectToCheckout } from './lib/paystack'
import GitHubModal from './components/GitHubModal'
import ActionsModal from './components/ActionsModal'
import DesktopUpdater from './components/DesktopUpdater'
import { saveToDisk, saveAllToDisk, chooseFolder, linkedFolder, canPickFolder } from './lib/diskSave'

function AppInner() {
  const { user, loading: authLoading } = useAuth()

  // ---- Sessions store (the source of truth) ----
  const [sessionStore, setSessionStore] = useState(() => loadSessions())

    // ---- Payment success detection ----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'success') {
      // Clean the URL
      window.history.replaceState({}, '', window.location.pathname)

      // Wait for auth to be ready, then refresh tier
      setTimeout(() => {
        // Trigger a usage refetch by adding a cache buster
        window.dispatchEvent(new CustomEvent('stream-refresh-usage'))
      }, 2500)

      // Show a nice toast
      setTimeout(() => {
        setToast({
          msg: '💎 Payment received — your Pro tier will activate shortly.',
          kind: 'ok',
        })
        setTimeout(() => setToast(null), 5000)
      }, 1000)
    }
  }, [])

  // Cloud sync state
  const [syncing, setSyncing] = useState(false)
  const [syncReady, setSyncReady] = useState(false)

  // Persist to localStorage on every change (always — local is the cache)
  useEffect(() => {
    saveSessions(sessionStore)
  }, [sessionStore])

  // ---- Debounced cloud save: whenever the active session changes, push it ----
  useEffect(() => {
    if (!user) return
    if (!syncReady) return
    if (!isSyncAvailable()) return

    const session = sessionStore.sessions.find((s) => s.id === sessionStore.activeSessionId)
    if (!session) return

    const t = setTimeout(async () => {
      try {
        await saveRemoteSession(session, user.id)
      } catch (err) {
        console.warn('Cloud save failed for session', session.id, err.message)
      }
    }, 1500)

    return () => clearTimeout(t)
  }, [sessionStore, user, syncReady])
  // Active session (always exists — loadSessions guarantees at least one)
  const activeSession = getActiveSession(sessionStore)

  // Convenience accessors from active session
  const files = activeSession.files
  const openTabs = activeSession.openTabs
  const activeFile = activeSession.activeFile
  const history = activeSession.history || []
  const messages = activeSession.messages || []

  // Setters that patch the active session
   const setFiles = (updater) => {
    setSessionStore((s) => {
      const active = s.sessions.find((x) => x.id === s.activeSessionId)
      if (!active) return s
      const current = active.files || {}
      const next = typeof updater === 'function' ? updater(current) : updater
      return updateSession(s, s.activeSessionId, { files: next })
    })
  }

  const setOpenTabs = (updater) => {
    setSessionStore((s) => {
      const active = s.sessions.find((x) => x.id === s.activeSessionId)
      if (!active) return s
      const current = active.openTabs || []
      const next = typeof updater === 'function' ? updater(current) : updater
      return updateSession(s, s.activeSessionId, { openTabs: next })
    })
  }

  const setActiveFile = (next) => {
    setSessionStore((s) => updateSession(s, s.activeSessionId, { activeFile: next }))
  }

  const setHistory = (updater) => {
    setSessionStore((s) => {
      const active = s.sessions.find((x) => x.id === s.activeSessionId)
      if (!active) return s
      const current = active.history || []
      const next = typeof updater === 'function' ? updater(current) : updater
      return updateSession(s, s.activeSessionId, { history: next })
    })
  }

  const setMessages = (updater) => {
    setSessionStore((s) => {
      const active = s.sessions.find((x) => x.id === s.activeSessionId)
      if (!active) return s
      const current = active.messages || []
      const next = typeof updater === 'function' ? updater(current) : updater
      return updateSession(s, s.activeSessionId, { messages: next })
    })
  }

    // ---- Checkout ----
  const handleUpgrade = async (tier) => {
    if (!user) {
      setShowLogin(true)
      return
    }
    try {
      showToast(`Starting ${tier.toUpperCase()} checkout…`, 'info')
      const { authorizationUrl } = await startCheckout(tier)
      redirectToCheckout(authorizationUrl)
    } catch (err) {
      showToast(`Checkout failed: ${err.message}`, 'error')
    }
  }

  const handleManageBilling = () => {
    setShowSettings(true)
  }

  const handleGitHubPush = () => {
    if (!user) {
      setShowLogin(true)
      return
    }
    setGithubModal('push')
  }

  const handleGitHubPull = () => {
    if (!user) {
      setShowLogin(true)
      return
    }
    setGithubModal('pull')
  }

  const handlePulledRepo = (result) => {
    // Create a new session with the pulled files
    const newSession = {
      id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
      title: result.repo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [
        {
          role: 'assistant',
          text: `Imported ${result.fileCount} file${result.fileCount === 1 ? '' : 's'} from ${result.owner}/${result.repo} (${result.branch}).`,
          time: Date.now(),
        },
      ],
      files: result.files,
      openTabs: Object.keys(result.files).slice(0, 3),
      activeFile: Object.keys(result.files)[0] || '',
      history: [],
    }
    setSessionStore((s) => ({
      sessions: [...s.sessions, newSession],
      activeSessionId: newSession.id,
    }))
    showToast(`Imported ${result.fileCount} file(s) from GitHub`, 'ok')
  }

  // ---- Session CRUD ----
  const handleNewSession = () => {
    setSessionStore((s) => addSession(s, 'New session'))
    showToast('New chat created', 'ok')
  }
  const handleSelectSession = (id) => {
    setSessionStore((s) => setActiveSession(s, id))
  }
  const handleRenameSession = (id, title) => {
    setSessionStore((s) => renameSession(s, id, title))
  }
  const handleDeleteSession = (id) => {
    setSessionStore((s) => deleteSession(s, id))
    showToast('Chat deleted', 'info')

    // Also remove from cloud if signed in
    if (user && syncReady && isSyncAvailable()) {
      deleteRemoteSession(id).catch((err) => {
        console.warn('Cloud delete failed:', err.message)
      })
    }
  }

  const [dirty, setDirty] = useState(new Set())
  const [bottomOpen, setBottomOpen] = useState(true)
const [showSidebar, setShowSidebar] = useState(() => localStorage.getItem('stream-sidebar') !== 'false')
const [showAI, setShowAI] = useState(() => localStorage.getItem('stream-ai') !== 'false')
const [sidebarTab, setSidebarTab] = useState('explorer') // 'explorer' | 'search' | 'history'
const [paletteMode, setPaletteMode] = useState(null) // null | 'files' | 'commands'
const [pendingGotoLine, setPendingGotoLine] = useState(null) // { path, line }
const [settings, setSettings] = useState(() => loadSettings())
const [showSettings, setShowSettings] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const [linkActions, setLinkActions] = useState([]) // proposals from a connected ION character
  const [hasLinks, setHasLinks] = useState(false)
const [showImport, setShowImport] = useState(false)
const [previewSession, setPreviewSession] = useState(null)
const [testAfterApply, setTestAfterApply] = useState(false)
const [testProgress, setTestProgress] = useState(null) // null | { step, message } | { done: true }
const isMobile = useMobile(768)
const [showLogin, setShowLogin] = useState(false)
    const [showActions, setShowActions] = useState(false)
  const [githubModal, setGithubModal] = useState(null) // null | 'push' | 'pull'
  // ---- Cloud sync: on sign-in, load remote sessions (merge guest once) ----
  // ---- Cloud sync: on sign-in, load remote sessions ----
  // IMPORTANT: keyed on user.id so it ONLY runs when the user changes,
  // not on every token refresh or object identity change.
  const lastSyncUserIdRef = useRef(null)

  useEffect(() => {
    if (!user) {
      setSyncReady(false)
      lastSyncUserIdRef.current = null
      return
    }
    if (!isSyncAvailable()) {
      setSyncReady(true)
      return
    }

    // Already synced for this user — skip
    if (lastSyncUserIdRef.current === user.id) return
    lastSyncUserIdRef.current = user.id

    let cancelled = false

    ;(async () => {
      setSyncing(true)
      try {
        console.log('[sync] loading for user', user.id)
        const remote = await loadRemoteSessions()
        console.log('[sync] remote sessions:', remote.length)

        if (cancelled) return

        // Get current sessions from the store
        let localSessions = []
        setSessionStore((s) => {
          localSessions = s.sessions
          return s
        })

        const shouldMerge = !hasMergedGuestSessions()
        const remoteIds = new Set(remote.map((s) => s.id))
        const localOnly = localSessions.filter((s) => !remoteIds.has(s.id))

        console.log('[sync] shouldMerge:', shouldMerge, 'localOnly:', localOnly.length)

        // Upload local-only sessions if this is the first merge
        if (shouldMerge && localOnly.length > 0) {
          console.log('[sync] uploading', localOnly.length, 'local sessions')
          await uploadSessionBatch(localOnly, user.id)
          markGuestSessionsMerged()

          const merged = await loadRemoteSessions()
          console.log('[sync] after merge, remote has', merged.length)
          if (!cancelled && merged.length > 0) {
            setSessionStore((prev) => ({
              sessions: merged,
              activeSessionId: merged.find((r) => r.id === prev.activeSessionId)?.id || merged[0].id,
            }))
          }
        } else if (remote.length > 0) {
          // Pure load: use remote set, BUT merge with local if local has more messages
          setSessionStore((prev) => {
            const merged = remote.map((r) => {
              const local = prev.sessions.find((s) => s.id === r.id)
              if (local && Array.isArray(local.messages) && Array.isArray(r.messages)) {
                // Keep whichever has more messages
                if (local.messages.length > r.messages.length) {
                  return { ...r, messages: local.messages }
                }
              }
              return r
            })
            return {
              sessions: merged,
              activeSessionId: merged.find((x) => x.id === prev.activeSessionId)?.id || merged[0].id,
            }
          })
        }
        // If both are empty — do nothing (keep local)

        setSyncReady(true)
      } catch (err) {
        console.warn('[sync] failed:', err)
        setSyncReady(true)
      } finally {
        if (!cancelled) setSyncing(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user?.id])

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [pendingDiff, setPendingDiff] = useState(null)
  const [pendingPlan, setPendingPlan] = useState(null)
  const [ghHint, setGhHint] = useState(null) // AI suggestions for the GitHub window (commit message / repo)
  const [aiActions, setAiActions] = useState([]) // actions the AI proposed, waiting for the user's OK
  const ALLOWED_AI_ACTIONS = ['github_push', 'github_import', 'run_preview', 'run_tests']
  const queueAiActions = (list) => {
    const clean = (Array.isArray(list) ? list : [])
      .filter((a) => a && ALLOWED_AI_ACTIONS.includes(a.type))
      .slice(0, 3)
      .map((a) => ({ type: a.type, message: String(a.message || '').slice(0, 140), repo: String(a.repo || '').slice(0, 100) }))
    if (clean.length) setAiActions(clean)
  }
  const runAiAction = (a) => {
    setAiActions((list) => list.filter((x) => x !== a))
    const did = { github_push: ['github', 'Opened the GitHub push window'], github_import: ['github', 'Opened the GitHub import window'], run_preview: ['preview', 'Opened the live preview'], run_tests: ['check', 'Started an error check'] }[a.type]
    if (did) addActivity([{ kind: did[0], title: did[1], detail: a.message || a.repo || '' }])
    if (a.type === 'github_push') { setGhHint({ message: a.message }); handleGitHubPush() }
    else if (a.type === 'github_import') { setGhHint({ repo: a.repo }); handleGitHubPull() }
    else if (a.type === 'run_preview') { setViewMode('preview'); setMobileView?.('preview') }
    else if (a.type === 'run_tests') runTestLoop([], 'Check the project works').catch((e) => setTestProgress({ done: true, status: 'warn', summary: e.message }))
  }
  const [toast, setToast] = useState(null)
  const [inputModal, setInputModal] = useState(null)

    // ---- Payment success detection ----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'success') {
      window.history.replaceState({}, '', window.location.pathname)
      setToast({
        msg: '💎 Payment received — your Pro tier will activate shortly.',
        kind: 'ok',
      })
      setTimeout(() => setToast(null), 5000)

      // Trigger a usage refetch
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('stream-refresh-usage'))
      }, 2500)
    }
  }, [])

  // Phase 4 state
  const [pendingAi, setPendingAi] = useState(null) // request coming from click-to-edit in the preview
  const askAiFromPreview = (req) => { setPendingAi(req); setMobileView('ai'); setShowAI?.(true) }
  const [mobileView, setMobileView] = useState('editor') // 'files' | 'editor' | 'ai' | 'preview'
  const [viewMode, setViewMode] = useState('code') // 'code' | 'preview'
  const [consoleMessages, setConsoleMessages] = useState([])

  // Planning mode state
  const [pendingPlanning, setPendingPlanning] = useState(null) // { plan, originalPrompt }
  const [planningRunning, setPlanningRunning] = useState(false)
  const [planningStepStatuses, setPlanningStepStatuses] = useState({})
  const [planningStepLogs, setPlanningStepLogs] = useState({})
  const [planningCurrentStep, setPlanningCurrentStep] = useState(-1)
  const [planningError, setPlanningError] = useState(null)
  const [planningAllSteps, setPlanningAllSteps] = useState([])
  
  const editorRef = useRef(null)

  const activeContent = files[activeFile]?.content ?? ''
  const activeLanguage = useMemo(
    () => files[activeFile]?.language || getLanguageFromPath(activeFile),
    [activeFile, files]
  )

  const runTestLoop = async (appliedOps, originalPrompt) => {
  const maxAttempts = 3
  let currentFiles = { ...files }

  // Apply already happened before we got here, so files reflect the change
  // Wait a moment for React to flush
  await new Promise((r) => setTimeout(r, 100))

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    setTestProgress({ step: 'sync', message: `Testing (attempt ${attempt})…`, attempt })

    // Sync latest files to preview session
    let sessionId = getSessionId()
    sessionId = await syncPreview(currentFiles, activeFile)
    if (!sessionId) {
      setTestProgress({ done: true, status: 'ok', summary: 'No preview session — skipped.' })
      return
    }

    // Clear old errors
    await clearPreviewErrors(sessionId)

    // Wait for preview to reload and errors to report (frontend opens it via iframe)
    // Trigger a reload by incrementing a counter — but the Live URL iframe is separate.
    // Simpler: we just wait and then read whatever errors landed.
    setTestProgress({ step: 'wait', message: 'Waiting for preview console…', attempt })
    await new Promise((r) => setTimeout(r, 2000))

    // Fetch errors
    const errors = await fetchPreviewErrors(sessionId)
    setTestProgress({ step: 'diagnose', message: `Analyzing ${errors.length} console message(s)…`, attempt })

    // Ask the AI to diagnose
    const diagnosis = await diagnose({
      sessionId,
      files: currentFiles,
      activeFile,
      errors,
      originalPrompt,
      attempt,
      model: settings.model,
    })

    if (diagnosis.status === 'ok') {
      setTestProgress({ done: true, status: 'ok', summary: diagnosis.summary || 'All good ✅' })
      showToast(`✅ Test passed: ${diagnosis.summary || 'no errors'}`, 'ok')
      // Push to chat
      window.dispatchEvent(new CustomEvent('stream-test-result', {
        detail: { status: 'ok', summary: diagnosis.summary, attempt }
      }))
      return
    }

    // AI found a bug — propose fix
    if (diagnosis.status === 'fix' && Array.isArray(diagnosis.operations) && diagnosis.operations.length > 0) {
      setTestProgress({ step: 'fix', message: `Attempt ${attempt}: proposing fix — ${diagnosis.summary}`, attempt })

      // Auto-apply the fix (goes through normal file update flow)
      const before = Object.fromEntries(
        diagnosis.operations.map((op) => [op.path, currentFiles[op.path]?.content ?? null])
      )
      pushHistory(`Auto-fix: ${diagnosis.summary || 'agent fix'}`, before, 'ai')

      const nextFiles = { ...currentFiles }
      for (const op of diagnosis.operations) {
        if (op.type === 'create_file' || op.type === 'write_file') {
          nextFiles[op.path] = {
            content: op.content ?? '',
            language: getLanguageFromPath(op.path),
          }
        } else if (op.type === 'delete_file') {
          delete nextFiles[op.path]
        } else if (op.type === 'edit_file') {
          nextFiles[op.path] = {
            content: resolveOp(nextFiles, op).after,
            language: getLanguageFromPath(op.path),
          }
        }
      }
      currentFiles = nextFiles
      setFiles(nextFiles)

      window.dispatchEvent(new CustomEvent('stream-test-result', {
        detail: { status: 'fix', summary: diagnosis.summary, attempt, operations: diagnosis.operations }
      }))

      // Loop will retry the test
      continue
    }

    // Unexpected shape — bail
    setTestProgress({ done: true, status: 'ok', summary: 'No further action.' })
    return
  }

  setTestProgress({ done: true, status: 'warn', summary: 'Max test attempts reached.' })
  window.dispatchEvent(new CustomEvent('stream-test-result', {
    detail: { status: 'warn', summary: `Still errors after ${maxAttempts} attempts.` }
  }))
}

  useEffect(() => { saveFiles(files) }, [files])

  useEffect(() => {
  if (isMobile) {
    setShowSidebar(false)
    setShowAI(false)
    setBottomOpen(false)
  }
}, [isMobile])

  // After changes are really applied: say what changed (from the real files), then explain it.
  const reportChanges = async (ops, finalFiles, originalPrompt) => {
    const seen = new Map()
    for (const op of ops) seen.set(op.path, op) // last operation per file wins
    const changes = [...seen.values()].map((op) => {
      const content = finalFiles[op.path]?.content ?? ''
      const lines = content ? content.split('\n').length : 0
      if (op.type === 'delete_file') return { kind: 'deleted', path: op.path, excerpt: '' }
      if (op.type === 'edit_file') {
        const n = Array.isArray(op.edits) ? op.edits.length : 1
        const sample = (op.edits || []).slice(0, 3).map((e) => `- ${String(e.find).slice(0, 120)}\n+ ${String(e.replace).slice(0, 160)}`).join('\n')
        return { kind: 'edited', path: op.path, note: `${n} edit${n === 1 ? '' : 's'}`, excerpt: sample }
      }
      return { kind: op.type === 'create_file' ? 'created' : 'rewrote', path: op.path, note: `${lines} lines`, excerpt: content.slice(0, 900) }
    })
    if (!changes.length) return
    const activity = changes.map((c) => ({
      kind: c.kind,
      title: `${c.kind[0].toUpperCase() + c.kind.slice(1)} ${c.path}`,
      note: c.note,
      detail: c.excerpt || '',
    }))
    let why = ''
    try {
      why = await summarizeChanges({ originalPrompt, changes, model: settings.model, behavior: settings.behavior || 'friendly' })
    } catch { /* the factual list alone is still honest */ }
    // The explanation shows in chat; the detailed list of what was done sits in a collapsed line under it
    setMessages((m) => [...m, { role: 'assistant', text: why, activity, time: Date.now() }])
  }

  // A collapsed "what I did" line in the chat (no message text)
  const addActivity = (items) => setMessages((m) => [...m, { role: 'assistant', text: '', activity: items, time: Date.now() }])
  useEffect(() => { setAskQuestions(settings.askQuestions !== false) }, [settings.askQuestions])
  // project rules file: ION.md, AGENTS.md or .ionrules at the project root
  const rulesPath = ['ION.md', 'AGENTS.md', '.ionrules'].find((n) => files[n])
  useEffect(() => { setProjectRules(rulesPath ? files[rulesPath].content : '') }, [rulesPath, rulesPath && files[rulesPath]?.content])
  // what the AI is told about the editor, the user and the logs
  const MEM_FILE = 'ION_MEMORY.md'
  useEffect(() => { setCtx('memory', files[MEM_FILE]?.content || '') }, [files[MEM_FILE]?.content])
  useEffect(() => { setCtx('aiName', (settings.aiName || '').trim()) }, [settings.aiName])
  useEffect(() => { setCtx('userName', user?.user_metadata?.full_name || user?.user_metadata?.name || (user?.email ? user.email.split('@')[0] : '')) }, [user])
  useEffect(() => { setCtx('console', consoleMessages.map((m) => `[${m.level}] ${m.text}`)) }, [consoleMessages])
  useEffect(() => {
    if (!user) return
    getGitHubStatus().then((g) => setCtx('github', { connected: !!(g.connected ?? g.linked ?? g.login ?? g.username), login: g.login || g.username || g.user || '' })).catch(() => {})
  }, [user, showSettings])
  useEffect(() => {
    const c = loadCheckpoint(activeSession.id)
    setCtx('progress', c ? `Task: ${c.prompt}\nDone: ${(c.doneTitles || []).join('; ') || 'nothing'}\nStill to do: ${(c.todoTitles || []).join('; ') || 'unknown'}\nFiles already created: ${(c.doneFiles || []).join(', ') || 'none'}` : '')
  }, [activeSession.id, pendingPlanning])
  useEffect(() => {
    const onTest = (e) => {
      const d = e.detail || {}
      addActivity([{ kind: d.status === 'ok' ? 'check' : 'warn', title: d.status === 'ok' ? 'Checked the project: no errors' : 'Checked the project: problems found', detail: d.summary || '' }])
    }
    window.addEventListener('stream-test-result', onTest)
    return () => window.removeEventListener('stream-test-result', onTest)
  }, [])

  const showToast = (msg, kind = 'info') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 2400)
  }
  useEffect(() => {
  localStorage.setItem('stream-sidebar', showSidebar)
}, [showSidebar])

useEffect(() => {
  localStorage.setItem('stream-ai', showAI)
}, [showAI])

useEffect(() => {
  const t = setTimeout(async () => {
    const id = await syncPreview(files, activeFile)
    setPreviewSession(id)
  }, 1200)
  return () => clearTimeout(t)
}, [files, activeFile])

useEffect(() => {
  const handler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault()
      setShowSidebar((s) => !s)
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
      e.preventDefault()
      setBottomOpen((o) => !o)
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault()
      setShowAI((s) => !s)
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [])

useEffect(() => {
  if (pendingGotoLine && activeFile === pendingGotoLine.path && viewMode === 'code') {
    const t = setTimeout(() => {
      editorRef.current?.gotoLine(pendingGotoLine.line)
      setPendingGotoLine(null)
    }, 100)
    return () => clearTimeout(t)
  }
}, [activeFile, pendingGotoLine, viewMode])

useEffect(() => {
  saveSettings(settings)
  applyTheme(settings.theme)
  try { document.documentElement.dataset.liquid = settings.liquid === false || settings.reduceMotion ? 'off' : 'on' } catch { /* ignore */ }
}, [settings])

  // ---------- File ops ----------
  const openFile = (path) => {
    if (!files[path]) return
    if (!openTabs.includes(path)) setOpenTabs((t) => [...t, path])
    setActiveFile(path)
    setViewMode('code')
  }

  const closeTab = (path) => {
    const next = openTabs.filter((t) => t !== path)
    setSessionStore((s) => updateSession(s, s.activeSessionId, {
      openTabs: next,
      ...(path === activeFile ? { activeFile: next[next.length - 1] || '' } : {}),
    }))
  }

  const updateActiveContent = (newContent) => {
    setFiles((f) => ({
      ...f,
      [activeFile]: { ...f[activeFile], content: newContent },
    }))
    setDirty((d) => new Set(d).add(activeFile))
  }

  const changeLanguage = (lang) => {
    if (!activeFile) return
    setFiles((f) => ({
      ...f,
      [activeFile]: { ...f[activeFile], language: lang },
    }))
    setDirty((d) => new Set(d).add(activeFile))
    showToast(`Language: ${lang}`, 'info')
  }

const saveActive = () => {
  if (!activeFile) return
  if (dirty.has(activeFile)) {
    // Snapshot the *current* saved content so we can restore it later
    pushHistory(`Saved ${activeFile}`, {
      [activeFile]: files[activeFile]?.content ?? '',
    }, 'manual')
  }
  setDirty((d) => {
    const next = new Set(d)
    next.delete(activeFile)
    return next
  })
  showToast(`Saved ${activeFile.split('/').pop()}`, 'ok')
}
  // ---- save to a real folder on this computer ----
  const filesRef = useRef(files)
  filesRef.current = files
  const [diskFolder, setDiskFolder] = useState(null)
  useEffect(() => { linkedFolder(activeSession.id).then(setDiskFolder) }, [activeSession.id])

  const diskSaveActive = async () => {
    if (!activeFile) return
    const f = filesRef.current[activeFile]
    if (typeof f?.content !== 'string') return
    const r = await saveToDisk(activeSession.id, activeFile, f.content)
    if (r.ok && r.where === 'folder') { setDiskFolder({ name: r.folder }); showToast(`Saved to ${r.folder}/${activeFile}`, 'ok') }
    else if (r.ok) showToast(`Downloaded ${activeFile.split('/').pop()}`, 'ok')
    else if (r.error) showToast(`Could not save to your computer: ${r.error}`, 'warn')
  }
  const diskSaveAll = async () => {
    const r = await saveAllToDisk(activeSession.id, filesRef.current)
    if (r.ok) { setDiskFolder({ name: r.folder }); showToast(`Saved ${r.count} file${r.count === 1 ? '' : 's'} to ${r.folder}`, 'ok') }
    else if (!r.cancelled) showToast('Nothing was saved. Your browser may not allow saving to folders.', 'warn')
  }
  const diskChoose = async () => {
    const c = await chooseFolder(activeSession.id)
    if (c) { setDiskFolder(c); showToast(`Project folder: ${c.name}`, 'ok') }
  }
  const diskRef = useRef({})
  diskRef.current = { diskSaveActive, diskSaveAll, saveActive }

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) { diskRef.current.diskSaveAll(); return }
        diskRef.current.saveActive()
        diskRef.current.diskSaveActive()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeFile])

  const deleteFile = (path) => {
    setFiles((f) => {
      const next = { ...f }
      delete next[path]
      return next
    })
    setOpenTabs((tabs) => tabs.filter((t) => t !== path))
    if (activeFile === path) {
      const remaining = openTabs.filter((t) => t !== path)
      setActiveFile(remaining[remaining.length - 1] || '')
    }
    showToast(`Deleted ${path}`, 'info')
  }

    useEffect(() => {
    const handler = (e) => {
      const mod = e.ctrlKey || e.metaKey

      if (mod && !e.shiftKey && e.key === 'p') {
        e.preventDefault()
        setPaletteMode('files')
        return
      }
      if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        setPaletteMode('commands')
        return
      }
      if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault()
        setShowSidebar(true)
        setSidebarTab('search')
        return
      }
      if (mod && !e.shiftKey && e.key === 'f') {
        if (viewMode === 'code' && activeFile) {
          e.preventDefault()
          editorRef.current?.openFind()
        }
        return
      }
      if (mod && !e.shiftKey && e.key === 'h') {
        if (viewMode === 'code' && activeFile) {
          e.preventDefault()
          editorRef.current?.openReplace()
        }
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [viewMode, activeFile])


  const handleReset = () => {
    resetFiles()
    setFiles({ ...DEFAULT_FILES })
    setOpenTabs(['src/App.jsx'])
    setActiveFile('src/App.jsx')
    setDirty(new Set())
    setHistory([])
    setConsoleMessages([])
    showToast('Files reset to defaults', 'ok')
  }

  // ---------- Simple AI edits ----------
  const runEdit = async ({ action, selection, instruction, label }) => {
    if (busy || !activeFile) return
    const editor = editorRef.current
    if (!editor) return
    const current = activeContent

    // Big file: do not send it whole. The AI reads only the lines it needs with the terminal
    // and proposes small edits, which open in the normal review screen.
    if (['fix', 'refactor', 'comment'].includes(action) && current.length > 6000) {
      const asks = {
        fix: `Find and fix bugs in ${activeFile}. Read only the parts you need with the shell, and change only what is broken.`,
        refactor: `Refactor ${activeFile} to be cleaner without changing behavior. Read only the parts you need with the shell and make small targeted edits.`,
        comment: `Add helpful comments to ${activeFile} without changing logic. Read it in pieces with the shell and make small targeted edits.`,
      }
      setBusy(true); setStatus(`AI: reading ${activeFile}…`)
      try {
        const plan = await streamAgent(
          {
            prompt: asks[action], files, activeFile, history: [],
            model: settings.model, thinking: settings.thinking || 'medium', behavior: settings.behavior || 'friendly',
          },
          undefined,
          (cmd) => setStatus(`AI reading: ${cmd.slice(0, 50)}`)
        )
        setBusy(false); setStatus('Ready')
        if (!plan.operations || plan.operations.length === 0) {
          showToast(plan.explanation || 'No changes needed', 'info')
          return
        }
        setPendingPlan({ plan, originalPrompt: asks[action] })
      } catch (err) {
        setBusy(false); setStatus('Ready')
        showToast(`AI error: ${err.message}`, 'error')
      }
      return
    }

    if (action === 'selection' && selection && selection.trim()) {
      setBusy(true); setStatus(`AI: ${label || instruction}`)
      let result = ''
      try {
        await streamEdit(
  { action: 'selection', selection, code: current, language: activeLanguage, instruction, model: settings.model, thinking: settings.thinking || 'medium' },
  (chunk) => { result += chunk }

        )
        setBusy(false); setStatus('Ready')
        setPendingDiff({
          original: current,
          next: current.replace(selection, result.trim()),
          label: label || instruction,
        })
      } catch (err) {
        setBusy(false); setStatus('Ready')
        showToast(`AI error: ${err.message}`, 'error')
      }
      return
    }

    setBusy(true); setStatus(`AI: ${label || action}...`)
    let result = ''
    try {
      await streamEdit(
  { action, code: current, language: activeLanguage, instruction, model: settings.model, thinking: settings.thinking || 'medium' },
  (chunk) => { result += chunk }

      )
      setBusy(false); setStatus('Ready')
      if (action === 'explain') { showToast(result.slice(0, 200), 'info'); return }
      setPendingDiff({ original: current, next: result.trim(), label: label || action })
    } catch (err) {
      setBusy(false); setStatus('Ready')
      showToast(`AI error: ${err.message}`, 'error')
    }
  }

  const acceptDiff = () => {
    if (!pendingDiff || !activeFile) return
    pushHistory(`Edit: ${pendingDiff.label}`, { [activeFile]: files[activeFile]?.content ?? '' }, 'ai')
    updateActiveContent(pendingDiff.next)
    editorRef.current?.setValue(pendingDiff.next)
    setPendingDiff(null)
    showToast('Applied ✓', 'ok')
  }

  const rejectDiff = () => {
    setPendingDiff(null)
    showToast('Rejected', 'info')
  }

  const pushHistory = (label, before, kind = 'ai') => {
  setHistory((h) => [
    ...h.slice(-49),
    {
      label,
      before,
      kind,
      time: Date.now(),
      id: Math.random().toString(36).slice(2),
    },
  ])
}

  // ---- proposals from a connected ION character (session link) ----
  useEffect(() => {
    if (!user) return
    countLinks().then((n) => setHasLinks(n > 0)).catch(() => {})
  }, [user])
  useEffect(() => {
    if (!user || !hasLinks) return
    let stop = false
    const tick = async () => {
      if (document.hidden) return
      try {
        const rows = await pendingActions(activeSession.id)
        if (!stop) setLinkActions(rows.map((r) => ({ id: r.id, type: r.type, path: r.payload?.path, message: r.note || r.payload?.message, repo: r.payload?.repo, payload: r.payload, fromIon: true })))
      } catch { /* ignore */ }
    }
    tick()
    const t = setInterval(tick, 6000)
    return () => { stop = true; clearInterval(t) }
  }, [user, hasLinks, activeSession.id])

  const decideLinkAction = (a, ok) => {
    setLinkActions((l) => l.filter((x) => x.id !== a.id))
    if (!ok) { markAction(a.id, 'rejected').catch(() => {}); return }
    if (['write_file', 'edit_file', 'delete_file'].includes(a.type)) {
      const op = { type: a.type, path: a.path, content: a.payload?.content, edits: a.payload?.edits }
      setPendingPlan({ plan: { explanation: a.message || 'Change from an ION character', operations: [op] }, originalPrompt: '', linkActionId: a.id })
    } else {
      markAction(a.id, 'approved').catch(() => {})
      runAiAction({ type: a.type, message: a.message, repo: a.repo })
    }
  }

 const applyPlan = (chosenOps, explanation, originalPrompt) => {
  if (pendingPlan?.linkActionId) markAction(pendingPlan.linkActionId, 'approved').catch(() => {})
  const before = Object.fromEntries(
    chosenOps.map((op) => [op.path, files[op.path]?.content ?? null])
  )
  pushHistory(explanation || 'AI change', before, 'ai')

  const nextFiles = { ...files }
  for (const op of chosenOps) {
    if (op.type === 'create_file' || op.type === 'write_file') {
      nextFiles[op.path] = {
        content: op.content ?? '',
        language: getLanguageFromPath(op.path),
      }
    } else if (op.type === 'delete_file') {
      delete nextFiles[op.path]
    } else if (op.type === 'edit_file') {
          nextFiles[op.path] = {
            content: resolveOp(nextFiles, op).after,
            language: getLanguageFromPath(op.path),
          }
        }
  }
  setFiles(nextFiles)

  if (chosenOps[0]) {
    const first = chosenOps[0].path
    setOpenTabs((tabs) => tabs.includes(first) ? tabs : [...tabs, first])
    setActiveFile(first)
  }

  setPendingPlan(null)
  showToast(`Applied ${chosenOps.length} change(s)`, 'ok')
  reportChanges(chosenOps, nextFiles, originalPrompt).catch(() => {})

  // If test-after-apply is enabled, run the test loop
  if (testAfterApply) {
    // Wait a tick so files state updates
    setTimeout(() => {
      runTestLoop(chosenOps, originalPrompt).catch((err) => {
        console.error('Test loop error:', err)
        setTestProgress({ done: true, status: 'warn', summary: err.message })
      })
    }, 150)
  }
}

  const revertLast = () => {
  if (history.length === 0) return
  const last = history[history.length - 1]
  restoreSnapshot(last)
  setHistory((h) => h.slice(0, -1))
  showToast(`Reverted: ${last.label}`, 'ok')
}

const restoreSnapshot = (entry) => {
  setFiles((f) => {
    const next = { ...f }
    for (const [path, content] of Object.entries(entry.before)) {
      if (content === null) {
        delete next[path]
      } else if (content === undefined) {
        continue
      } else {
        next[path] = {
          ...(next[path] || {}),
          content,
          language: next[path]?.language || getLanguageFromPath(path),
        }
      }
    }
    return next
  })
}

  useEffect(() => {
    const handler = (e) => {
      const { action, instruction, selection } = e.detail
      runEdit({ action, selection, instruction, label: instruction })
    }
    window.addEventListener('ai-action', handler)
    return () => window.removeEventListener('ai-action', handler)
  }, [busy, activeFile, activeContent])

  // Console message handler from preview
  const handleConsoleMessage = (msg) => {
    setConsoleMessages((m) => [...m.slice(-199), msg])
  }

    // ---------- File management ----------
  // creates (or opens) ION.md, the file where the user writes rules the AI must always follow
  const openRulesFile = () => {
    const name = rulesPath || 'ION.md'
    if (!files[name]) {
      setFiles(createFile(files, name, `# Project rules\n\nThe AI reads this file before every answer. Write things it should always do.\n\n- Use TypeScript, not JavaScript\n- Keep components small and well named\n- Never add new libraries without asking me\n- Reply in simple English\n`))
    }
    setShowSettings(false)
    openFile(name)
    setMobileView('editor')
  }

  const handleNewFile = (parentPath) => {
    setInputModal({ type: 'new-file', parent: parentPath })
  }

  const handleNewFolder = (parentPath) => {
    setInputModal({ type: 'new-folder', parent: parentPath })
  }

  const handleInputSubmit = (name) => {
    const { type, parent } = inputModal
    const prefix = parent ? parent + '/' : ''
    const fullPath = prefix + name

    try {
      if (type === 'new-file') {
        const next = createFile(files, fullPath)
        setFiles(next)
        setOpenTabs((t) => t.includes(fullPath) ? t : [...t, fullPath])
        setActiveFile(fullPath)
        showToast(`Created ${fullPath}`, 'ok')
      } else if (type === 'new-folder') {
        const next = createFolder(files, fullPath)
        setFiles(next)
        showToast(`Created folder ${fullPath}`, 'ok')
      }
      setInputModal(null)
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  const handleRename = (oldPath, newName) => {
    try {
      const parts = oldPath.split('/')
      parts[parts.length - 1] = newName
      const newPath = parts.join('/')

      const next = renamePath(files, oldPath, newPath)
      setFiles(next)

      setOpenTabs((tabs) =>
        tabs.map((t) => {
          if (t === oldPath) return newPath
          if (t.startsWith(oldPath + '/')) return newPath + t.slice(oldPath.length)
          return t
        })
      )
      if (activeFile === oldPath) setActiveFile(newPath)
      else if (activeFile.startsWith(oldPath + '/')) {
        setActiveFile(newPath + activeFile.slice(oldPath.length))
      }

      showToast(`Renamed to ${newName}`, 'ok')
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  // ---------- Zip export / import ----------
const handleExportZip = () => {
  try {
    const blob = exportProjectToZip(files)
    const date = new Date().toISOString().slice(0, 10)
    downloadBlob(blob, `stream-project-${date}.zip`)
    showToast('Project exported', 'ok')
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error')
  }
}

const handleImportZip = async (zipFile, mode) => {
  try {
    const imported = await importZipToFiles(zipFile)

    if (Object.keys(imported).length === 0) {
      showToast('No files found in zip', 'error')
      return
    }

    // Snapshot current files for history
    const beforeSnapshot = {}
    for (const path of Object.keys(files)) {
      beforeSnapshot[path] = files[path].content
    }
    // In replace mode, files not in the zip will be deleted — mark them
    if (mode === 'replace') {
      for (const path of Object.keys(files)) {
        if (!imported[path]) beforeSnapshot[path] = files[path].content
      }
    }
    pushHistory(
      `Import zip (${Object.keys(imported).length} files, ${mode})`,
      beforeSnapshot,
      'manual'
    )

    // Build the new files map
    let nextFiles
    if (mode === 'replace') {
      nextFiles = {}
      for (const [path, file] of Object.entries(imported)) {
        nextFiles[path] = {
          content: file.content,
          language: getLanguageFromPath(path),
        }
      }
    } else {
      nextFiles = { ...files }
      for (const [path, file] of Object.entries(imported)) {
        nextFiles[path] = {
          content: file.content,
          language: getLanguageFromPath(path),
        }
      }
    }

    setFiles(nextFiles)

    // Reset tabs to a sensible state
    const firstPath = Object.keys(imported)[0]
    if (firstPath) {
      setOpenTabs([firstPath])
      setActiveFile(firstPath)
    } else {
      setOpenTabs([])
      setActiveFile('')
    }

    setShowImport(false)
    showToast(`Imported ${Object.keys(imported).length} file(s)`, 'ok')
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error')
  }
}

  // ---------- Command palette ----------
  const commands = [
    { id: 'save',           label: '💾 Save File',            hint: 'Ctrl+S',       action: 'save' },
    { id: 'find',           label: 'Find in File',         hint: 'Ctrl+F',       action: 'find' },
    { id: 'replace',        label: '🔁 Replace in File',      hint: 'Ctrl+H',       action: 'replace' },
    { id: 'search-all',     label: '🔎 Search All Files',     hint: 'Ctrl+Shift+F', action: 'searchAll' },
    { id: 'new-file',       label: 'New File',             hint: '',             action: 'newFile' },
    { id: 'new-folder',     label: 'New Folder',           hint: '',             action: 'newFolder' },
    { id: 'toggle-code',    label: '📝 Show Code',            hint: '',             action: 'viewCode' },
    { id: 'toggle-prev',    label: 'Show Preview',         hint: '',             action: 'viewPreview' },
    { id: 'ai-complete',    label: '✨ AI: Complete',         hint: '',             action: 'aiComplete' },
    { id: 'ai-fix',         label: '🔧 AI: Fix Bugs',         hint: '',             action: 'aiFix' },
    { id: 'ai-refactor',    label: '♻️ AI: Refactor',          hint: '',             action: 'aiRefactor' },
    { id: 'ai-comment',     label: '💬 AI: Comment',          hint: '',             action: 'aiComment' },
    { id: 'revert',         label: 'Revert Last AI Change', hint: '',             action: 'revert' },
    { id: 'toggle-sidebar', label: 'Toggle Sidebar',        hint: 'Ctrl+B',       action: 'toggleSidebar' },
    { id: 'toggle-ai',      label: '🤖 Toggle AI Panel',      hint: 'Ctrl+I',       action: 'toggleAI' },
    { id: 'toggle-bottom',  label: '▤ Toggle Bottom Panel',   hint: 'Ctrl+J',       action: 'toggleBottom' },
    { id: 'export-zip',     label: '📦 Export as ZIP',        hint: '',             action: 'exportZip' },
{ id: 'import-zip',     label: '📥 Import from ZIP',      hint: '',             action: 'importZip' },
  ]

  const runCommand = (action) => {
    switch (action) {
      case 'save': saveActive(); break
        case 'exportZip': handleExportZip(); break
case 'importZip': setShowImport(true); break
      case 'find': editorRef.current?.openFind(); break
      case 'replace': editorRef.current?.openReplace(); break
      case 'searchAll': setShowSidebar(true); setSidebarTab('search'); break
      case 'newFile': handleNewFile(''); break
      case 'newFolder': handleNewFolder(''); break
      case 'viewCode': setViewMode('code'); break
      case 'viewPreview': setViewMode('preview'); break
      case 'aiComplete': runEdit({ action: 'complete', label: 'Complete' }); break
      case 'aiFix':      runEdit({ action: 'fix', label: 'Fix bugs' }); break
      case 'aiRefactor': runEdit({ action: 'refactor', label: 'Refactor' }); break
      case 'aiComment':  runEdit({ action: 'comment', label: 'Comment' }); break
      case 'revert': revertLast(); break
      case 'toggleSidebar': setShowSidebar((s) => !s); break
      case 'toggleAI': setShowAI((s) => !s); break
      case 'toggleBottom': setBottomOpen((o) => !o); break
    }
  }

  const openFileAtLine = (path, line) => {
    if (!files[path]) return
    if (!openTabs.includes(path)) setOpenTabs((t) => [...t, path])
    setActiveFile(path)
    setViewMode('code')
    setPendingGotoLine({ path, line })
  }

  const handleDelete = (path) => {
    const isFolder = Object.keys(files).some((p) => p.startsWith(path + '/'))
    const msg = isFolder
      ? `Delete folder "${path}" and everything inside?`
      : `Delete "${path}"?`
    if (!confirm(msg)) return

    const next = deletePath(files, path)
    setFiles(next)

    setOpenTabs((tabs) =>
      tabs.filter((t) => t !== path && !t.startsWith(path + '/'))
    )
    if (activeFile === path || activeFile.startsWith(path + '/')) {
      const remaining = openTabs.filter(
        (t) => t !== path && !t.startsWith(path + '/')
      )
      setActiveFile(remaining[remaining.length - 1] || '')
    }

    showToast(`Deleted ${path}`, 'info')
  }

  // Quick AI actions (complete / fix / refactor / comment) sit at the right of the editor tabs
  const aiActionsSlot = (
    <AIDropdown
      disabled={busy || !activeFile || viewMode !== 'code'}
      onAction={(action, label) => runEdit({ action, label })}
    />
  )

  return (
    <div className={`app ${isMobile ? 'm-on' : ''}`}>
      {!isMobile && <div className="topbar">
        <div className="topbar-left">
          <div className="logo">
            <div className="logo-dot" />
            <span className="logo-text">ION Qoders</span>
          </div>
          <ProjectMenu
            canSave={!!activeFile}
            canRevert={history.length > 0}
            onSave={saveActive}
            onRevert={revertLast}
            onExport={handleExportZip}
            onImport={() => setShowImport(true)}
          />
        </div>

        {/* View toggle */}
        <div className="view-toggle" style={isMobile ? { display: 'none' } : undefined}>
          <button
            className={`view-btn ${viewMode === 'code' ? 'active' : ''}`}
            onClick={() => setViewMode('code')}
          >
            Code
          </button>
          <button
            className={`view-btn ${viewMode === 'preview' ? 'active' : ''}`}
            onClick={() => setViewMode('preview')}
          >
            <Icon name="play" size={11} /> Preview
          </button>
        </div>

        <div className="topbar-right">
          {!isMobile && (
            <>
              <button
                className={`topbar-btn icon ${showSidebar ? 'active' : ''}`}
                onClick={() => setShowSidebar((s) => !s)}
                title="Toggle sidebar (Ctrl+B)"
              >
                <Icon name="menu" size={18} />
              </button>
              <button
                className={`topbar-btn icon ${showAI ? 'active' : ''}`}
                onClick={() => setShowAI((s) => !s)}
                title="Toggle AI panel (Ctrl+I)"
              >
                <Icon name="bot" size={18} />
              </button>
              <button
                className={`topbar-btn icon ${bottomOpen ? 'active' : ''}`}
                onClick={() => setBottomOpen(!bottomOpen)}
                title="Toggle terminal / bottom panel (Ctrl+J)"
              >
                <Icon name="panel" size={18} />
              </button>
            </>
          )}

          {isMobile && (
            <button
              className={`topbar-btn icon ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => {
                setMobileView('editor')
                setViewMode((v) => (v === 'preview' ? 'code' : 'preview'))
              }}
              title={viewMode === 'preview' ? 'Stop preview' : 'Run preview'}
            ><Icon name={viewMode === 'preview' ? 'stop' : 'play'} size={15} /></button>
          )}

          <button
            className="topbar-btn icon"
            onClick={() => setShowSettings(true)}
            title="Settings"
          ><Icon name="settings" size={17} /></button>

          {!isMobile && <UsageDropdown onUpgrade={handleUpgrade} onManage={handleManageBilling} />}

          {syncing && (
            <span className="sync-indicator" title="Syncing to cloud...">
              <Icon name="sync" size={14} className="spin" />
            </span>
          )}

          {user ? (
            <UserMenu />
          ) : (
            <button
              className="topbar-btn primary"
              onClick={() => setShowLogin(true)}
              title="Sign in"
            >
              Sign in
            </button>
          )}
        </div>
      </div>}

{isMobile ? (
  <MobileLayout
    tab={mobileView}
    setTab={setMobileView}
    fileName={activeFile}
    editorRef={editorRef}
    consoleCount={consoleMessages.length}
    syncing={syncing}
    moreItems={[
      { icon: 'settings', label: 'Settings', onClick: () => setShowSettings(true) },
      { icon: 'save', label: 'Save', onClick: () => { saveActive(); diskSaveActive() }, disabled: !activeFile },
      { icon: 'undo', label: 'Revert', onClick: revertLast, disabled: history.length === 0 },
      { icon: 'upload', label: 'Import', onClick: () => setShowImport(true) },
      { icon: 'download', label: 'Export zip', onClick: handleExportZip },
      { icon: 'push', label: 'Push to GitHub', onClick: handleGitHubPush },
      { icon: 'pull', label: 'Pull from GitHub', onClick: handleGitHubPull },
      { icon: 'play', label: 'GitHub Actions', onClick: () => setShowActions(true) },
      { icon: 'search', label: 'Find in file', onClick: () => { setMobileView('editor'); setTimeout(() => editorRef.current?.openFind?.(), 150) } },
    ]}
    account={user ? <UserMenu /> : <button className="topbar-btn primary" onClick={() => setShowLogin(true)}>Sign in</button>}
    files={
      <FileTree
        files={files}
        activeFile={activeFile}
        onFileClick={(path) => { openFile(path); setMobileView('editor') }}
        onDelete={handleDelete}
        onRename={handleRename}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
        onReset={handleReset}
      />
    }
    search={<SearchPanel files={files} onOpenResult={(...a) => { openFileAtLine(...a); setMobileView('editor') }} />}
    history={
      <HistoryPanel
        history={history}
        onRestore={(entry) => { restoreSnapshot(entry); showToast(`Restored: ${entry.label}`, 'ok') }}
        onClear={() => setHistory([])}
      />
    }
    code={
      <>
        <Tabs
          openTabs={openTabs}
          activeFile={activeFile}
          dirty={dirty}
          onTabClick={setActiveFile}
          onTabClose={closeTab}
          rightSlot={aiActionsSlot}
        />
        {activeFile ? (
          <Editor
            ref={editorRef}
            code={activeContent}
            setCode={updateActiveContent}
            language={activeLanguage}
            settings={settings}
            mobile
          />
        ) : (
          <div className="empty-editor">No file open.<br />Tap Files below to open one, or ask the AI to build something.</div>
        )}
      </>
    }
    preview={
      <Preview
        files={files}
        activeFile={activeFile}
        onConsoleMessage={handleConsoleMessage}
        sessionId={previewSession}
        onAskAI={askAiFromPreview}
      />
    }
    ai={
      <AIChat
        pendingRequest={pendingAi}
        onRequestHandled={() => setPendingAi(null)}
        code={activeContent}
        language={activeLanguage}
        files={files}
        activeFile={activeFile}
        messages={messages}
        setMessages={setMessages}
        sessionTitle={activeSession.title}
        onFirstMessage={(text) => {
          if (activeSession.title === 'New session') {
            handleRenameSession(activeSession.id, generateTitle(text))
          }
        }}
        onApplyPlan={(plan, prompt) => setPendingPlan({ plan, originalPrompt: prompt })}
        onAiActions={queueAiActions}
        onPlanReady={(plan, prompt) => setPendingPlanning({ plan, originalPrompt: prompt })}
        model={settings.model}
        onModelChange={(m) => setSettings((x) => ({ ...x, model: m }))}
        onThinkingChange={(t) => setSettings((x) => ({ ...x, thinking: t }))}
        onBehaviorChange={(b) => setSettings((x) => ({ ...x, behavior: b }))}
        thinking={settings.thinking || 'medium'}
        behavior={settings.behavior || 'friendly'}
        testAfterApply={testAfterApply}
        onTestToggle={setTestAfterApply}
        team={!!settings.team}
        onTeamToggle={(v) => setSettings((x) => ({ ...x, team: v }))}
        planningMode={true}
        sessions={sessionStore.sessions}
        activeSessionId={sessionStore.activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
      />
    }
    terminal={
      <BottomPanel
        open
        onClose={() => setMobileView('editor')}
        consoleMessages={consoleMessages}
        files={files}
        onFilesChange={(newFiles) => {
          pushHistory('Terminal command', Object.fromEntries(
            Object.keys(files).map((k) => [k, files[k]?.content ?? null])
          ), 'manual')
          setFiles(newFiles)
        }}
      />
    }
  />
) : (
  <div className="main">
    {showSidebar && (
      <div className="sidebar-wrap">
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${sidebarTab === 'explorer' ? 'active' : ''}`}
            onClick={() => setSidebarTab('explorer')}
            title="Explorer (files)"
          ><Icon name="folder" size={17} /></button>
          <button
            className={`sidebar-tab ${sidebarTab === 'search' ? 'active' : ''}`}
            onClick={() => setSidebarTab('search')}
            title="Search across files (Ctrl+Shift+F)"
          ><Icon name="search" size={17} /></button>
          <button
            className={`sidebar-tab ${sidebarTab === 'history' ? 'active' : ''}`}
            onClick={() => setSidebarTab('history')}
            title="Version history"
          ><Icon name="clock" size={17} /></button>
        </div>
        {sidebarTab === 'explorer' && (
          <FileTree
            files={files}
            activeFile={activeFile}
            onFileClick={openFile}
            onDelete={handleDelete}
            onRename={handleRename}
            onNewFile={handleNewFile}
            onNewFolder={handleNewFolder}
            onReset={handleReset}
          />
        )}
        {sidebarTab === 'search' && (
          <SearchPanel files={files} onOpenResult={openFileAtLine} />
        )}
        {sidebarTab === 'history' && (
          <HistoryPanel
            history={history}
            onRestore={(entry) => {
              restoreSnapshot(entry)
              showToast(`Restored: ${entry.label}`, 'ok')
            }}
            onClear={() => setHistory([])}
          />
        )}
      </div>
    )}
    <div className="editor-pane">
      <div className="editor-flash" key={`${viewMode}:${activeFile}`} aria-hidden="true" />
      {viewMode === 'code' ? (
        <>
          <Tabs
            openTabs={openTabs}
            activeFile={activeFile}
            dirty={dirty}
            onTabClick={setActiveFile}
            onTabClose={closeTab}
              rightSlot={aiActionsSlot}
          />
          {activeFile ? (
            <Editor
              ref={editorRef}
              code={activeContent}
              setCode={updateActiveContent}
              language={activeLanguage}
              settings={settings}
            />
          ) : (
            <div className="empty-editor">Open a file from the explorer →</div>
          )}
        </>
      ) : (
        <Preview
          files={files}
          activeFile={activeFile}
          onConsoleMessage={handleConsoleMessage}
          sessionId={previewSession}
          onAskAI={askAiFromPreview}
        />
      )}
    </div>
    {showAI && (
      <AIChat
        pendingRequest={pendingAi}
        onRequestHandled={() => setPendingAi(null)}
        code={activeContent}
        language={activeLanguage}
        files={files}
        activeFile={activeFile}
        messages={messages}
        setMessages={setMessages}
                behavior={settings.behavior || 'friendly'}
        sessionTitle={activeSession.title}
        onFirstMessage={(text) => {
          if (activeSession.title === 'New session') {
            handleRenameSession(activeSession.id, generateTitle(text))
          }
        }}
        onApplyPlan={(plan, prompt) => setPendingPlan({ plan, originalPrompt: prompt })}
          onAiActions={queueAiActions}
        onPlanReady={(plan, prompt) => setPendingPlanning({ plan, originalPrompt: prompt })}
        model={settings.model}
          onModelChange={(m) => setSettings((x) => ({ ...x, model: m }))}
          onThinkingChange={(t) => setSettings((x) => ({ ...x, thinking: t }))}
          onBehaviorChange={(b) => setSettings((x) => ({ ...x, behavior: b }))}
        thinking={settings.thinking || 'medium'}
        testAfterApply={testAfterApply}
        onTestToggle={setTestAfterApply}
        team={!!settings.team}
        onTeamToggle={(v) => setSettings((x) => ({ ...x, team: v }))}
        planningMode={true}
        sessions={sessionStore.sessions}
        activeSessionId={sessionStore.activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
      />
    )}
  </div>
)}

 <PlanningModal
        plan={pendingPlanning?.plan}
        stepStatuses={planningStepStatuses}
        stepLogs={planningStepLogs}
        running={planningRunning}
        currentStepIndex={planningCurrentStep}
        errorMessage={planningError}
        onReject={() => {
          if (planningRunning) return
          setPendingPlanning(null)
          setPlanningStepStatuses({})
          setPlanningStepLogs({})
          setPlanningError(null)
        }}
        onApprove={async (steps) => {
          if (!pendingPlanning) return
          setPlanningRunning(true)
          setPlanningError(null)
          setPlanningAllSteps(steps)

          // Fresh local state of files
          let currentFiles = { ...files }
          const allAppliedOps = []

          // Auto agents: with 5+ files in the plan, one worker per file (max 8)
          const totalFiles = new Set(steps.flatMap((st) => (Array.isArray(st.files) ? st.files : []))).size
          const autoOn = settings.autoAgents !== false && totalFiles >= 5 && steps.length >= 2
          const teamOn = !!settings.team || autoOn
          const LANE_MODELS = [settings.model, 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'openai/gpt-oss-20b']
          const team = teamOn ? await loadTeam().catch(() => []) : []
          const N = autoOn ? Math.min(Math.max(totalFiles, 2), steps.length, 8) : Math.max(team.length, 2)
          const lanes = teamOn
            ? Array.from({ length: N }, (_, k) => steps.filter((st, idx) => (autoOn ? idx : ((Number(st.lane) || 1) - 1)) % N === k))
            : [steps]
          if (autoOn) showToast(`Auto agents: ${N} AIs working at the same time`, 'ok')
          // pick up where an earlier run stopped: steps already finished are skipped
          const ckpt = loadCheckpoint(activeSession.id)
          const doneIds = new Set(ckpt && ckpt.prompt === pendingPlanning.originalPrompt ? ckpt.doneIds || [] : [])
          const doneTitles = []
          const doneFiles = new Set(ckpt && ckpt.prompt === pendingPlanning.originalPrompt ? ckpt.doneFiles || [] : [])
          const writeCkpt = () => saveCheckpoint(activeSession.id, {
            prompt: pendingPlanning.originalPrompt,
            doneIds: [...doneIds], doneFiles: [...doneFiles],
            doneTitles: steps.filter((x) => doneIds.has(x.id)).map((x) => x.title),
            todoTitles: steps.filter((x) => !doneIds.has(x.id)).map((x) => x.title),
          })
          const runLane = async (steps, laneNo) => {
          const member = team[laneNo]
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i]
            if (doneIds.has(step.id) && (step.files || []).every((f) => currentFiles[f])) {
              setPlanningStepStatuses((s) => ({ ...s, [step.id]: 'done' }))
              setPlanningStepLogs((s) => ({ ...s, [step.id]: '✓ Already done earlier, skipped' }))
              continue
            }
            if (!teamOn) setPlanningCurrentStep(i)
            setPlanningStepStatuses((s) => ({ ...s, [step.id]: 'running' }))
            setPlanningStepLogs((s) => ({ ...s, [step.id]: `Running: ${step.title}…` }))

            try {
              const stepStartTime = Date.now()
              const slowTimer = setTimeout(() => {
                setPlanningStepLogs((s) => ({
                  ...s,
                  [step.id]: `Still working — this step is complex, retrying if needed…`,
                }))
              }, 8000)

              let result
              try {
                result = await executeStep(
                  {
                    step,
                    plan: pendingPlanning.plan,
                    allSteps: steps,
                    files: currentFiles,
                    activeFile,
                    model: teamOn ? (LANE_MODELS[laneNo] || settings.model) : settings.model,
                    team: teamOn,
                    teamSize: team.length || 3,
                    lane: laneNo + 1,
                    persona: member?.persona || '',
                    workerName: member?.name,
                    contract: pendingPlanning.plan?.contract,
                    thinking: settings.thinking || 'medium',
                    originalPrompt: pendingPlanning.originalPrompt,
                    behavior: settings.behavior || 'friendly',
                  },
                  (_chunk, full) => {
                    clearTimeout(slowTimer)
                    setPlanningStepLogs((s) => ({
                      ...s,
                      [step.id]: `Writing… (${full.length} chars)`,
                    }))
                  }
                )
              } finally {
                clearTimeout(slowTimer)
              }

              // Apply the step's operations
              const ops = Array.isArray(result.operations) ? result.operations : []
              const before = Object.fromEntries(
                ops.map((op) => [op.path, currentFiles[op.path]?.content ?? null])
              )
              pushHistory(`Plan step ${step.id}: ${step.title}`, before, 'ai')

              for (const op of ops) {
                if (op.type === 'create_file' || op.type === 'write_file') {
                  currentFiles[op.path] = {
                    content: op.content ?? '',
                    language: getLanguageFromPath(op.path),
                  }
                } else if (op.type === 'delete_file') {
                  delete currentFiles[op.path]
                } else if (op.type === 'edit_file') {
          currentFiles[op.path] = {
            content: resolveOp(currentFiles, op).after,
            language: getLanguageFromPath(op.path),
          }
        }
              }

              allAppliedOps.push(...ops)
              setFiles({ ...currentFiles })

              // Open the first file the step touched
              if (ops[0]?.path) {
                const firstPath = ops[0].path
                setOpenTabs((tabs) => tabs.includes(firstPath) ? tabs : [...tabs, firstPath])
                setActiveFile(firstPath)
              }

              doneIds.add(step.id)
              ops.forEach((o) => doneFiles.add(o.path))
              writeCkpt()
              setPlanningStepStatuses((s) => ({ ...s, [step.id]: 'done' }))
              setPlanningStepLogs((s) => ({
                ...s,
                [step.id]: `✓ ${result.explanation || 'Done'}`,
              }))
            } catch (err) {
              console.error(`Step ${step.id} failed:`, err)

              // Try auto-split: if this step has multiple files, split into two
              const stepFiles = Array.isArray(step.files) ? step.files : []
              const canSplit = stepFiles.length >= 2

              if (canSplit) {
                setPlanningStepLogs((s) => ({
                  ...s,
                  [step.id]: `✕ Failed — splitting into smaller steps…`,
                }))

                const mid = Math.ceil(stepFiles.length / 2)
                const parts = [
                  {
                    id: `${step.id}.1`,
                    title: `${step.title} (part 1)`,
                    description: `Create: ${stepFiles.slice(0, mid).join(', ')}`,
                    files: stepFiles.slice(0, mid),
                    _substep: true,
                  },
                  {
                    id: `${step.id}.2`,
                    title: `${step.title} (part 2)`,
                    description: `Create: ${stepFiles.slice(mid).join(', ')}`,
                    files: stepFiles.slice(mid),
                    _substep: true,
                  },
                ]

                // Insert substeps into the loop by mutating the steps array
                steps.splice(i + 1, 0, ...parts)
                setPlanningStepStatuses((s) => ({ ...s, [step.id]: 'error' }))
                setPlanningStepLogs((s) => ({
                  ...s,
                  [step.id]: `✕ Split into 2 smaller steps`,
                }))
                continue
              }

              setPlanningStepStatuses((s) => ({ ...s, [step.id]: 'error' }))
              setPlanningStepLogs((s) => ({ ...s, [step.id]: `✕ ${err.message}` }))
              setPlanningError(`Step ${step.id} failed: ${err.message}`)
              break
            }
          }
          }
          await Promise.all(lanes.map((l, n) => (l.length ? runLane(l, n) : null)))

          setPlanningRunning(false)
          setPlanningCurrentStep(-1)
          const failed = steps.some((x) => !doneIds.has(x.id) && !x._substep)
          if (!failed) clearCheckpoint(activeSession.id)
          // the AI's own memory file: one line per finished job, no AI tokens needed
          if (allAppliedOps.length) {
            const day = new Date().toISOString().slice(0, 10)
            const made = [...new Set(allAppliedOps.map((o) => o.path))].filter((p) => p !== MEM_FILE)
            const line = `- ${day} ${failed ? '(unfinished) ' : ''}${String(pendingPlanning.originalPrompt || '').slice(0, 140)} → ${made.slice(0, 12).join(', ')}${made.length > 12 ? ` +${made.length - 12} more` : ''}\n`
            const prev = currentFiles[MEM_FILE]?.content || '# ION memory\n\nThe AI keeps this file up to date. It lists what was built so it does not need to read the whole chat again.\n\n'
            currentFiles[MEM_FILE] = { content: prev + line, language: 'markdown' }
            setFiles({ ...currentFiles })
          }
          reportChanges(allAppliedOps, currentFiles, pendingPlanning?.originalPrompt).catch(() => {})

          // Auto-close the modal after a short delay so user sees the final state
          const allDone = steps.every((s) => planningStepStatuses[s.id] !== 'error')
          setTimeout(() => {
            if (allDone) {
              showToast('Plan complete ✅', 'ok')
            } else {
              showToast('Plan finished with errors ⚠️', 'warn')
            }
            // Close the modal regardless
            setPendingPlanning(null)
            setPlanningStepStatuses({})
            setPlanningStepLogs({})
            setPlanningError(null)
          }, 1200)
        }}
      />



      {!isMobile && <BottomPanel
        open={bottomOpen}
        onClose={() => setBottomOpen(false)}
        consoleMessages={consoleMessages}
        files={files}
        onFilesChange={(newFiles) => {
          pushHistory('Terminal command', Object.fromEntries(
            Object.keys(files).map((k) => [k, files[k]?.content ?? null])
          ), 'manual')
          setFiles(newFiles)
        }}
      />}

      {!isMobile && <div className="statusbar">
        <div className="status-item">
          <span className={`status-accent ${busy ? 'pulse' : ''}`}>●</span> {status}
        </div>

        <div className="status-item">{activeFile || 'No file'}</div>
        <div className="status-item">
          <LanguageSelect value={activeLanguage} onChange={changeLanguage} />
        </div>
        <div className="status-item">
          {dirty.has(activeFile) ? 'Unsaved' : 'Saved'}
        </div>
        {history.length > 0 && (
          <div className="status-item">History: {history.length}</div>
        )}
        <div className="status-spacer" />
        {canPickFolder() && (
          <button className="status-btn" onClick={diskChoose} title="Folder on this computer where Ctrl+S saves this project">
            <Icon name="folder" size={13} /> {diskFolder ? diskFolder.name : 'Choose save folder'}
          </button>
        )}
        <button
          className="status-btn"
          onClick={handleGitHubPush}
          title="Push project to GitHub"
        >
          <Icon name="push" size={13} /> Push
        </button>
        <button
          className="status-btn"
          onClick={handleGitHubPull}
          title="Import from GitHub"
        >
          <Icon name="pull" size={13} /> Import
        </button>
        <button
          className="status-btn"
          onClick={() => setShowActions(true)}
          title="GitHub Actions"
        >
          <Icon name="play" size={13} /> Actions
        </button>
      </div>}

      {pendingDiff && (
        <DiffModal
          original={pendingDiff.original}
          next={pendingDiff.next}
          label={pendingDiff.label}
          onAccept={acceptDiff}
          onReject={rejectDiff}
        />
      )}

      {pendingPlan && (
        <AgentModal
          plan={pendingPlan.plan}
          files={files}
          originalPrompt={pendingPlan.originalPrompt}
          onAccept={applyPlan}
          onReject={() => { if (pendingPlan?.linkActionId) markAction(pendingPlan.linkActionId, 'rejected').catch(() => {}); setPendingPlan(null) }}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
          onUpgrade={handleUpgrade}
          onOpenRules={openRulesFile}
          hasRules={!!rulesPath}
          isMobile={isMobile}
          onManage={handleManageBilling}
          onPush={() => { setShowSettings(false); handleGitHubPush() }}
          onPull={() => { setShowSettings(false); handleGitHubPull() }}
          onLink={() => { setShowSettings(false); setShowLink(true) }}
          testAfterApply={testAfterApply}
          onTestToggle={setTestAfterApply}
          disk={{ folder: diskFolder, canPick: canPickFolder(), choose: diskChoose, saveAll: diskSaveAll }}
        />
      )}

      {aiActions.length > 0 && !pendingPlan && !pendingPlanning && (
        <ActionCard actions={aiActions} onApprove={runAiAction} onDismiss={(a) => setAiActions((l) => l.filter((x) => x !== a))} />
      )}

      {linkActions.length > 0 && !pendingPlan && !pendingPlanning && aiActions.length === 0 && (
        <ActionCard actions={linkActions} onApprove={(a) => decideLinkAction(a, true)} onDismiss={(a) => decideLinkAction(a, false)} />
      )}

      {showLink && (
        <LinkPanel
          sessionId={activeSession.id}
          sessionTitle={activeSession.title}
          onClose={() => setShowLink(false)}
          onChanged={() => countLinks().then((n) => setHasLinks(n > 0)).catch(() => {})}
        />
      )}

      {showImport && (
        <ImportModal
          currentFileCount={Object.keys(files).length}
          onImport={handleImportZip}
          onCancel={() => setShowImport(false)}
        />
      )}

      {inputModal && (
        <InputModal
          title={
            inputModal.type === 'new-file'
              ? `New File${inputModal.parent ? ` in ${inputModal.parent}` : ''}`
              : `New Folder${inputModal.parent ? ` in ${inputModal.parent}` : ''}`
          }
          placeholder={inputModal.type === 'new-file' ? 'myfile.js' : 'myfolder'}
          onSubmit={handleInputSubmit}
          onCancel={() => setInputModal(null)}
        />
      )}

      {paletteMode && (
        <CommandPalette
          mode={paletteMode}
          files={files}
          activeFile={activeFile}
          commands={commands}
          onSelectFile={openFile}
          onRunCommand={runCommand}
          onClose={() => setPaletteMode(null)}
        />
      )}

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.msg}</div>}

      {showLogin && (
        <LoginModal onClose={() => setShowLogin(false)} />
      )}

      <DesktopUpdater />

      {showActions && <ActionsModal onClose={() => setShowActions(false)} />}

      {githubModal && (
        <GitHubModal
          mode={githubModal}
          files={files}
          sessionTitle={activeSession.title}
          hint={ghHint}
          onClose={() => { setGithubModal(null); setGhHint(null) }}
          onPulled={handlePulledRepo}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}