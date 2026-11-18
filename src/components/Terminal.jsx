import { useState, useRef, useEffect } from 'react'
import { setCtx } from '../lib/appContext'
import { createShell, runCommand, autocomplete } from '../lib/shell'
import { isDesktopApp, linkedFolder, chooseFolder, saveAllToDisk, projectFolderPath, layoutFor, noteLayout } from '../lib/diskSave'
import { getLanguageFromPath } from '../lib/fs'

const stripAnsi = (t) => String(t).replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\r(?!\n)/g, '\n')

export default function Terminal({ files, onFilesChange, projectId }) {
  const desktop = isDesktopApp() && !!window.desktop?.termRun
  const [real, setReal] = useState(false) // real = commands run on this computer
  const [rcwd, setRcwd] = useState('') // the real folder the terminal is in ('' = the project folder)
  const [menuOpen, setMenuOpen] = useState(false)
  const [folderPath, setFolderPath] = useState('')
  useEffect(() => { if (desktop) projectFolderPath(projectId).then((p) => setFolderPath(p || '')) }, [projectId, real, files])
  const [busy, setBusy] = useState(null) // id of the running command
  const runId = useRef(0)
  const filesRef = useRef(files)
  useEffect(() => { filesRef.current = files }, [files])
  const [lines, setLines] = useState([
    { type: 'info', text: 'ION Qoders Shell v1.1 — type "help" for commands.' },
    { type: 'info', text: 'Virtual shell: runs against your project files, not your computer.' },
    { type: 'info', text: '' },
  ])
  const [input, setInput] = useState('')
  useEffect(() => { setCtx('terminal', lines.filter((l) => l.text).map((l) => (l.type === 'input' ? '$ ' : '') + l.text)) }, [lines])
  const [shell, setShell] = useState(() => createShell(files, '/'))
  const [history, setHistory] = useState([])
  const [histIndex, setHistIndex] = useState(-1)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  // Keep shell's files in sync when files change from outside
  useEffect(() => {
    setShell((s) => ({ ...s, files }))
  }, [files])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  const prompt = () => {
    return (
      <span className="term-prompt">
        <span className="term-user">qoders</span>
        <span className="term-sep">:</span>
        <span className="term-path">{real ? (rcwd || folderPath || 'no folder yet') : shell.cwd}</span>
        <span className="term-sigil">$</span>
      </span>
    )
  }

  // ---- real mode: npm, npx, python, git... run on this computer, in the project's folder ----
  const runReal = async (cmd, opts = {}) => {
    let folder = await linkedFolder(projectId)
    if (!folder) {
      setLines((l) => [...l, { type: 'info', text: 'Choose the folder where this project lives on your computer…' }])
      folder = await chooseFolder(projectId)
      if (!folder) { setLines((l) => [...l, { type: 'info', text: 'No folder chosen, so nothing ran.' }]); return }
    }
    noteLayout(projectId, filesRef.current, window.__qodersTitle)
    const projectDir = (await projectFolderPath(projectId)) || folder.path // the project's own folder inside the chosen one
    const here = rcwd || projectDir
    // cd works like a normal terminal: any folder on the computer, and a wrong path is an error
    const cd = cmd.match(/^cd(?:\s+(?:\/d\s+)?(.*))?$/i) || (/^[a-z]:$/i.test(cmd) ? [cmd, cmd] : null)
    if (cd) {
      const r = await window.desktop.termCd(here, cd[1] || '')
      if (r.ok) { setRcwd(r.cwd); if (opts.ai) window.dispatchEvent(new CustomEvent('qoders-run-done', { detail: { cmd, code: 0, test: !!opts.test, output: '' } })) }
      else {
        setLines((ls) => [...ls, { type: 'output', text: r.error }])
        if (opts.ai) window.dispatchEvent(new CustomEvent('qoders-run-done', { detail: { cmd, code: 1, test: !!opts.test, output: r.error } }))
      }
      return
    }
    const dl = cmd.match(/^(?:download|dl)\s+(\S+)(?:\s+(.+))?$/i)
    const id = `t${++runId.current}`
    const started = Date.now() - 1500
    let collected = ''
    let doneSent = false
    const sendDone = (code, running) => {
      if (doneSent || !opts.ai) return
      doneSent = true
      window.dispatchEvent(new CustomEvent('qoders-run-done', { detail: { cmd, code, running, test: !!opts.test, output: collected.slice(-2500) } }))
    }
    let watch = null
    setBusy(id)
    setLines((l) => [...l, { type: 'output', text: '', rid: id }])
    const off = window.desktop.onTermData(({ id: rid, chunk }) => {
      if (rid !== id) return
      collected += stripAnsi(chunk)
      const m = stripAnsi(chunk).match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})[^\s)]*/)
      if (m && Number(m[1]) !== 47831) {
        const url = `http://localhost:${m[1]}/`
        if (window.__qodersLocalUrl !== url) { window.__qodersLocalUrl = url; window.dispatchEvent(new CustomEvent('qoders-local-url', { detail: { url } })) }
      }
      setLines((ls) => ls.map((ln) => (ln.rid === id ? { ...ln, text: (ln.text + stripAnsi(chunk)).slice(-60000) } : ln)))
    })
    try {
      await saveAllToDisk(projectId, filesRef.current) // the project folder gets the newest editor files first
      if (opts.ai) watch = setTimeout(() => sendDone(null, true), 20000) // a server that keeps running: look at what it printed so far
      const r = dl
        ? await window.desktop.termDownload(id, projectDir, here, dl[1], dl[2] && dl[2].trim())
        : await window.desktop.termRun(id, projectDir, here, cmd)
      if (r.error) setLines((ls) => [...ls, { type: 'output', text: r.error }])
      else if (r.code !== 0) setLines((ls) => [...ls, { type: 'info', text: `exited with code ${r.code}` }])
      if (r.error) collected += r.error
      clearTimeout(watch)
      sendDone(r.error ? 1 : r.code, false)
      // files the command made or changed come back into the editor (not for installs, downloads and unpacking: those are not your project)
      const inProject = !rcwd || rcwd.startsWith(projectDir)
      const quiet = /^(tar|unzip|7z|expand-archive|download|dl|adb|curl|wget|pip3?|git\s+(clone|pull|fetch)|npm\s+(i|install|ci|update)|yarn(\s+install)?|pnpm\s+(i|install))\b/i.test(cmd)
      if (inProject && !quiet) {
        const scan = await window.desktop.termScan(projectDir, started)
        const prefix = layoutFor(projectId).importPrefix
        const changed = Object.fromEntries(Object.entries(scan.files || {}).map(([k, v]) => [prefix + k, v]))
        const paths = Object.keys(changed).filter((p) => filesRef.current[p]?.content !== changed[p])
        if (scan.tooMany) {
          setLines((ls) => [...ls, { type: 'info', text: 'Many files changed in the folder, so I did not add them to the editor. They are still on your computer.' }])
        } else if (paths.length && onFilesChange) {
          const next = { ...filesRef.current }
          for (const p of paths) next[p] = { content: changed[p], language: getLanguageFromPath(p) }
          onFilesChange(next)
          setLines((ls) => [...ls, { type: 'info', text: `${paths.length} file${paths.length === 1 ? '' : 's'} updated in the editor` }])
        }
      }
    } catch (e) {
      setLines((ls) => [...ls, { type: 'output', text: String(e.message || e) }])
    } finally {
      off()
      setBusy(null)
    }
  }
  const runRealRef = useRef(null)
  runRealRef.current = runReal
  // the AI asked for a command and the user allowed it
  useEffect(() => {
    const go = (d) => {
      if (!d?.cmd || !desktop) return
      setReal(true)
      setLines((l) => [...l, { type: 'input', cwd: rcwd || folderPath, text: d.cmd }])
      runRealRef.current(d.cmd, { ai: true, test: d.test })
    }
    const pending = window.__qodersPendingRun
    if (pending) { window.__qodersPendingRun = null; go(pending) }
    const h = (e) => go(e.detail)
    window.addEventListener('qoders-run', h)
    return () => window.removeEventListener('qoders-run', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const stopReal = () => { if (busy) window.desktop.termKill(busy) }

  const submit = () => {
    const cmd = input.trim()
    if (real && cmd && !busy) {
      if (cmd === 'clear') { setLines([]); setInput(''); return }
      setHistory((h) => [...h, cmd]); setHistIndex(-1)
      setLines((l) => [...l, { type: 'input', cwd: rcwd || folderPath, text: cmd }])
      setInput('')
      runReal(cmd)
      return
    }
    if (!cmd) {
      setLines((l) => [...l, { type: 'input', cwd: shell.cwd, text: '' }])
      return
    }

    setHistory((h) => [...h, cmd])
    setHistIndex(-1)

    setLines((l) => [...l, { type: 'input', cwd: shell.cwd, text: cmd }])

    const result = runCommand(shell, cmd)

    if (result.clear) {
      setLines([])
      setInput('')
      return
    }

    if (result.output) {
      setLines((l) => [...l, { type: 'output', text: result.output }])
    }

    setShell(result.shell)

    // If the command created/modified/deleted files, sync back up
    if (result.filesChanged && result.newFiles && onFilesChange) {
      onFilesChange(result.newFiles)
    }

    setInput('')
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const next = histIndex === -1 ? history.length - 1 : Math.max(0, histIndex - 1)
      setHistIndex(next)
      setInput(history[next])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIndex === -1) return
      const next = histIndex + 1
      if (next >= history.length) {
        setHistIndex(-1)
        setInput('')
      } else {
        setHistIndex(next)
        setInput(history[next])
      }
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const completed = autocomplete(shell, input)
      if (completed) setInput(completed)
    } else if (e.key === 'c' && e.ctrlKey && busy) {
      e.preventDefault()
      stopReal()
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setLines([])
    }
  }

  return (
    <div
      className="terminal"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="terminal-output">
        {lines.map((line, i) => {
          if (line.type === 'input') {
            return (
              <div key={i} className="term-line term-line-input">
                <span className="term-prompt">
                  <span className="term-user">qoders</span>
                  <span className="term-sep">:</span>
                  <span className="term-path">{line.cwd}</span>
                  <span className="term-sigil">$</span>
                </span>
                <span className="term-command">{line.text}</span>
              </div>
            )
          }
          if (line.type === 'info') {
            return (
              <div key={i} className="term-line term-line-info">
                {line.text}
              </div>
            )
          }
          return (
            <pre key={i} className="term-line term-line-output">{line.text}</pre>
          )
        })}
        <div className="term-line term-line-active">
          {desktop && (
            <span className="term-menu-wrap">
              <button className={`term-dots ${real ? 'real' : ''}`} onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }} title="Terminal options" aria-label="Terminal options">⋯</button>
              {menuOpen && (
                <div className="term-menu" onClick={(e) => e.stopPropagation()}>
                  <button className={!real ? 'on' : ''} onClick={() => { setReal(false); setMenuOpen(false) }}>Virtual (project files only)</button>
                  <button className={real ? 'on' : ''} onClick={() => { setReal(true); setMenuOpen(false) }}>This computer (real commands)</button>
                  {busy && <button className="danger" onClick={() => { stopReal(); setMenuOpen(false) }}>Stop running command</button>}
                </div>
              )}
            </span>
          )}
          {prompt()}
          <input
            ref={inputRef}
            className="term-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div ref={endRef} />
      </div>
    </div>
  )
}