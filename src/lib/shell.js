// A virtual shell that operates on the files map from fs.js
// { 'src/App.jsx': { content, language }, ... }
//
// It is used in two places:
//  1. the Terminal panel (you type commands)
//  2. the AI, which reads exactly the lines it needs with the read-only commands
//     (grep -rn, sed -n 'A,Bp', head -n, cat -n ...) instead of being sent whole files.

export function createShell(files, cwd = '/') {
  return { files, cwd }
}

// ------------------------------------------------------------
// path helpers
// ------------------------------------------------------------

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
  return abs.replace(/^\//, '') // path style used by the files map
}

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

const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build)\//
const SKIP_FILES = /(\.lock|\.log|\.gitkeep|\.png|\.jpe?g|\.gif|\.webp|\.ico|\.woff2?|\.zip)$|package-lock\.json$/i

// every searchable file under a path (a directory or a single file)
function filesUnder(files, relPath) {
  const base = relPath.replace(/\/+$/, '')
  if (base && files[base]) return [base]
  const prefix = base ? base + '/' : ''
  return Object.keys(files)
    .filter((p) => p.startsWith(prefix) && !SKIP_DIRS.test(p) && !SKIP_FILES.test(p))
    .sort()
}

function tokenize(input) {
  const tokens = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(input))) tokens.push(m[1] ?? m[2] ?? m[3])
  return tokens
}

const isFlag = (a) => /^-[A-Za-z]+$/.test(a)

// split "-rf src" into { flags: Set('r','f'), rest: ['src'] }
function splitFlags(args) {
  const flags = new Set()
  const rest = []
  for (const a of args) {
    if (isFlag(a)) for (const ch of a.slice(1)) flags.add(ch)
    else rest.push(a)
  }
  return { flags, rest }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// head / tail count: "-n 20", "-n20", "-20"
function readCount(args, fallback = 10) {
  let n = fallback
  const rest = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-n' && /^\d+$/.test(args[i + 1] || '')) { n = parseInt(args[i + 1], 10); i++ }
    else if (/^-n\d+$/.test(a)) n = parseInt(a.slice(2), 10)
    else if (/^-\d+$/.test(a)) n = parseInt(a.slice(1), 10)
    else rest.push(a)
  }
  return { n, rest }
}

const numbered = (lines, start = 1) =>
  lines.map((l, i) => String(i + start).padStart(5) + '  ' + l).join('\n')

const MAX_GREP_LINES = 200

// ------------------------------------------------------------
// read-only guard: the AI may only run these
// ------------------------------------------------------------

const READ_ONLY = new Set(['ls', 'tree', 'cat', 'nl', 'head', 'tail', 'grep', 'rg', 'find', 'wc', 'sed', 'pwd'])

export function isReadOnlyCommand(line) {
  const t = tokenize(String(line || '').trim())
  if (!t.length || !READ_ONLY.has(t[0])) return false
  if (t.some((x) => x === '>' || x === '>>' || x === '|' || x === '&&' || x === ';' || x === '||')) return false
  if (t[0] === 'sed') {
    if (!t.includes('-n')) return false // plain sed could rewrite text
    if (t.some((x) => /^-[a-zA-Z]*i/.test(x))) return false // -i edits in place
  }
  return true
}

// ------------------------------------------------------------
// the shell
// ------------------------------------------------------------

