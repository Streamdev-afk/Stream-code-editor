const STORAGE_KEY = 'stream-settings-v1'

export const DEFAULT_SETTINGS = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  minimap: false,
  lineNumbers: true,
  fontLigatures: true,
  smoothScrolling: true,
  autoSave: true,       // save on every change (localStorage)
  autoSaveDelay: 800,   // ms
  theme: 'emerald',     // 'emerald' | 'blue' | 'purple' | 'orange'
  reduceMotion: false,
   model: 'openai/gpt-oss-20b',
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    console.warn('Failed to save settings:', e)
  }
}

export const THEMES = {
  emerald: {
    label: 'Emerald',
    accent: '#10b981',
    accentHover: '#34d399',
    accentDim: '#10b98133',
    accentGlow: '#10b98166',
    logoEnd: '#22d3ee',
  },
  blue: {
    label: 'Blue',
    accent: '#58a6ff',
    accentHover: '#79b8ff',
    accentDim: '#58a6ff33',
    accentGlow: '#58a6ff66',
    logoEnd: '#a371f7',
  },
  purple: {
    label: 'Purple',
    accent: '#a371f7',
    accentHover: '#b48cff',
    accentDim: '#a371f733',
    accentGlow: '#a371f766',
    logoEnd: '#f778ba',
  },
  orange: {
    label: 'Sunset',
    accent: '#f97316',
    accentHover: '#fb923c',
    accentDim: '#f9731633',
    accentGlow: '#f9731666',
    logoEnd: '#ef4444',
  },
}

export const AVAILABLE_MODELS = [
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    hint: 'Fast · good for most tasks',
    badge: 'default',
  },
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    hint: 'Slower · smarter for complex agent tasks',
    badge: 'pro',
  },
  {
    id: 'qwen/qwen3.8-27b',
    label: 'Qwen 3.8 27B',
    hint: 'Vision-capable · good balance',
    badge: 'alt',
  },
]