import { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react'
import MonacoEditor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import '../lib/monacoWorkers.js'

import { apiFetch } from '../lib/supabase'
import { API_BASE } from '../lib/api'

loader.config({ monaco })

// Tab autocomplete (Go plan and up, switched on in Settings): one provider for every editor
let acRegistered = false
function registerAutocomplete(monacoNs) {
  if (acRegistered) return
  acRegistered = true
  monacoNs.languages.registerInlineCompletionsProvider({ pattern: '**' }, {
    async provideInlineCompletions(model, position, _ctx, token) {
      if (!window.__qodersAC) return { items: [] }
      await new Promise((r) => setTimeout(r, 450))
      if (token.isCancellationRequested) return { items: [] }
      const last = model.getLineCount()
      const prefix = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
      const suffix = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: last, endColumn: model.getLineMaxColumn(last) })
      if (prefix.trim().length < 3) return { items: [] }
      try {
        const ctl = new AbortController()
        token.onCancellationRequested(() => ctl.abort())
        const r = await apiFetch(`${API_BASE}/api/complete`, { method: 'POST', body: JSON.stringify({ prefix, suffix, language: model.getLanguageId() }), signal: ctl.signal })
        if (!r.ok) return { items: [] }
        const j = await r.json()
        if (!j.text) return { items: [] }
        return { items: [{ insertText: j.text, range: new monacoNs.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] }
      } catch { return { items: [] } }
    },
    freeInlineCompletions() {},
    disposeInlineCompletions() {},
  })
}


const DEFAULT_CODE = `// Welcome to ION Qoders
// Try clicking "Complete Code" in the topbar.
// Or select some code and right-click for AI actions.

function greet(name) {
  return \`Hello, \${name}!\`
}

console.log(greet('world'))
`

