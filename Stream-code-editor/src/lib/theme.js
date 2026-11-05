import { THEMES } from './settings'

export function applyTheme(themeKey) {
  const theme = THEMES[themeKey] || THEMES.emerald
  const root = document.documentElement

  root.style.setProperty('--accent', theme.accent)
  root.style.setProperty('--accent-hover', theme.accentHover)
  root.style.setProperty('--accent-dim', theme.accentDim)
  root.style.setProperty('--accent-glow', theme.accentGlow)

  // Logo gradient end
  root.style.setProperty('--logo-end', theme.logoEnd)

  // Also dispatch a custom event so Monaco can re-apply its theme
  window.dispatchEvent(new CustomEvent('stream-theme-change', { detail: theme }))
}