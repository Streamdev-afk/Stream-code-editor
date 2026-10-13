/**
 * Sessions store — every session is a project (files + chat + history).
 * Currently backed by localStorage.
 * Part 2 will add Supabase sync for signed-in users.
 */

const STORAGE_KEY = 'stream-sessions-v1'
const MERGED_FLAG_KEY = 'stream-sessions-merged-v1'

export function hasMergedGuestSessions() {
  return localStorage.getItem(MERGED_FLAG_KEY) === 'true'
}

export function markGuestSessionsMerged() {
  localStorage.setItem(MERGED_FLAG_KEY, 'true')
}

export function resetMergedFlag() {
  localStorage.removeItem(MERGED_FLAG_KEY)
}

// ---------- ID generation ----------
function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

// ---------- Title generation ----------
export function generateTitle(text) {
  if (!text) return 'New session'
  const cleaned = text.trim().replace(/\s+/g, ' ')
  const firstLine = cleaned.split(/[.!?\n]/)[0].trim()
  if (firstLine.length <= 40) return firstLine
  return firstLine.slice(0, 40).trim() + '…'
}

// ---------- Default session ----------
export const DEFAULT_FILES = {
  'src/App.jsx': {
    content: `import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <div>
      <h1>Hello</h1>
      <button onClick={() => setCount(count + 1)}>
        Clicked {count} times
      </button>
    </div>
  )
}
`,
    language: 'javascript',
  },
  'src/main.jsx': {
    content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
`,
    language: 'javascript',
  },
  'src/styles.css': {
    content: `body {
  font-family: sans-serif;
  margin: 0;
  padding: 20px;
}
`,
    language: 'css',
  },
  'public/index.html': {
    content: `<!DOCTYPE html>
<html>
  <head><title>App</title></head>
  <body>
    <div id="root">STREAM</div>
  </body>
</html>
`,
    language: 'html',
  },
  'README.md': {
    content: `# My Project

Built with STREAM editor.
`,
    language: 'markdown',
  },
}

export function createEmptySession(title = 'New session') {
  const now = Date.now()
  return {
    id: makeId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        role: 'assistant',
        text: "Hey! I'm Stream. Ask me anything, or switch to Agent mode to make changes to your files.",
        time: now,
      },
    ],
    files: {},           // ← truly empty
    openTabs: [],
    activeFile: '',
    history: [],
  }
}

// ---------- Load / save ----------
export function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // First launch — create a default session
      const session = createEmptySession()
      const store = { sessions: [session], activeSessionId: session.id }
      saveSessions(store)
      return store
    }
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.sessions) || parsed.sessions.length === 0) {
      const session = createEmptySession()
      return { sessions: [session], activeSessionId: session.id }
    }
    // Ensure activeSessionId points at a real session
    const hasActive = parsed.sessions.some((s) => s.id === parsed.activeSessionId)
    if (!hasActive) parsed.activeSessionId = parsed.sessions[0].id
    return parsed
  } catch (err) {
    console.warn('loadSessions failed:', err)
    const session = createEmptySession()
    return { sessions: [session], activeSessionId: session.id }
  }
}

export function saveSessions(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch (err) {
    console.warn('saveSessions failed:', err)
  }
}

// ---------- Session helpers (pure, return new arrays) ----------

export function addSession(store, title = 'New session') {
  const session = createEmptySession(title)
  return {
    sessions: [...store.sessions, session],
    activeSessionId: session.id,
  }
}

export function deleteSession(store, id) {
  const next = store.sessions.filter((s) => s.id !== id)
  if (next.length === 0) {
    // Always keep at least one session
    const fresh = createEmptySession()
    return { sessions: [fresh], activeSessionId: fresh.id }
  }
  return {
    sessions: next,
    activeSessionId: store.activeSessionId === id ? next[0].id : store.activeSessionId,
  }
}

export function renameSession(store, id, title) {
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.id === id ? { ...s, title, updatedAt: Date.now() } : s
    ),
  }
}

export function updateSession(store, id, patch) {
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s
    ),
  }
}

export function setActiveSession(store, id) {
  return { ...store, activeSessionId: id }
}

export function getActiveSession(store) {
  return store.sessions.find((s) => s.id === store.activeSessionId) || store.sessions[0]
}