const Editor = forwardRef(function Editor(
  { code, setCode, language = 'javascript', settings, mobile = false, secondary = false },
  ref
) {
  const editorRef = useRef(null)
  const [inline, setInline] = useState(null) // Ctrl+I: ask the AI to change the selection or the current line
  // re-measure after the layout around the editor changes (terminal panel shown or hidden)
  useEffect(() => {
    const h = () => { try { editorRef.current?.layout() } catch { /* ignore */ } }
    window.addEventListener('qoders-relayout', h)
    return () => window.removeEventListener('qoders-relayout', h)
  }, [])
  const monacoRef = useRef(null)
  const formattedRef = useRef('')

  // AI sometimes returns code crammed onto a few very long lines: tidy it with Monaco's formatter
  useEffect(() => {
    const text = code || ''
    if (settings?.autoFormat === false || text.length < 120) return
    const lines = text.split('\n')
    const longest = Math.max(...lines.map((l) => l.length))
    const cramped = lines.length <= 4 || (longest > 220 && text.length / lines.length > 90)
    if (!cramped) return
    const key = `${language}:${text.length}:${text.slice(0, 60)}`
    if (formattedRef.current === key) return
    formattedRef.current = key
    const t = setTimeout(async () => {
      try {
        const ed = editorRef.current
        if (!ed) return
        await ed.getAction('editor.action.formatDocument')?.run()
      } catch {}
    }, 500)
    return () => clearTimeout(t)
  }, [code, language, settings?.autoFormat])

  useImperativeHandle(ref, () => ({
    getValue: () => editorRef.current?.getValue() ?? '',
    setValue: (val) => {
      editorRef.current?.setValue(val)
    },
    getSelection: () =>
      editorRef.current?.getModel()?.getValueInRange(editorRef.current.getSelection()) ?? '',
    replaceSelection: (text) => {
      const editor = editorRef.current
      const selection = editor.getSelection()
      if (!selection) return
      editor.executeEdits('ai', [{ range: selection, text, forceMoveMarkers: true }])
    },
    getCursor: () => editorRef.current?.getPosition(),
    revealEnd: () => {
      const editor = editorRef.current
      const model = editor?.getModel()
      if (!model) return
      const line = model.getLineCount()
      editor.revealLine(line)
    },
    getMonaco: () => monacoRef.current,
    getEditor: () => editorRef.current,
    gotoLine: (line) => {
      const editor = editorRef.current
      if (!editor) return
      editor.revealLineInCenter(line)
      editor.setPosition({ lineNumber: line, column: 1 })
      editor.focus()
    },
    openFind: () => {
      editorRef.current?.getAction('actions.find')?.run()
    },
    openReplace: () => {
      editorRef.current?.getAction('editor.action.startFindReplaceAction')?.run()
    },
  }))

  const defineTheme = (monaco, accent, accentDim) => {
    monaco.editor.defineTheme('stream-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6b7390', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'bb9af7' },
        { token: 'string', foreground: '9ece6a' },
        { token: 'number', foreground: 'ff9e64' },
        { token: 'function', foreground: '7aa2f7' },
        { token: 'type', foreground: '2ac3de' },
        { token: 'variable', foreground: 'c0caf5' },
        { token: 'tag', foreground: 'f7768e' },
        { token: 'attribute.name', foreground: 'e0af68' },
      ],
      colors: {
        'editor.background': '#0e1016',
        'editor.foreground': '#d5d9e6',
        'editorLineNumber.foreground': '#4a5064',
        'editorLineNumber.activeForeground': '#c5c9d6',
        'editor.lineHighlightBackground': '#141722',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': accentDim || '#10b98133',
        'editorCursor.foreground': accent || '#10b981',
        'editorIndentGuide.background1': '#1b1e29',
        'editorIndentGuide.activeBackground1': '#2c3142',
        'editorWidget.background': '#151823',
        'editorWidget.border': '#262a37',
        'editorSuggestWidget.background': '#151823',
        'editorSuggestWidget.border': '#262a37',
        'scrollbarSlider.background': '#ffffff14',
        'scrollbarSlider.hoverBackground': '#ffffff26',
      },
    })
    monaco.editor.setTheme('stream-dark')
  }

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    registerAutocomplete(monaco)

    // Initial theme
    defineTheme(monaco, '#10b981', '#10b98133')

    // Listen for theme changes from settings
    const onThemeChange = (e) => {
      const theme = e.detail
      if (!theme) return
      defineTheme(monaco, theme.accent, theme.accentDim)
    }
    window.addEventListener('stream-theme-change', onThemeChange)

    // live info for the status bar + Problems panel
    const emitInfo = () => {
      const p = editor.getPosition(); const m = editor.getModel(); if (!p || !m) return
      const sel = editor.getSelection()
      window.dispatchEvent(new CustomEvent('qoders-editor-info', { detail: { line: p.lineNumber, col: p.column, selChars: sel && !sel.isEmpty() ? m.getValueInRange(sel).length : 0, tab: m.getOptions().tabSize, eol: m.getEOL() === '\r\n' ? 'CRLF' : 'LF' } }))
    }
    const emitMarkers = () => {
      try {
        const m = editor.getModel(); if (!m) return
        const list = monaco.editor.getModelMarkers({ resource: m.uri }).filter((x) => x.severity >= 4).map((x) => ({ line: x.startLineNumber, col: x.startColumn, msg: x.message, sev: x.severity >= 8 ? 'error' : 'warn', src: m.getLineContent(x.startLineNumber) }))
        window.__qodersProblems = list
        window.dispatchEvent(new CustomEvent('qoders-problems', { detail: list }))
      } catch {}
    }
    const goto = (e) => {
      const { line = 1, col = 1 } = e.detail || {}
      editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: col }); editor.focus()
    }
    if (!secondary) window.addEventListener('qoders-goto', goto)
    const d1 = editor.onDidChangeCursorPosition(() => { if (!secondary) emitInfo() })
    const d2 = editor.onDidChangeModel(() => { if (!secondary) { emitInfo(); emitMarkers() } })
    const d3 = monaco.editor.onDidChangeMarkers(() => { if (!secondary) emitMarkers() })
    if (!secondary) editor.addAction({
      id: 'inline-edit',
      label: '✦ Edit with AI (Ctrl+I)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
      contextMenuGroupId: 'ai',
      contextMenuOrder: 0,
      run: (ed) => {
        const m = ed.getModel(); const sel = ed.getSelection()
        let text = m.getValueInRange(sel)
        if (!text.trim()) text = m.getLineContent(sel.positionLineNumber)
        if (!text.trim()) return
        const pos = ed.getScrolledVisiblePosition(ed.getPosition())
        const r = ed.getDomNode().getBoundingClientRect()
        setInline({ x: r.left + (pos?.left || 40), y: r.top + (pos?.top || 40) + 24, sel: text })
      },
    })
    if (!secondary) emitInfo(); if (!secondary) emitMarkers()

    // Cleanup when unmount
    editor.onDidDispose(() => {
      window.removeEventListener('stream-theme-change', onThemeChange)
      window.removeEventListener('qoders-goto', goto)
      d1.dispose(); d2.dispose(); d3.dispose()
    })

    // Right-click context menu actions
    editor.addAction({
      id: 'ai-explain',
      label: '🤖 Explain with AI',
      contextMenuGroupId: 'ai',
      contextMenuOrder: 1,
      run: (ed) => {
        const sel = ed.getModel().getValueInRange(ed.getSelection())
        window.dispatchEvent(new CustomEvent('ai-action', {
          detail: { action: 'selection', instruction: 'explain this code clearly and concisely', selection: sel },
        }))
      },
    })

    editor.addAction({
      id: 'ai-refactor',
      label: '✨ Refactor with AI',
      contextMenuGroupId: 'ai',
      contextMenuOrder: 2,
      run: (ed) => {
        const sel = ed.getModel().getValueInRange(ed.getSelection())
        window.dispatchEvent(new CustomEvent('ai-action', {
          detail: { action: 'selection', instruction: 'refactor this to be cleaner and more idiomatic', selection: sel },
        }))
      },
    })

    editor.addAction({
      id: 'ai-fix',
      label: '🔧 Fix bugs with AI',
      contextMenuGroupId: 'ai',
      contextMenuOrder: 3,
      run: (ed) => {
        const sel = ed.getModel().getValueInRange(ed.getSelection())
        window.dispatchEvent(new CustomEvent('ai-action', {
          detail: { action: 'selection', instruction: 'find and fix any bugs in this code', selection: sel },
        }))
      },
    })

    editor.addAction({
      id: 'ai-comment',
      label: '💬 Add comments',
      contextMenuGroupId: 'ai',
      contextMenuOrder: 4,
      run: (ed) => {
        const sel = ed.getModel().getValueInRange(ed.getSelection())
        window.dispatchEvent(new CustomEvent('ai-action', {
          detail: { action: 'selection', instruction: 'add helpful comments without changing logic', selection: sel },
        }))
      },
    })

    editor.focus()
  }

  return (
    <>
    {inline && (
      <div className="inline-edit" style={{ left: Math.max(8, Math.min(inline.x, window.innerWidth - 420)), top: Math.max(8, Math.min(inline.y, window.innerHeight - 90)) }}>
        <span className="inline-edit-star">✦</span>
        <input
          autoFocus
          placeholder="What should change here? Enter to send, Esc to close"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setInline(null); editorRef.current?.focus() }
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              const instruction = e.currentTarget.value.trim()
              window.dispatchEvent(new CustomEvent('ai-action', { detail: { action: 'selection', instruction, selection: inline.sel } }))
              setInline(null)
            }
          }}
          onBlur={() => setTimeout(() => setInline(null), 150)}
        />
      </div>
    )}
    <MonacoEditor
      height="100%"
      defaultLanguage={language}
      language={language}
      value={code}
      onChange={(val) => setCode?.(val ?? '')}
      onMount={handleMount}
      options={{
        fontSize: settings?.fontSize ?? 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        fontLigatures: settings?.fontLigatures ?? true,
        minimap: { enabled: settings?.minimap ?? false },
        scrollBeyondLastLine: false,
        smoothScrolling: settings?.smoothScrolling ?? true,
        cursorBlinking: settings?.smoothScrolling ? 'smooth' : 'blink',
        cursorSmoothCaretAnimation: settings?.smoothScrolling ? 'on' : 'off',
        padding: { top: 16, bottom: 16 },
        renderLineHighlight: 'none',
        roundedSelection: true,
        guides: { indentation: settings?.indentGuides !== false, bracketPairs: false },
        bracketPairColorization: { enabled: settings?.bracketColors !== false },
        formatOnPaste: settings?.formatOnPaste === true,
        autoClosingBrackets: settings?.autoClose === false ? 'never' : 'languageDefined',
        autoClosingQuotes: settings?.autoClose === false ? 'never' : 'languageDefined',
        renderWhitespace: settings?.whitespace || 'none',
        cursorStyle: settings?.cursorStyle || 'line',
        lineNumbers: settings?.lineNumbers === false ? 'off' : 'on',
        lineNumbersMinChars: 3,
        automaticLayout: true,
        tabSize: settings?.tabSize ?? 2,
        wordWrap: settings?.wordWrap === false && !mobile ? 'off' : 'on',
        stickyScroll: { enabled: settings?.stickyScroll !== false },
        ...(mobile ? {
          minimap: { enabled: false },
          fontSize: Math.max(14, settings?.fontSize ?? 14),
          padding: { top: 10, bottom: 80 },
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 6,
          lineNumbersMinChars: 2,
          renderLineHighlight: 'none',
          hover: { enabled: false },
          parameterHints: { enabled: false },
          contextmenu: false,
          occurrencesHighlight: 'off',
          selectionHighlight: false,
          stickyScroll: { enabled: false },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: { vertical: 'hidden', horizontal: 'hidden', useShadows: false },
          dragAndDrop: false,
          suggest: { showStatusBar: false, preview: false },
          suggestFontSize: 13,
          fontLigatures: false,
        } : {}),
      }}
    />
    </>
  )
})

export default Editor