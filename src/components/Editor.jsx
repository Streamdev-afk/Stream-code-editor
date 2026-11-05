import { useRef, useImperativeHandle, forwardRef } from 'react'
import MonacoEditor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import '../lib/monacoWorkers.js'

loader.config({ monaco })


const DEFAULT_CODE = `// Welcome to Stream
// Try clicking "Complete Code" in the topbar.
// Or select some code and right-click for AI actions.

function greet(name) {
  return \`Hello, \${name}!\`
}

console.log(greet('world'))
`

const Editor = forwardRef(function Editor(
  { code, setCode, language = 'javascript', settings },
  ref
) {
  const editorRef = useRef(null)
  const monacoRef = useRef(null)

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

    // Initial theme
    defineTheme(monaco, '#10b981', '#10b98133')

    // Listen for theme changes from settings
    const onThemeChange = (e) => {
      const theme = e.detail
      if (!theme) return
      defineTheme(monaco, theme.accent, theme.accentDim)
    }
    window.addEventListener('stream-theme-change', onThemeChange)

    // Cleanup when unmount
    editor.onDidDispose(() => {
      window.removeEventListener('stream-theme-change', onThemeChange)
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
        renderLineHighlight: 'line',
        roundedSelection: true,
        guides: { indentation: true, bracketPairs: false },
        lineNumbers: settings?.lineNumbers === false ? 'off' : 'on',
        lineNumbersMinChars: 3,
        automaticLayout: true,
        tabSize: settings?.tabSize ?? 2,
        wordWrap: settings?.wordWrap === false ? 'off' : 'on',
      }}
    />
  )
})

export default Editor