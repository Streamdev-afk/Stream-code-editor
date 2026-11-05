import { useState, useRef, useEffect } from 'react'
import { createShell, runCommand, autocomplete } from '../lib/shell'

export default function Terminal({ files, onFilesChange }) {
  const [lines, setLines] = useState([
    { type: 'info', text: 'Stream Shell v1.0 — type "help" for commands.' },
    { type: 'info', text: 'Virtual shell: runs against your project files, not your computer.' },
    { type: 'info', text: '' },
  ])
  const [input, setInput] = useState('')
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
        <span className="term-user">stream</span>
        <span className="term-sep">:</span>
        <span className="term-path">{shell.cwd}</span>
        <span className="term-sigil">$</span>
      </span>
    )
  }

  const submit = () => {
    const cmd = input.trim()
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
                  <span className="term-user">stream</span>
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