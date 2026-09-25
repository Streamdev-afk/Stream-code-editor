const STORAGE_KEY = 'STREAM-v1'

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

export function loadFiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_FILES }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_FILES }
    return parsed
  } catch {
    return { ...DEFAULT_FILES }
  }
}

export function saveFiles(files) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files))
  } catch (e) {
    console.warn('Failed to save files:', e)
  }
}

export function resetFiles() {
  localStorage.removeItem(STORAGE_KEY)
}

export function getLanguageFromPath(path) {
  const ext = path.split('.').pop()?.toLowerCase()
  const map = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    css: 'css',
    html: 'html',
    json: 'json',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    txt: 'plaintext',
  }
  return map[ext] || 'plaintext'
}

// Build a nested tree from flat paths like 'src/App.jsx'
export function buildTree(files) {
  const root = { name: 'root', type: 'folder', children: {}, path: '' }

  for (const path of Object.keys(files)) {
    const parts = path.split('/')
    let node = root
    let accumulated = ''

    parts.forEach((part, i) => {
      accumulated = accumulated ? `${accumulated}/${part}` : part
      const isFile = i === parts.length - 1

      if (!node.children[part]) {
        node.children[part] = isFile
          ? { name: part, type: 'file', path: accumulated }
          : { name: part, type: 'folder', children: {}, path: accumulated }
      }
      node = node.children[part]
    })
  }

  // Convert to sorted array (folders first, then files, alphabetical)
  function toArray(node) {
    if (node.type === 'file') return node
    const arr = Object.values(node.children).map(toArray)
    arr.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return { ...node, children: arr }
  }

  return toArray(root).children || []
}

// ---------- File/folder management helpers ----------

export function createFile(files, path, content = '') {
  if (files[path]) throw new Error('File already exists')
  return {
    ...files,
    [path]: { content, language: getLanguageFromPath(path) },
  }
}

export function createFolder(files, folderPath) {
  // Add a placeholder .gitkeep so the folder exists in the flat structure
  const placeholder = `${folderPath.replace(/\/$/, '')}/.gitkeep`
  if (files[placeholder]) throw new Error('Folder already exists')
  return {
    ...files,
    [placeholder]: { content: '', language: 'plaintext' },
  }
}

export function renamePath(files, oldPath, newPath) {
  if (oldPath === newPath) return files
  if (files[newPath]) throw new Error('A file already exists at that path')

  const next = {}
  const prefix = oldPath.endsWith('/') ? oldPath : oldPath + '/'
  const isFolder = Object.keys(files).some((p) => p.startsWith(prefix))

  for (const [path, file] of Object.entries(files)) {
    if (isFolder && path.startsWith(prefix)) {
      // Renaming a folder: move all children
      const suffix = path.slice(prefix.length)
      next[`${newPath}/${suffix}`] = file
    } else if (path === oldPath) {
      // Renaming a file
      next[newPath] = { ...file, language: getLanguageFromPath(newPath) }
    } else {
      next[path] = file
    }
  }
  return next
}

export function deletePath(files, targetPath) {
  const prefix = targetPath.endsWith('/') ? targetPath : targetPath + '/'
  const next = {}
  for (const [path, file] of Object.entries(files)) {
    if (path === targetPath) continue
    if (path.startsWith(prefix)) continue
    next[path] = file
  }
  return next
}

export function getFolderPaths(files) {
  // Returns a set of all folder paths that exist in the flat file map
  const folders = new Set()
  for (const path of Object.keys(files)) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join('/'))
    }
  }
  return folders
}