// What the AI knows about the editor itself, the user's accounts, and what just happened.
// Kept in a small module so every request can read it without passing props around.
const state = { terminal: [], console: [], github: null, aiName: '', userName: '', memory: '', progress: '', workspace: '' }
export const setCtx = (key, value) => { state[key] = value }
// a different project/session starts: forget its terminal output, console errors and unfinished-work notes
export const clearTerminalCtx = () => { state.terminal = [] }
export const resetSessionCtx = () => { state.terminal = []; state.console = []; state.progress = '' }

const GUIDE = `You are the AI inside ION Qoders, a code editor that runs in the browser and as a desktop app. You know how it works:
- Left: file explorer (new file/folder, rename, delete, drag). Top tabs for open files. Center: Monaco code editor (Ctrl+S saves; on desktop it saves to the user's laptop folder).
- Right: this AI chat. Chat mode = talk and plan. Agent mode = you create and edit files; the user reviews changes and accepts them. Planning mode shows a step list first. Team mode / Auto agents = several AIs write different files at the same time (Settings > AI).
- Preview: Inline (runs inside the editor) or Live URL (served by the server, supports React/JSX imports). The "Select" button lets the user click an element in the inline preview and say what to change.
- Bottom panel: Terminal (in the desktop app it is the user's real PowerShell/shell on their computer; on the web it is a virtual shell on the project files) and Console (errors and logs from the preview).
- Menus: GitHub (push, pull, import, Actions), History (undo AI changes), Sessions (separate projects), Settings (plan, AI options, project rules in ION.md, models, API key for own models, theme, updates).
- Money savers you may suggest when relevant: turn off Team mode on small tasks, use Chat mode for questions, choose a lighter thinking level, keep files small, ask for one feature at a time.
- When the user is stuck, tell them exactly where to click. Never claim you clicked or ran something unless an action was approved.`

const tail = (arr, n, max) => arr.slice(-n).join('\n').slice(-max)

export function buildAppContext() {
  const parts = [GUIDE]
  const who = []
  if (state.userName) who.push(`The user is called ${state.userName}.`)
  if (state.aiName) who.push(`The user named you "${state.aiName}". Answer to that name.`)
  if (state.github) who.push(state.github.connected ? `GitHub is connected as ${state.github.login || 'an account'}.` : 'GitHub is NOT connected yet (Settings > GitHub, then paste a token).')
  if (who.length) parts.push('## ACCOUNTS\n' + who.join('\n'))
  if (state.workspace) parts.push(state.workspace)
  const term = tail(state.terminal, 40, 3500)
  const cons = tail(state.console, 25, 1800)
  if (term || cons) {
    parts.push('## RECENT LOGS (check these first when something fails; if they show the cause, fix that before reading code)')
    if (term) parts.push('Terminal:\n' + term)
    if (cons) parts.push('Preview console:\n' + cons)
  }
  return parts.join('\n\n').slice(0, 9000)
}

// Cheap parts only: used by prompts where the long guide would waste tokens
export function buildMemoryContext() {
  const parts = []
  if (state.memory) parts.push('## PROJECT MEMORY (what was already built; trust it, do not redo it)\n' + state.memory.slice(-3000))
  if (state.progress) parts.push('## UNFINISHED WORK (continue from here, never recreate files that already exist)\n' + state.progress)
  return parts.join('\n\n')
}

// ---- progress checkpoint, saved per session so "continue" resumes instead of restarting ----
const key = (id) => `qoders-ckpt-${id}`
export function saveCheckpoint(id, data) { try { localStorage.setItem(key(id), JSON.stringify({ ...data, at: Date.now() })) } catch {} }
export function loadCheckpoint(id) { try { const c = JSON.parse(localStorage.getItem(key(id))); return c && Date.now() - c.at < 7 * 864e5 ? c : null } catch { return null } }
export function clearCheckpoint(id) { try { localStorage.removeItem(key(id)) } catch {} }
