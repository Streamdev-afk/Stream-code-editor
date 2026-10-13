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
import { streamEdit } from './lib/ai'
import './App.css'
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
import ModelSwitcher from './components/ModelSwitcher'
import { syncPreview, getPreviewUrl, getSessionId } from './lib/previewSession'
import { updatePreviewSession, fetchPreviewErrors, clearPreviewErrors, diagnose, executeStep } from './lib/ai'
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
import ThinkingSwitcher from './components/ThinkingSwitcher'

function AppInner() {
  const { user, loading: authLoading } = useAuth()

  // ---- Sessions store (the source of truth) ----
  const [sessionStore, setSessionStore] = useState(() => loadSessions())

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
    const nextFiles = typeof updater === 'function' ? updater(files) : updater
    setSessionStore((s) => updateSession(s, s.activeSessionId, { files: nextFiles }))
  }
  const setOpenTabs = (updater) => {
    const next = typeof updater === 'function' ? updater(openTabs) : updater
    setSessionStore((s) => updateSession(s, s.activeSessionId, { openTabs: next }))
  }
  const setActiveFile = (next) => {
    setSessionStore((s) => updateSession(s, s.activeSessionId, { activeFile: next }))
  }
  const setHistory = (updater) => {
    const next = typeof updater === 'function' ? updater(history) : updater
    setSessionStore((s) => updateSession(s, s.activeSessionId, { history: next }))
  }
  const setMessages = (updater) => {
    const next = typeof updater === 'function' ? updater(messages) : updater
    setSessionStore((s) => updateSession(s, s.activeSessionId, { messages: next }))
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
const [showImport, setShowImport] = useState(false)
const [previewSession, setPreviewSession] = useState(null)
const [testAfterApply, setTestAfterApply] = useState(false)
const [testProgress, setTestProgress] = useState(null) // null | { step, message } | { done: true }
const isMobile = useMobile(768)
const [showLogin, setShowLogin] = useState(false)
  // ---- Cloud sync: on sign-in, load remote sessions (merge guest once) ----
  useEffect(() => {
    if (!user) {
      setSyncReady(false)
      return
    }
    if (!isSyncAvailable()) {
      setSyncReady(true)
      return
    }

    let cancelled = false

    ;(async () => {
      setSyncing(true)
      try {
        const remote = await loadRemoteSessions()

        if (cancelled) return

        // If user has never merged their guest sessions, do it now
        const shouldMerge = !hasMergedGuestSessions()

        if (shouldMerge) {
          const localSessions = sessionStore.sessions
          // Upload local sessions not already present in remote
          const remoteIds = new Set(remote.map((s) => s.id))
          const toUpload = localSessions.filter((s) => !remoteIds.has(s.id))

          if (toUpload.length > 0) {
            await uploadSessionBatch(toUpload, user.id)
          }
          markGuestSessionsMerged()

          // After upload, reload remote to get everything
          const merged = await loadRemoteSessions()
          if (!cancelled) {
            setSessionStore({
              sessions: merged.length > 0 ? merged : sessionStore.sessions,
              activeSessionId: merged[0]?.id || sessionStore.activeSessionId,
            })
          }
        } else if (remote.length > 0) {
          // Just switch to remote set
          setSessionStore((s) => ({
            sessions: remote,
            activeSessionId: remote.find((r) => r.id === s.activeSessionId)?.id || remote[0].id,
          }))
        }

        setSyncReady(true)
      } catch (err) {
        console.warn('Cloud sync load failed:', err)
        setSyncReady(true) // fall back to local only
      } finally {
        if (!cancelled) setSyncing(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user])

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [pendingDiff, setPendingDiff] = useState(null)
  const [pendingPlan, setPendingPlan] = useState(null)
  const [toast, setToast] = useState(null)
  const [inputModal, setInputModal] = useState(null)

  // Phase 4 state
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
}, [settings])

  // ---------- File ops ----------
  const openFile = (path) => {
    if (!files[path]) return
    if (!openTabs.includes(path)) setOpenTabs((t) => [...t, path])
    setActiveFile(path)
    setViewMode('code')
  }

  const closeTab = (path) => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((t) => t !== path)
      if (path === activeFile) setActiveFile(next[next.length - 1] || '')
      return next
    })
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
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveActive()
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

 const applyPlan = (chosenOps, explanation, originalPrompt) => {
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
    { id: 'find',           label: '🔍 Find in File',         hint: 'Ctrl+F',       action: 'find' },
    { id: 'replace',        label: '🔁 Replace in File',      hint: 'Ctrl+H',       action: 'replace' },
    { id: 'search-all',     label: '🔎 Search All Files',     hint: 'Ctrl+Shift+F', action: 'searchAll' },
    { id: 'new-file',       label: '📄 New File',             hint: '',             action: 'newFile' },
    { id: 'new-folder',     label: '📁 New Folder',           hint: '',             action: 'newFolder' },
    { id: 'toggle-code',    label: '📝 Show Code',            hint: '',             action: 'viewCode' },
    { id: 'toggle-prev',    label: '▶  Show Preview',         hint: '',             action: 'viewPreview' },
    { id: 'ai-complete',    label: '✨ AI: Complete',         hint: '',             action: 'aiComplete' },
    { id: 'ai-fix',         label: '🔧 AI: Fix Bugs',         hint: '',             action: 'aiFix' },
    { id: 'ai-refactor',    label: '♻️ AI: Refactor',          hint: '',             action: 'aiRefactor' },
    { id: 'ai-comment',     label: '💬 AI: Comment',          hint: '',             action: 'aiComment' },
    { id: 'revert',         label: '↺ Revert Last AI Change', hint: '',             action: 'revert' },
    { id: 'toggle-sidebar', label: '☰ Toggle Sidebar',        hint: 'Ctrl+B',       action: 'toggleSidebar' },
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

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">
          <div className="logo-dot" />
          STREAM
        </div>
        <div className="topbar-spacer" />

        {/* View toggle */}
        <div className="view-toggle">
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
            ▶ Preview
          </button>
        </div>

<AIDropdown
  disabled={busy || !activeFile || viewMode !== 'code'}
  onAction={(action, label) => runEdit({ action, label })}
/>

<ModelSwitcher
  value={settings.model}
  onChange={(m) => setSettings((s) => ({ ...s, model: m }))}
  disabled={busy}
/>

<ThinkingSwitcher
  value={settings.thinking || 'medium'}
  onChange={(t) => setSettings((s) => ({ ...s, thinking: t }))}
  disabled={busy}
/>

        <button
          className="topbar-btn"
          disabled={!activeFile}
          onClick={saveActive}
          title="Ctrl+S"
        >💾 Save</button>

          <button
  className="topbar-btn"
  onClick={handleExportZip}
  title="Download project as .zip"
>📦</button>

<button
  className="topbar-btn"
  onClick={() => setShowImport(true)}
  title="Import project from .zip"
>📥</button>

        <button
          className="topbar-btn"
          disabled={history.length === 0}
          onClick={revertLast}
          title="Revert last AI change"
        >↺ Revert</button>

        <button
  className={`topbar-btn icon ${showSidebar ? 'active' : ''}`}
  onClick={() => setShowSidebar((s) => !s)}
  title="Toggle sidebar (Ctrl+B)"
>
  ☰
</button>

<button
  className={`topbar-btn icon ${showAI ? 'active' : ''}`}
  onClick={() => setShowAI((s) => !s)}
  title="Toggle AI panel (Ctrl+I)"
>
  🤖
</button>

<button
  className={`topbar-btn icon ${bottomOpen ? 'active' : ''}`}
  onClick={() => setBottomOpen(!bottomOpen)}
  title="Toggle bottom panel (Ctrl+J)"
>

  ▤
</button>

<button
  className="topbar-btn icon"
  onClick={() => setShowSettings(true)}
  title="Settings"
>⚙</button>

<UsageDropdown />

{syncing && (
  <span className="sync-indicator" title="Syncing to cloud...">
    ⟳
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

      
{isMobile ? (
  <div className="mobile-main">
    {mobileView === 'files' && (
      <div className="mobile-panel">
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
      </div>
    )}
    {mobileView === 'editor' && (
      <div className="mobile-panel">
        {viewMode === 'code' ? (
          <>
            <Tabs
              openTabs={openTabs}
              activeFile={activeFile}
              dirty={dirty}
              onTabClick={setActiveFile}
              onTabClose={closeTab}
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
          />
        )}
      </div>
    )}
    {mobileView === 'ai' && (
      <div className="mobile-panel">
        <AIChat
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
          onPlanReady={(plan, prompt) => setPendingPlanning({ plan, originalPrompt: prompt })}
          model={settings.model}
          thinking={settings.thinking || 'medium'}
          testAfterApply={testAfterApply}
          onTestToggle={setTestAfterApply}
          planningMode={true}
        />
      </div>
    )}
  </div>
) : (
  <div className="main">
    {showSidebar && (
      <div className="sidebar-wrap">
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${sidebarTab === 'explorer' ? 'active' : ''}`}
            onClick={() => setSidebarTab('explorer')}
            title="Explorer (files)"
          >📁</button>
          <button
            className={`sidebar-tab ${sidebarTab === 'search' ? 'active' : ''}`}
            onClick={() => setSidebarTab('search')}
            title="Search across files (Ctrl+Shift+F)"
          >🔍</button>
          <button
            className={`sidebar-tab ${sidebarTab === 'history' ? 'active' : ''}`}
            onClick={() => setSidebarTab('history')}
            title="Version history"
          >🕐</button>
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
      {viewMode === 'code' ? (
        <>
          <Tabs
            openTabs={openTabs}
            activeFile={activeFile}
            dirty={dirty}
            onTabClick={setActiveFile}
            onTabClose={closeTab}
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
        />
      )}
    </div>
    {showAI && (
      <AIChat
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
        onPlanReady={(plan, prompt) => setPendingPlanning({ plan, originalPrompt: prompt })}
        model={settings.model}
        thinking={settings.thinking || 'medium'}
        testAfterApply={testAfterApply}
        onTestToggle={setTestAfterApply}
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

          for (let i = 0; i < steps.length; i++) {
            const step = steps[i]
            setPlanningCurrentStep(i)
            setPlanningStepStatuses((s) => ({ ...s, [step.id]: 'running' }))
            setPlanningStepLogs((s) => ({ ...s, [step.id]: `Running: ${step.title}…` }))

            try {
              const result = await executeStep(
                {
                  step,
                  plan: pendingPlanning.plan,
                  allSteps: steps,
                  files: currentFiles,
                  activeFile,
                  model: settings.model,
                  thinking: settings.thinking || 'medium',
                  originalPrompt: pendingPlanning.originalPrompt,
                },
                (_chunk, full) => {
                  setPlanningStepLogs((s) => ({
                    ...s,
                    [step.id]: `Writing… (${full.length} chars)`,
                  }))
                }
              )

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
                }
              }

              setFiles({ ...currentFiles })

              // Open the first file the step touched
              if (ops[0]?.path) {
                const firstPath = ops[0].path
                setOpenTabs((tabs) => tabs.includes(firstPath) ? tabs : [...tabs, firstPath])
                setActiveFile(firstPath)
              }

              setPlanningStepStatuses((s) => ({ ...s, [step.id]: 'done' }))
              setPlanningStepLogs((s) => ({
                ...s,
                [step.id]: `✓ ${result.explanation || 'Done'}`,
              }))
            } catch (err) {
              console.error(`Step ${step.id} failed:`, err)
              setPlanningStepStatuses((s) => ({ ...s, [step.id]: 'error' }))
              setPlanningStepLogs((s) => ({ ...s, [step.id]: `✕ ${err.message}` }))
              setPlanningError(`Step ${step.id} failed: ${err.message}`)
              break
            }
          }

          setPlanningRunning(false)
          setPlanningCurrentStep(-1)

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



      <BottomPanel
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
      />

      {isMobile && (
        <div className="mobile-tabs">
          <button
            className={`mobile-tab ${mobileView === 'files' ? 'active' : ''}`}
            onClick={() => setMobileView('files')}
          >
            <span className="mobile-tab-icon">📁</span>
            <span className="mobile-tab-label">Files</span>
          </button>
          <button
            className={`mobile-tab ${mobileView === 'editor' ? 'active' : ''}`}
            onClick={() => setMobileView('editor')}
          >
            <span className="mobile-tab-icon">📝</span>
            <span className="mobile-tab-label">Code</span>
          </button>
          <button
            className={`mobile-tab ${mobileView === 'ai' ? 'active' : ''}`}
            onClick={() => setMobileView('ai')}
          >
            <span className="mobile-tab-icon">🤖</span>
            <span className="mobile-tab-label">AI</span>
          </button>
        </div>
      )}

      <div className="statusbar">
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
      </div>

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
          onReject={() => setPendingPlan(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
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