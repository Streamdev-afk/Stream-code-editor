// Finds the newest desktop installer for the visitor's computer, from the public releases repo.
const REPO = import.meta.env.VITE_RELEASES_REPO || 'Streamdev-afk/ion-qoders-releases'
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

export const inDesktopApp = () => typeof window !== 'undefined' && !!window.desktop?.isDesktop

export function detectOS() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''
  if (/android|iphone|ipad|ipod/i.test(ua)) return null // no desktop app for phones
  if (/win/i.test(ua)) return 'win'
  if (/mac/i.test(ua)) return 'mac'
  if (/linux|x11/i.test(ua)) return 'linux'
  return null
}

const OS_NAME = { win: 'Windows', mac: 'macOS', linux: 'Linux' }
const OS_EXT = { win: /\.exe$/i, mac: /\.dmg$/i, linux: /\.AppImage$/i }
export const osName = (os) => OS_NAME[os] || ''

/** { url, version } for this computer's installer; falls back to the releases page. */
export async function getDesktopDownload() {
  const os = detectOS()
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (r.ok) {
      const j = await r.json()
      const asset = (j.assets || []).find((a) => os && OS_EXT[os].test(a.name) && !/blockmap/i.test(a.name))
      if (asset) return { url: asset.browser_download_url, version: String(j.tag_name || '').replace(/^v/, ''), os }
    }
  } catch { /* offline or rate limited: use the page */ }
  return { url: RELEASES_PAGE, version: '', os }
}

export async function startDesktopDownload() {
  const d = await getDesktopDownload()
  window.location.href = d.url
  return d
}
