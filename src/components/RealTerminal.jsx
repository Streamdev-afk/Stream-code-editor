import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { setCtx } from '../lib/appContext'
import { linkedFolder, chooseFolder, saveAllToDisk, projectFolderPath, layoutFor, noteLayout } from '../lib/diskSave'
import { getLanguageFromPath } from '../lib/fs'

const strip = (t) => String(t).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '').replace(/\r/g, '')
const QUIET = /^(tar|unzip|7z|expand-archive|download|dl|adb|curl|wget|pip3?|git\s+(clone|pull|fetch)|npm\s+(i|install|ci|update)|yarn(\s+install)?|pnpm\s+(i|install))\b/i

const cssVar = (name, fallback) => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback } catch { return fallback }
}

// A real terminal: your own shell (PowerShell on Windows, your login shell on Mac and Linux), running on your computer.
export default function RealTerminal({ files, onFilesChange, projectId, slot = 0 }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const filesRef = useRef(files)
  const pending = useRef(null) // an AI command being watched: { token, cmd, test, out, started, carry, timer }
  const shellRef = useRef('')
  const logRef = useRef([])
  const openedRef = useRef(false)
  const [needFolder, setNeedFolder] = useState(false)
  const [menu, setMenu] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const id = slot ? `pty-${projectId}-${slot}` : `pty-${projectId}`
  useEffect(() => { filesRef.current = files }, [files])

  const importFromFolder = async (since, limitedToChanged) => {
    const dir = await projectFolderPath(projectId)
    if (!dir) return 0
    const prefix = layoutFor(projectId).importPrefix
    const scan = limitedToChanged ? await window.desktop.termScan(dir, since) : await window.desktop.diskRead(dir)
    if (scan.tooMany && limitedToChanged) return -1
    const changed = Object.fromEntries(Object.entries(scan.files || {}).map(([k, v]) => [prefix + k, v]))
    const paths = Object.keys(changed).filter((p) => filesRef.current[p]?.content !== changed[p])
    if (!paths.length) return 0
    const next = { ...filesRef.current }
    for (const p of paths) next[p] = { content: changed[p], language: getLanguageFromPath(p) }
    onFilesChange?.(next)
    return paths.length
  }

  const finishAi = async (code, running) => {
    const p = pending.current
    if (!p) return
    pending.current = null
    clearTimeout(p.timer)
    const term = termRef.current
    let note = ''
    try {
      if (!running && code === 0 && !QUIET.test(p.cmd.trim())) {
        const n = await importFromFolder(p.started, true)
        if (n > 0) note = `${n} file${n === 1 ? '' : 's'} updated in the editor`
        if (n === -1) note = 'Many files changed in the folder, so none were added to the editor'
      }
    } catch { /* the command result is still reported */ }
    if (note && term) term.write(`\r\n\x1b[2m${note}\x1b[0m\r\n`)
    window.dispatchEvent(new CustomEvent('qoders-run-done', { detail: { cmd: p.cmd, code, running: !!running, test: !!p.test, output: p.out.slice(-2500) } }))
  }

  // everything the shell prints goes through here
  const feed = (data) => {
    const term = termRef.current
    if (!term) return
    const clean = strip(data)
    if (clean.trim()) {
      logRef.current = [...logRef.current, ...clean.split('\n').filter(Boolean)].slice(-60)
      setCtx('terminal', logRef.current)
      const m = clean.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})[^\s)]*/)
      if (m && Number(m[1]) !== 47831) {
        const url = `http://localhost:${m[1]}/`
        if (window.__qodersLocalUrl !== url) { window.__qodersLocalUrl = url; window.dispatchEvent(new CustomEvent('qoders-local-url', { detail: { url } })) }
      }
    }
    const p = pending.current
    if (!p) { term.write(data); return }
    p.out += clean
    const buf = p.carry + data
    p.carry = ''
    const m = buf.match(new RegExp(`ION_DONE_${p.token}_(-?\\d+)`))
    if (m) {
      term.write(buf.slice(0, m.index) + buf.slice(m.index + m[0].length))
      finishAi(Number(m[1]), false)
      return
    }
    // hold back the end of a chunk that may be the first half of the finishing marker
    const cut = buf.lastIndexOf('ION_DONE')
    if (cut !== -1 && /^ION_DONE_\w*-?\d*$/.test(buf.slice(cut))) { term.write(buf.slice(0, cut)); p.carry = buf.slice(cut) } else term.write(buf)
  }

  // switching to another project stops the old project's shell and its dev server, and forgets its preview address
  const lastProj = useRef(projectId)
  useEffect(() => {
    const prev = lastProj.current
    lastProj.current = projectId
    if (prev && prev !== projectId && window.desktop?.ptyKill) {
      const old = slot ? `pty-${prev}-${slot}` : `pty-${prev}`
      try { window.desktop.ptyWrite(old, '\x03') } catch { /* ignore */ }
      setTimeout(() => { try { window.desktop.ptyKill(old) } catch { /* ignore */ } }, 400)
      if (!slot) { window.__qodersLocalUrl = ''; window.dispatchEvent(new CustomEvent('qoders-local-url-clear')) }
    }
  }, [projectId])

  // start the shell and show it
  useEffect(() => {
    let disposed = false
    let offData = () => {}
    let offExit = () => {}
    let ro = null
    const dark = cssVar('--bg-app', '#0b0f0d')
    const term = new XTerm({
      fontFamily: cssVar('--font-mono', 'Consolas, Menlo, monospace'),
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: { background: dark, foreground: cssVar('--text', '#e5e7eb'), cursor: cssVar('--accent', '#10b981'), selectionBackground: 'rgba(16,185,129,.35)' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    termRef.current = term
    fitRef.current = fit
    try { fit.fit() } catch {}

    // copy with Ctrl+C when text is selected; paste (Ctrl+V / right-click) is left to the terminal itself so it is never typed twice
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'c' && term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()).catch(() => {}); return false }
      return true
    })
    term.onData((d) => window.desktop.ptyWrite(id, d))
    term.onResize(({ cols, rows }) => window.desktop.ptyResize(id, cols, rows))

    ;(async () => {
      let folder = await linkedFolder(projectId)
      if (!folder) { if (!disposed) setNeedFolder(true); return }
      noteLayout(projectId, filesRef.current, window.__qodersTitle)
      await saveAllToDisk(projectId, filesRef.current).catch(() => {}) // the project folder gets the newest editor files
      const dir = (await projectFolderPath(projectId)) || folder.path
      window.__qodersProjectDir = dir
      window.dispatchEvent(new CustomEvent('qoders-workdir', { detail: dir }))
      const r = await window.desktop.ptyOpen(id, dir, term.cols, term.rows)
      if (disposed) return
      if (!r.ok) { setError(r.error || 'The terminal could not start.'); return }
      shellRef.current = r.shell || ''
      openedRef.current = true
      if (r.buffer) term.write(r.buffer)
      offData = window.desktop.onPtyData((d) => { if (d.id === id) feed(d.data) })
      offExit = window.desktop.onPtyExit((d) => {
        if (d.id !== id) return
        openedRef.current = false
        term.write(`\r\n\x1b[2m[the shell closed (code ${d.code}). Press any key to start a new one]\x1b[0m\r\n`)
        const once = term.onData(() => { once.dispose(); setTick((t) => t + 1) })
      })
      try { fit.fit(); window.desktop.ptyResize(id, term.cols, term.rows) } catch {}
      term.focus()
    })()

    // a hidden terminal measures 0x0: never resize to that (it squeezed the prompt to a few letters). Fit again when it is visible.
    const refit = () => {
      const h = hostRef.current
      if (!h || h.clientWidth < 80 || h.clientHeight < 40) return
      try { fit.fit() } catch {} // term.onResize tells the shell, only when the size really changed
    }
    ro = new ResizeObserver(refit)
    ro.observe(hostRef.current)
    window.addEventListener('qoders-relayout', refit)
    window.addEventListener('resize', refit)
    return () => {
      disposed = true
      offData(); offExit()
      ro?.disconnect()
      window.removeEventListener('qoders-relayout', refit); window.removeEventListener('resize', refit)
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tick])

  // the AI asked for a command and the user allowed it: it is typed into this same terminal
  useEffect(() => {
    const go = async (d) => {
      if (!d?.cmd || !termRef.current) return
      // wait for the shell to be ready (the terminal may have just opened)
      for (let i = 0; i < 40 && !openedRef.current; i++) await new Promise((r) => setTimeout(r, 150))
      if (!openedRef.current) { window.dispatchEvent(new CustomEvent('qoders-run-done', { detail: { cmd: d.cmd, code: 1, test: !!d.test, output: 'The terminal is not running.' } })); return }
      await saveAllToDisk(projectId, filesRef.current).catch(() => {})
      const token = Math.random().toString(36).slice(2, 8)
      const sh = shellRef.current.toLowerCase()
      const done = sh.includes('powershell')
        ? `; $ion=$?; Write-Host "ION_DONE_${token}_$(if($ion){0}else{1})"`
        : sh.includes('fish') ? `; echo "ION_DONE_${token}_$status"` : `; echo "ION_DONE_${token}_$?"`
      pending.current = { token, cmd: d.cmd, test: !!d.test, out: '', started: Date.now() - 1500, carry: '', timer: null }
      // a server that keeps running: look at what it printed so far after 20 seconds
      pending.current.timer = setTimeout(() => finishAi(null, true), 20000)
      termRef.current.focus()
      // Windows PowerShell 5 does not understand &&, so the steps are chained with ; (cd then the command still works)
      const cmdText = sh.includes('powershell') ? d.cmd.replace(/\s*&&\s*/g, '; ') : d.cmd
      window.desktop.ptyWrite(id, `${cmdText}${done}\r`)
    }
    if (slot) return // extra terminals are for you; the AI always uses terminal 1
    const pendingRun = window.__qodersPendingRun
    if (pendingRun) { window.__qodersPendingRun = null; go(pendingRun) }
    const h = (e) => go(e.detail)
    window.addEventListener('qoders-run', h)
    // the stop button: Ctrl+C in the shell
    const stopH = () => { try { window.desktop.ptyWrite(id, '\x03') } catch { /* ignore */ } }
    window.addEventListener('qoders-stop', stopH)
    return () => { window.removeEventListener('qoders-run', h); window.removeEventListener('qoders-stop', stopH) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const chooseAndStart = async () => {
    const f = await chooseFolder(projectId)
    if (f) { setNeedFolder(false); setTick((t) => t + 1) }
  }
  const syncFromFolder = async () => {
    setMenu(false)
    const dir = await projectFolderPath(projectId)
    if (!dir) return
    const n = await importFromFolder(0, false)
    termRef.current?.write(`\r\n\x1b[2m${n > 0 ? `${n} file${n === 1 ? '' : 's'} brought into the editor` : 'The editor already has everything in the folder'}\x1b[0m\r\n`)
  }

  return (
    <div className="real-term" onClick={() => { setMenu(false); termRef.current?.focus() }}>
      <div className="real-term-host" ref={hostRef} />
      <button className="real-term-dots" onClick={(e) => { e.stopPropagation(); setMenu((v) => !v) }} title="Terminal options" aria-label="Terminal options">⋯</button>
      {menu && (
        <div className="term-menu real-term-menu" onClick={(e) => e.stopPropagation()}>
          <button onClick={syncFromFolder}>Bring files from the folder into the editor</button>
          <button onClick={() => { termRef.current?.clear(); setMenu(false) }}>Clear screen</button>
          <button onClick={async () => { setMenu(false); await window.desktop.ptyKill(id); setTick((t) => t + 1) }}>Restart terminal</button>
        </div>
      )}
      {needFolder && (
        <div className="real-term-note">
          <p>Choose the folder on your computer where your projects live. The terminal opens inside this project's own folder there.</p>
          <button className="action-btn" onClick={chooseAndStart}>Choose folder</button>
        </div>
      )}
      {error && <div className="real-term-note"><p>{error}</p><button className="action-btn" onClick={() => { setError(''); setTick((t) => t + 1) }}>Try again</button></div>}
    </div>
  )
}
