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
    // Still inject the console shim so console.log works
    const shim = buildConsoleShim()
    html = html.includes('</head>')
      ? html.replace('</head>', `<script>${shim}</script></head>`)
      : `<script>${shim}</script>${html}`
    return html
  }

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

  const scriptBlock = `<script>${shim}\n${jsBlock}</script>`
  html = html.includes('</body>')
    ? html.replace('</body>', `${scriptBlock}</body>`)
    : html + scriptBlock

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