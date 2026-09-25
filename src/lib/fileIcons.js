// Maps a filename to an emoji icon. Simple, no deps, works everywhere.
export function getFileIcon(name) {
  if (!name) return '📄'
  const ext = name.split('.').pop()?.toLowerCase()
  const map = {
    js: '🟨',
    jsx: '⚛️',
    ts: '🔷',
    tsx: '⚛️',
    css: '🎨',
    scss: '🎨',
    less: '🎨',
    html: '🌐',
    htm: '🌐',
    json: '📋',
    md: '📝',
    mdx: '📝',
    py: '🐍',
    rb: '💎',
    rs: '🦀',
    go: '🐹',
    java: '☕',
    cpp: '⚙️',
    c: '⚙️',
    h: '📐',
    cs: '🎯',
    php: '🐘',
    swift: '🦅',
    kt: '🎯',
    sh: '🐚',
    bash: '🐚',
    zsh: '🐚',
    yml: '📐',
    yaml: '📐',
    toml: '📐',
    xml: '📐',
    svg: '🖼️',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    gif: '🖼️',
    ico: '🖼️',
    lock: '🔒',
    gitignore: '🚫',
  }
  return map[ext] || '📄'
}

export function getFolderIcon(open) {
  return open ? '📂' : '📁'
}