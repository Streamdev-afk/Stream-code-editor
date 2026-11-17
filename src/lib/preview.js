// Builds a self-contained HTML document from the virtual file system.
// If activeFile is an HTML file, use it as the entry. Otherwise pick public/index.html, then any .html.
export function buildPreview(files, activeFile) {
  // Pick entry HTML
  let htmlPath = null
  if (activeFile && files[activeFile] && activeFile.endsWith('.html')) {
    htmlPath = activeFile
  }
  if (!htmlPath) {
    htmlPath =
      Object.keys(files).find((p) => p === 'public/index.html') ||
      Object.keys(files).find((p) => p === 'index.html') ||
      Object.keys(files).find((p) => p.endsWith('.html'))
  }

  let html = htmlPath
    ? files[htmlPath].content
    : `<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>`

  // If the HTML file is fully self-contained (has its own <script>/<style>),
  // don't inject anything — just show it as-is.
  const hasOwnStructure = /<html[\s>]/i.test(html)
  if (hasOwnStructure) {
    // Bring in the files this page links to (style.css, script.js, images), like the live URL does
    html = inlineLinked(html, files, htmlPath)
    const shim = buildConsoleShim()
    const inject = `<script>${shim}</script><script>${PICKER}</script>`
    html = html.includes('</head>')
      ? html.replace('</head>', `${inject}</head>`)
      : `${inject}${html}`
    return html
  }
  html = inlineLinked(html, files, htmlPath)

  // Otherwise, it's a fragment — inject CSS + JS from other files
  const cssFiles = Object.entries(files).filter(([p]) => p.endsWith('.css'))
  const cssBlock = cssFiles.map(([p, f]) => `/* ${p} */\n${f.content}`).join('\n\n')

  const jsFiles = Object.entries(files).filter(
    ([p]) => (p.endsWith('.js') || p.endsWith('.jsx')) && !p.endsWith('.config.js')
  )
  const jsBlock = jsFiles.map(([p, f]) => `// ${p}\n${f.content}`).join('\n\n')

  const shim = buildConsoleShim()

  if (cssBlock) {
    html = html.includes('</head>')
      ? html.replace('</head>', `<style>${cssBlock}</style></head>`)
      : `<style>${cssBlock}</style>` + html
  }

  const scriptBlock = `<script>${shim}\n${jsBlock}</script><script>${PICKER}</script>`
  html = html.includes('</body>')
    ? html.replace('</body>', `${scriptBlock}</body>`)
    : html + scriptBlock

  return html
}

