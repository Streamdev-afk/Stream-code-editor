// Rates a terminal command before it runs: safe / caution / review
const REVIEW = [/\brm\s+(-[a-z]*r|-[a-z]*f)/i, /\brmdir\b.*\/s/i, /\bdel\b.*\/[sfq]/i, /\bRemove-Item\b/i, /\bformat\b/i, /\bmkfs\b/i, /\bdd\s+if=/i, /\bsudo\b/i, /\bchmod\s+-R/i, /\bgit\s+push\b.*(-f|--force)/i, /\bgit\s+reset\s+--hard/i, /\bgit\s+clean\b/i, /\bcurl\b[^|]*\|\s*(ba)?sh/i, /\bwget\b[^|]*\|\s*(ba)?sh/i, /\bshutdown\b/i, /\btaskkill\b/i, /\bdrop\s+(table|database)/i, /\bnpm\s+publish/i, />\s*\/dev\/(sd|nvme)/i]
const CAUTION = [/\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|uninstall|update|upgrade)\b/i, /\bpip3?\s+(install|uninstall)/i, /\bnpx\b/i, /\bgit\s+(push|commit|merge|rebase|checkout|pull)\b/i, /\bmv\b|\bmove\b|\bcp\b|\bcopy\b/i, /\bmkdir\b|\btouch\b|\bnew-item\b/i, /\bdocker\b/i, /\bcurl\b|\bwget\b|\binvoke-webrequest\b/i, /\bkill\b/i, /\bdeploy\b/i, /\bnpm\s+run\s+(build|deploy)/i, /(^|[^>])>[^>]/]
export function commandRisk(cmd = '') {
  const c = String(cmd)
  if (REVIEW.some((r) => r.test(c))) return { level: 'review', label: 'Review carefully', why: 'Can delete data, run remote code or change things you cannot undo.' }
  if (CAUTION.some((r) => r.test(c))) return { level: 'caution', label: 'Caution', why: 'Installs packages, changes files or talks to the network.' }
  return { level: 'safe', label: 'Safe', why: 'Only reads or runs your project.' }
}
