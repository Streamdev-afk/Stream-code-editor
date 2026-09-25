// A virtual shell that operates on the files map from fs.js
// { 'src/App.jsx': { content, language }, ... }

export function createShell(files, cwd = '/') {
  return { files, cwd }
}

// Split a path string into segments
function resolvePath(cwd, target) {
  if (!target) return cwd
  if (target === '/') return '/'
  if (target.startsWith('/')) return normalize('/' + target)
  return normalize(cwd + '/' + target)
}

function normalize(path) {
  const parts = path.split('/').filter((p) => p && p !== '.')
  const stack = []
  for (const p of parts) {
    if (p === '..') stack.pop()
    else stack.push(p)
  }
  return '/' + stack.join('/')
}

function joinPath(cwd, target) {
  const abs = resolvePath(cwd, target)
  return abs.replace(/^\//, '') // convert to relative-to-root style used by files map
}

// List entries at a given directory
function listDir(files, cwd) {
  const prefix = cwd === '/' ? '' : cwd.slice(1) + '/'
  const seen = new Set()
  const entries = []

  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    if (!rest) continue
    const firstSeg = rest.split('/')[0]
    if (seen.has(firstSeg)) continue
    seen.add(firstSeg)
    const isDir = rest.includes('/')
    entries.push({ name: firstSeg, isDir })
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

export function runCommand(shell, rawInput) {
  const input = rawInput.trim()
  if (!input) return { output: '', shell, clear: false }

  // Parse command + args (handles simple quotes)
  const tokens = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(input))) {
    tokens.push(m[1] ?? m[2] ?? m[3])
  }

  const [cmd, ...args] = tokens
  const files = shell.files
  let cwd = shell.cwd

  const fail = (msg) => ({ output: msg, shell: { files, cwd }, clear: false })

  switch (cmd) {
    case 'help':
      return {
        output: [
          'Available commands:',
          '  ls [path]         list files',
          '  cd <path>         change directory',
          '  pwd               print working directory',
          '  cat <file>        print file contents',
          '  echo <text>       print text (or redirect with >)',
          '  touch <file>      create empty file',
          '  mkdir <dir>       create directory',
          '  rm <path>         delete file or directory',
          '  mv <a> <b>        move or rename',
          '  cp <a> <b>        copy',
          '  tree              show directory tree',
          '  find <name>       search for files by name',
          '  wc <file>         count lines/words/chars',
          '  head <file>       show first 10 lines',
          '  tail <file>       show last 10 lines',
          '  grep <pat> <file> search text in file',
          '  clear             clear terminal',
          '',
          'Note: This is a virtual shell — nothing touches your real computer.',
        ].join('\n'),
        shell: { files, cwd },
        clear: false,
      }

    case 'clear':
      return { output: '', shell: { files, cwd }, clear: true }

    case 'pwd':
      return { output: cwd, shell: { files, cwd }, clear: false }

    case 'ls': {
      const targetDir = args[0] ? resolvePath(cwd, args[0]) : cwd
      const entries = listDir(files, targetDir)
      if (entries.length === 0) return { output: '', shell: { files, cwd }, clear: false }
      const out = entries.map((e) => e.isDir ? e.name + '/' : e.name).join('  ')
      return { output: out, shell: { files, cwd }, clear: false }
    }

    case 'cd': {
      if (!args[0] || args[0] === '~') return { output: '', shell: { files, cwd: '/' }, clear: false }
      const target = resolvePath(cwd, args[0])
      if (target === '/') return { output: '', shell: { files, cwd: '/' }, clear: false }
      // Verify dir exists
      const rel = target.slice(1) + '/'
      const exists = Object.keys(files).some((p) => p.startsWith(rel))
      if (!exists) return fail(`cd: no such directory: ${args[0]}`)
      return { output: '', shell: { files, cwd: target }, clear: false }
    }

    case 'cat': {
      if (!args[0]) return fail('cat: missing file operand')
      const path = joinPath(cwd, args[0])
      const file = files[path]
      if (!file) return fail(`cat: ${args[0]}: No such file`)
      return { output: file.content || '', shell: { files, cwd }, clear: false }
    }

    case 'echo': {
      // Support: echo hello > file.txt
      const gtIdx = args.indexOf('>')
      if (gtIdx !== -1) {
        const text = args.slice(0, gtIdx).join(' ')
        const filePath = joinPath(cwd, args[gtIdx + 1] || '')
        if (!filePath) return fail('echo: missing output file')
        const newFiles = { ...files, [filePath]: { ...(files[filePath] || {}), content: text + '\n' } }
        return { output: '', shell: { files: newFiles, cwd }, clear: false, filesChanged: true, newFiles }
      }
      return { output: args.join(' '), shell: { files, cwd }, clear: false }
    }

    case 'touch': {
      if (!args[0]) return fail('touch: missing file operand')
      const path = joinPath(cwd, args[0])
      if (files[path]) return { output: '', shell: { files, cwd }, clear: false }
      const newFiles = { ...files, [path]: { content: '', language: 'plaintext' } }
      return { output: '', shell: { files: newFiles, cwd }, clear: false, filesChanged: true, newFiles }
    }

    case 'mkdir': {
      if (!args[0]) return fail('mkdir: missing operand')
      const path = joinPath(cwd, args[0]) + '/.gitkeep'
      const newFiles = { ...files, [path]: { content: '', language: 'plaintext' } }
      return { output: '', shell: { files: newFiles, cwd }, clear: false, filesChanged: true, newFiles }
    }

    case 'rm': {
      if (!args[0]) return fail('rm: missing operand')
      const target = joinPath(cwd, args[0])
      const prefix = target + '/'
      const newFiles = {}
      let removed = 0
      for (const [p, f] of Object.entries(files)) {
        if (p === target) { removed++; continue }
        if (p.startsWith(prefix)) { removed++; continue }
        newFiles[p] = f
      }
      if (removed === 0) return fail(`rm: ${args[0]}: No such file or directory`)
      return { output: '', shell: { files: newFiles, cwd }, clear: false, filesChanged: true, newFiles }
    }

    case 'mv': {
      if (args.length < 2) return fail('mv: missing destination')
      const from = joinPath(cwd, args[0])
      const to = joinPath(cwd, args[1])
      if (!files[from]) return fail(`mv: ${args[0]}: No such file`)
      const newFiles = { ...files }
      newFiles[to] = newFiles[from]
      delete newFiles[from]
      return { output: '', shell: { files: newFiles, cwd }, clear: false, filesChanged: true, newFiles }
    }

    case 'cp': {
      if (args.length < 2) return fail('cp: missing destination')
      const from = joinPath(cwd, args[0])
      const to = joinPath(cwd, args[1])
      if (!files[from]) return fail(`cp: ${args[0]}: No such file`)
      const newFiles = { ...files, [to]: { ...files[from] } }
      return { output: '', shell: { files: newFiles, cwd }, clear: false, filesChanged: true, newFiles }
    }

    case 'tree': {
      const lines = ['.']
      const walk = (dir, prefix) => {
        const entries = listDir(files, dir)
        entries.forEach((e, i) => {
          const isLast = i === entries.length - 1
          const branch = isLast ? '└── ' : '├── '
          lines.push(prefix + branch + e.name + (e.isDir ? '/' : ''))
          if (e.isDir) {
            const childPrefix = prefix + (isLast ? '    ' : '│   ')
            walk(dir + '/' + e.name, childPrefix)
          }
        })
      }
      walk(cwd, '')
      return { output: lines.join('\n'), shell: { files, cwd }, clear: false }
    }

    case 'find': {
      if (!args[0]) return fail('find: missing pattern')
      const pat = args[0].toLowerCase()
      const matches = Object.keys(files).filter((p) => p.toLowerCase().includes(pat))
      return { output: matches.join('\n'), shell: { files, cwd }, clear: false }
    }

    case 'wc': {
      if (!args[0]) return fail('wc: missing file operand')
      const path = joinPath(cwd, args[0])
      const file = files[path]
      if (!file) return fail(`wc: ${args[0]}: No such file`)
      const content = file.content || ''
      const lines = content.split('\n').length
      const words = content.split(/\s+/).filter(Boolean).length
      const chars = content.length
      return { output: `${lines}  ${words}  ${chars}  ${args[0]}`, shell: { files, cwd }, clear: false }
    }

    case 'head': {
      if (!args[0]) return fail('head: missing file operand')
      const path = joinPath(cwd, args[0])
      const file = files[path]
      if (!file) return fail(`head: ${args[0]}: No such file`)
      const lines = (file.content || '').split('\n').slice(0, 10)
      return { output: lines.join('\n'), shell: { files, cwd }, clear: false }
    }

    case 'tail': {
      if (!args[0]) return fail('tail: missing file operand')
      const path = joinPath(cwd, args[0])
      const file = files[path]
      if (!file) return fail(`tail: ${args[0]}: No such file`)
      const lines = (file.content || '').split('\n').slice(-10)
      return { output: lines.join('\n'), shell: { files, cwd }, clear: false }
    }

    case 'grep': {
      if (args.length < 2) return fail('grep: usage: grep <pattern> <file>')
      const [pattern, ...rest] = args
      const path = joinPath(cwd, rest.join(' '))
      const file = files[path]
      if (!file) return fail(`grep: ${rest.join(' ')}: No such file`)
      const lines = (file.content || '').split('\n')
      const matches = []
      lines.forEach((line, i) => {
        if (line.includes(pattern)) matches.push(`${i + 1}:${line}`)
      })
      return { output: matches.join('\n') || `(no matches for "${pattern}")`, shell: { files, cwd }, clear: false }
    }

    default:
      return fail(`command not found: ${cmd}. Type 'help' for available commands.`)
  }
}

// Autocomplete helper — returns first matching candidate for a partial word
export function autocomplete(shell, partial) {
  if (!partial) return null
  const tokens = partial.split(/\s+/)
  const last = tokens[tokens.length - 1]
  const isFirstWord = tokens.length === 1

  if (isFirstWord) {
    const cmds = ['ls','cd','pwd','cat','echo','touch','mkdir','rm','mv','cp','tree','find','wc','head','tail','grep','clear','help']
    const match = cmds.find((c) => c.startsWith(last) && c !== last)
    return match ? match : null
  }

  // Complete file/folder names
  const entries = listDir(shell.files, shell.cwd)
  const match = entries.find((e) => e.name.startsWith(last) && e.name !== last)
  if (!match) return null
  tokens[tokens.length - 1] = match.name + (match.isDir ? '/' : '')
  return tokens.join(' ')
}