// Finds a project file from the path used in the HTML (relative to the page, from the root, or just by name)
function findFile(files, ref, fromPath) {
  const clean = ref.split(/[?#]/)[0].replace(/^\.\//, '')
  const dir = fromPath && fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : ''
  const tries = [clean.startsWith('/') ? clean.slice(1) : dir + clean, clean.replace(/^\//, ''), 'public/' + clean.replace(/^\//, ''), 'src/' + clean.replace(/^\//, '')]
  for (const t of tries) if (files[t]) return files[t]
  const name = clean.split('/').pop()
  const key = Object.keys(files).find((p) => p.split('/').pop() === name)
  return key ? files[key] : null
}

const isLocal = (u) => u && !/^(https?:|\/\/|data:|blob:|#|mailto:|tel:)/i.test(u)

// Puts local <link rel=stylesheet>, <script src> and <img src> files straight into the page
function inlineLinked(html, files, fromPath) {
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel=["']?stylesheet/i.test(tag)) return tag
    const m = tag.match(/href=["']([^"']+)["']/i)
    if (!m || !isLocal(m[1])) return tag
    const f = findFile(files, m[1], fromPath)
    return f ? `<style>/* ${m[1]} */\n${f.content}</style>` : tag
  })
  html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => {
    if (!isLocal(src)) return tag
    if (/@vite\/client|@react-refresh/.test(src)) return ''
    const f = findFile(files, src, fromPath)
    if (!f) return tag
    // a module that imports other files can't be inlined as is; leave the tag
    if (/type=["']module["']/i.test(a + b) && /^\s*import\s.+from\s+["']\./m.test(f.content)) return tag
    const attrs = `${a} ${b}`.replace(/\s+/g, ' ').trim()
    return `<script ${attrs}>\n${f.content.replace(/<\/script/gi, '<\\/script')}\n</script>`
  })
  html = html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (m, pre, src, post) => {
    if (!isLocal(src)) return m
    const f = findFile(files, src, fromPath)
    const c = f && f.content
    if (c && /^data:/.test(c)) return pre + c + post
    if (c && /\.svg$/i.test(src)) return pre + 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(c) + post
    return m
  })
  return html
}

function buildConsoleShim() {
  return `
    (function() {
      const send = (level, args) => {
        try {
          parent.postMessage({
            __preview: true,
            level,
            text: args.map(a => {
              try {
                if (typeof a === 'string') return a;
                return JSON.stringify(a);
              } catch { return String(a); }
            }).join(' ')
          }, '*');
        } catch (e) {}
      };
      const origLog = console.log;
      const origErr = console.error;
      const origWarn = console.warn;
      console.log = (...a) => { send('log', a); origLog.apply(console, a); };
      console.error = (...a) => { send('error', a); origErr.apply(console, a); };
      console.warn = (...a) => { send('warn', a); origWarn.apply(console, a); };
      window.onerror = (msg, src, line, col, err) => {
        send('error', [msg + ' (line ' + line + ')']);
      };
    })();
  `
}

// Lets the editor ask the page "which element did the user click?". Off until the editor turns it on.
const PICKER = `
(function () {
  var on = false;
  var box = document.createElement('div');
  var lab = document.createElement('div');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #10b981;background:rgba(16,185,129,.14);border-radius:4px;display:none;box-sizing:border-box';
  lab.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#10b981;color:#04130d;font:600 11px system-ui,sans-serif;padding:2px 7px;border-radius:5px;display:none;max-width:60vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
  function mount() { if (!box.parentNode) { document.documentElement.appendChild(box); document.documentElement.appendChild(lab); } }
  function pick(e) { var t = e.target; if (!t || t === box || t === lab) return null; if (t.nodeType !== 1) t = t.parentElement; if (!t || t === document.documentElement || t === document.body) return null; return t; }
  function label(el) { var s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; var c = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2); if (c.length) s += '.' + c.join('.'); return s; }
  function selector(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body && parts.length < 5) {
      var s = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(s + '#' + el.id); break; }
      var c = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (c.length) s += '.' + c.join('.');
      var p = el.parentElement;
      if (p) { var same = Array.prototype.filter.call(p.children, function (x) { return x.tagName === el.tagName; }); if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')'; }
      parts.unshift(s);
      el = p;
    }
    return parts.join(' > ');
  }
  function show(el) {
    var r = el.getBoundingClientRect();
    box.style.display = 'block'; box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    lab.textContent = label(el); lab.style.display = 'block'; lab.style.left = Math.max(0, r.left) + 'px'; lab.style.top = (r.top > 22 ? r.top - 22 : r.bottom + 2) + 'px';
  }
  function hide() { box.style.display = 'none'; lab.style.display = 'none'; }
  document.addEventListener('mousemove', function (e) { if (!on) return; var t = pick(e); if (t) show(t); else hide(); }, true);
  document.addEventListener('click', function (e) {
    if (!on) return;
    var t = pick(e); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    show(t);
    var cs = getComputedStyle(t);
    try {
      parent.postMessage({
        __pick: true,
        tag: t.tagName.toLowerCase(),
        selector: selector(t),
        text: (t.innerText || t.value || t.alt || '').trim().slice(0, 140),
        html: t.outerHTML.slice(0, 700),
        styles: { color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, fontFamily: cs.fontFamily.slice(0, 60), padding: cs.padding, borderRadius: cs.borderRadius }
      }, '*');
    } catch (err) {}
  }, true);
  window.addEventListener('message', function (e) {
    if (!e.data || typeof e.data.__pickMode === 'undefined') return;
    on = !!e.data.__pickMode; mount(); hide();
    document.documentElement.style.cursor = on ? 'crosshair' : '';
  });
})();
`