export function runCommand(shell, rawInput) {
  const input = rawInput.trim()
  if (!input) return { output: '', shell, clear: false }

  const [cmd, ...args] = tokenize(input)
  const files = shell.files
  const cwd = shell.cwd

  const same = { files, cwd }
  const ok = (output = '') => ({ output, shell: same, clear: false })
  const fail = (msg) => ({ output: msg, shell: same, clear: false })
  const changed = (newFiles, output = '') => ({
    output, shell: { files: newFiles, cwd }, clear: false, filesChanged: true, newFiles,
  })

  const getFile = (arg) => files[joinPath(cwd, arg)]

  switch (cmd) {
    case 'help':
      return ok([
        'Files',
        '  ls [-l] [path]      list files           tree [-L n]        show the tree',
        '  cd <path>           change directory     pwd                print directory',
        '  find <text>         find files by name   find . -name "*.js"',
        '  touch / mkdir       create               rm [-r] / mv / cp  delete, move, copy',
        '',
        'Reading (also what the AI uses to read just the lines it needs)',
        '  cat [-n] <file>     print a file (-n adds line numbers)',
        '  head -n 20 <file>   first lines          tail -n 20 <file>  last lines',
        "  sed -n '40,80p' <file>   print lines 40 to 80",
        '  grep [-inrcl] [-A n] [-B n] [-E] <text> [path]   search (-r searches all files)',
        '  wc [-l] <file>      count lines/words    nl <file>          numbered lines',
        '',
        'Other',
        '  echo <text> > file  write (or >> to append)    clear',
        '',
        'This is a virtual shell: it only touches your project files, not your computer.',
      ].join('\n'))

    case 'clear':
      return { output: '', shell: same, clear: true }

    case 'pwd':
      return ok(cwd)

    case 'ls': {
      const { flags, rest } = splitFlags(args)
      const targetDir = rest[0] ? resolvePath(cwd, rest[0]) : cwd
      const entries = listDir(files, targetDir)
      if (entries.length === 0) return ok('')
      if (flags.has('l')) {
        const prefix = targetDir === '/' ? '' : targetDir.slice(1) + '/'
        return ok(entries.map((e) => {
          if (e.isDir) return `dir   ${e.name}/`
          const f = files[prefix + e.name]
          return `${String((f?.content || '').length).padStart(6)}  ${e.name}`
        }).join('\n'))
      }
      return ok(entries.map((e) => (e.isDir ? e.name + '/' : e.name)).join('  '))
    }

    case 'cd': {
      if (!args[0] || args[0] === '~') return { output: '', shell: { files, cwd: '/' }, clear: false }
      const target = resolvePath(cwd, args[0])
      if (target === '/') return { output: '', shell: { files, cwd: '/' }, clear: false }
      const rel = target.slice(1) + '/'
      if (!Object.keys(files).some((p) => p.startsWith(rel))) return fail(`cd: no such directory: ${args[0]}`)
      return { output: '', shell: { files, cwd: target }, clear: false }
    }

    case 'cat':
    case 'nl': {
      const { flags, rest } = splitFlags(args)
      if (!rest.length) return fail(`${cmd}: missing file operand`)
      const withNumbers = cmd === 'nl' || flags.has('n')
      const parts = []
      for (const arg of rest) {
        const file = getFile(arg)
        if (!file) return fail(`${cmd}: ${arg}: No such file`)
        const text = file.content || ''
        parts.push(withNumbers ? numbered(text.split('\n')) : text)
      }
      return ok(parts.join('\n'))
    }

    case 'echo': {
      const appendIdx = args.indexOf('>>')
      const gtIdx = appendIdx !== -1 ? appendIdx : args.indexOf('>')
      if (gtIdx !== -1) {
        const text = args.slice(0, gtIdx).join(' ')
        const filePath = joinPath(cwd, args[gtIdx + 1] || '')
        if (!filePath) return fail('echo: missing output file')
        const old = appendIdx !== -1 ? (files[filePath]?.content || '') : ''
        const newFiles = { ...files, [filePath]: { ...(files[filePath] || { language: 'plaintext' }), content: old + text + '\n' } }
        return changed(newFiles)
      }
      return ok(args.join(' '))
    }

    case 'touch': {
      const { rest } = splitFlags(args)
      if (!rest[0]) return fail('touch: missing file operand')
      const path = joinPath(cwd, rest[0])
      if (files[path]) return ok('')
      return changed({ ...files, [path]: { content: '', language: 'plaintext' } })
    }

    case 'mkdir': {
      const { rest } = splitFlags(args)
      if (!rest[0]) return fail('mkdir: missing operand')
      const path = joinPath(cwd, rest[0]) + '/.gitkeep'
      return changed({ ...files, [path]: { content: '', language: 'plaintext' } })
    }

    case 'rm': {
      const { rest } = splitFlags(args)
      if (!rest[0]) return fail('rm: missing operand')
      const target = joinPath(cwd, rest[0])
      const prefix = target + '/'
      const newFiles = {}
      let removed = 0
      for (const [p, f] of Object.entries(files)) {
        if (p === target || p.startsWith(prefix)) { removed++; continue }
        newFiles[p] = f
      }
      if (removed === 0) return fail(`rm: ${rest[0]}: No such file or directory`)
      return changed(newFiles)
    }

    case 'mv': {
      const { rest } = splitFlags(args)
      if (rest.length < 2) return fail('mv: missing destination')
      const from = joinPath(cwd, rest[0])
      const to = joinPath(cwd, rest[1])
      if (!files[from]) return fail(`mv: ${rest[0]}: No such file`)
      const newFiles = { ...files }
      newFiles[to] = newFiles[from]
      delete newFiles[from]
      return changed(newFiles)
    }

    case 'cp': {
      const { rest } = splitFlags(args)
      if (rest.length < 2) return fail('cp: missing destination')
      const from = joinPath(cwd, rest[0])
      const to = joinPath(cwd, rest[1])
      if (!files[from]) return fail(`cp: ${rest[0]}: No such file`)
      return changed({ ...files, [to]: { ...files[from] } })
    }

    case 'tree': {
      let maxDepth = Infinity
      const li = args.indexOf('-L')
      if (li !== -1 && /^\d+$/.test(args[li + 1] || '')) maxDepth = parseInt(args[li + 1], 10)
      const lines = ['.']
      const walk = (dir, prefix, depth) => {
        if (depth > maxDepth) return
        const entries = listDir(files, dir)
        entries.forEach((e, i) => {
          const isLast = i === entries.length - 1
          lines.push(prefix + (isLast ? '└── ' : '├── ') + e.name + (e.isDir ? '/' : ''))
          if (e.isDir) walk(dir + '/' + e.name, prefix + (isLast ? '    ' : '│   '), depth + 1)
        })
      }
      walk(cwd, '', 1)
      return ok(lines.join('\n'))
    }

    case 'find': {
      if (!args[0]) return fail('find: missing pattern')
      // find [path] -name "*.jsx"
      const nameIdx = args.indexOf('-name')
      if (nameIdx !== -1 && args[nameIdx + 1]) {
        const base = nameIdx > 0 && !args[0].startsWith('-') ? joinPath(cwd, args[0]) : ''
        const glob = args[nameIdx + 1]
        const re = new RegExp('^' + glob.split('*').map((p) => p.split('?').map(escapeRe).join('.')).join('.*') + '$', 'i')
        const matches = filesUnder(files, base === '.' ? '' : base).filter((p) => re.test(p.split('/').pop()))
        return ok(matches.join('\n'))
      }
      const pat = args[0].toLowerCase()
      return ok(Object.keys(files).filter((p) => p.toLowerCase().includes(pat)).join('\n'))
    }

    case 'wc': {
      const { flags, rest } = splitFlags(args)
      if (!rest[0]) return fail('wc: missing file operand')
      const file = getFile(rest[0])
      if (!file) return fail(`wc: ${rest[0]}: No such file`)
      const content = file.content || ''
      const lines = content.split('\n').length
      if (flags.has('l')) return ok(`${lines} ${rest[0]}`)
      const words = content.split(/\s+/).filter(Boolean).length
      return ok(`${lines}  ${words}  ${content.length}  ${rest[0]}`)
    }

    case 'head':
    case 'tail': {
      const { n, rest } = readCount(args)
      if (!rest[0]) return fail(`${cmd}: missing file operand`)
      const file = getFile(rest[0])
      if (!file) return fail(`${cmd}: ${rest[0]}: No such file`)
      const lines = (file.content || '').split('\n')
      return ok((cmd === 'head' ? lines.slice(0, n) : lines.slice(-n)).join('\n'))
    }

    case 'sed': {
      // supported: sed -n 'A,Bp' file   |   sed -n 'Ap' file   |   $ means last line
      const { rest } = splitFlags(args)
      const script = rest[0]
      const target = rest[1]
      if (!args.includes('-n') || !script || !target) return fail("sed: usage: sed -n '40,80p' <file>")
      const file = getFile(target)
      if (!file) return fail(`sed: ${target}: No such file`)
      const m = script.match(/^(\d+|\$)(?:,(\d+|\$))?p$/)
      if (!m) return fail("sed: only line ranges are supported, like sed -n '40,80p' <file>")
      const lines = (file.content || '').split('\n')
      const toNum = (v) => (v === '$' ? lines.length : parseInt(v, 10))
      const a = toNum(m[1])
      const b = m[2] ? toNum(m[2]) : a
      return ok(lines.slice(Math.max(0, a - 1), Math.max(a, b)).join('\n'))
    }

    case 'grep':
    case 'rg': {
      // grep [-inrRclwE] [-A n] [-B n] [-C n] <pattern> [path...]
      const flags = new Set()
      let after = 0
      let before = 0
      const pos = []
      for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (/^-[ABC]$/.test(a) && /^\d+$/.test(args[i + 1] || '')) {
          const n = parseInt(args[i + 1], 10)
          if (a !== '-B') after = n
          if (a !== '-A') before = n
          i++
        } else if (/^-[ABC]\d+$/.test(a)) {
          const n = parseInt(a.slice(2), 10)
          if (a[1] !== 'B') after = n
          if (a[1] !== 'A') before = n
        } else if (isFlag(a)) {
          for (const ch of a.slice(1)) flags.add(ch)
        } else pos.push(a)
      }
      if (cmd === 'rg') flags.add('r')
      if (!pos.length) return fail('grep: usage: grep [-inrcl] [-A n] <pattern> [path]')

      const [pattern, ...paths] = pos
      let re
      try {
        const body = flags.has('E') ? pattern : escapeRe(pattern)
        re = new RegExp(flags.has('w') ? `\\b${body}\\b` : body, flags.has('i') ? 'i' : '')
      } catch {
        return fail(`grep: invalid pattern: ${pattern}`)
      }

      let targets = []
      const wantPaths = paths.length ? paths : (flags.has('r') || flags.has('R') ? ['.'] : [])
      if (!wantPaths.length) return fail('grep: give a file, or use -r to search the whole project')
      for (const p of wantPaths) {
        const rel = joinPath(cwd, p)
        const found = filesUnder(files, rel === '.' ? '' : rel)
        if (!found.length && !files[rel]) return fail(`grep: ${p}: No such file or directory`)
        targets.push(...found)
      }
      targets = [...new Set(targets)]
      const multi = targets.length > 1 || flags.has('r') || flags.has('R')

      const out = []
      let matchCount = 0
      let dropped = 0
      for (const path of targets) {
        const lines = (files[path].content || '').split('\n')
        const hits = []
        lines.forEach((line, i) => { if (re.test(line)) hits.push(i) })
        if (!hits.length) continue
        if (flags.has('l')) { out.push(path); matchCount += hits.length; continue }
        if (flags.has('c')) { out.push(multi ? `${path}:${hits.length}` : String(hits.length)); matchCount += hits.length; continue }

        const show = new Set()
        for (const h of hits) {
          for (let k = Math.max(0, h - before); k <= Math.min(lines.length - 1, h + after); k++) show.add(k)
        }
        const hitSet = new Set(hits)
        let prev = -2
        for (const k of [...show].sort((a, b) => a - b)) {
          if (matchCount >= MAX_GREP_LINES) { dropped++; continue }
          if ((before || after) && prev !== -2 && k > prev + 1) out.push('--')
          const sep = hitSet.has(k) ? ':' : '-'
          out.push(`${multi ? path + sep : ''}${k + 1}${sep}${lines[k]}`)
          if (hitSet.has(k)) matchCount++
          prev = k
        }
      }
      if (!out.length) return ok(`(no matches for "${pattern}")`)
      if (dropped) out.push(`… ${dropped} more lines. Narrow the search (a file path or a more specific word).`)
      return ok(out.join('\n'))
    }

    default:
      return fail(`command not found: ${cmd}. Type 'help' for available commands.`)
  }
}

// Autocomplete helper: returns the first matching candidate for a partial word
export function autocomplete(shell, partial) {
  if (!partial) return null
  const tokens = partial.split(/\s+/)
  const last = tokens[tokens.length - 1]
  const isFirstWord = tokens.length === 1

  if (isFirstWord) {
    const cmds = ['ls', 'cd', 'pwd', 'cat', 'nl', 'echo', 'touch', 'mkdir', 'rm', 'mv', 'cp', 'tree', 'find', 'wc', 'head', 'tail', 'sed', 'grep', 'rg', 'clear', 'help']
    const match = cmds.find((c) => c.startsWith(last) && c !== last)
    return match ? match : null
  }

  const entries = listDir(shell.files, shell.cwd)
  const match = entries.find((e) => e.name.startsWith(last) && e.name !== last)
  if (!match) return null
  tokens[tokens.length - 1] = match.name + (match.isDir ? '/' : '')
  return tokens.join(' ')
}
