const STORAGE_KEY = 'stream-settings-v1'

export const DEFAULT_SETTINGS = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  minimap: true,
  stickyScroll: true,
  lineNumbers: true,
  fontLigatures: true,
  smoothScrolling: true,
  autoSave: true,       // save on every change (localStorage)
  autoSaveDelay: 800,   // ms
  theme: 'emerald',     // 'emerald' | 'blue' | 'purple' | 'orange'
  reduceMotion: false,
  liquid: true,            // liquid-glass motion (springy morphs, bounce)
  typingSpeed: 'normal',   // AI reply typing: slow | normal | fast
  autoFormat: true,        // tidy code the AI wrote on one long line
  formatOnPaste: false,
  autoClose: true,         // auto-close brackets and quotes
  bracketColors: true,
  indentGuides: true,
  cursorStyle: 'line',     // line | block | underline
  whitespace: 'none',      // none | boundary | all
  team: false,
     model: 'auto',
  thinking: 'medium',
  behavior: 'friendly',
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
    accent: '#8ab4ff',
    accentHover: '#9bbcff',
    accentDim: '#8ab4ff33',
    accentGlow: '#8ab4ff66',
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
  { id: 'auto', label: 'Auto', hint: 'Switches between the free models for you', badge: 'default', best: 'Everyday use. Picks a free model that is working and fast', weak: 'You cannot choose which model answers', speed: 4, power: 3, tier: 'free' },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    hint: 'Fast · good for most tasks',
    badge: 'alt', best: 'Everyday chat, small edits, quick questions', weak: 'Struggles with big multi-file builds', speed: 4, power: 2, tier: 'free',
  },
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    hint: 'Slower · smarter for complex agent tasks',
    badge: 'pro', best: 'Complex agent tasks, planning, debugging', weak: 'Slower than the 20B', speed: 3, power: 4, tier: 'free',
  },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B', hint: 'Free model · quick and clear', badge: 'alt', best: 'Clear explanations, light coding (free)', weak: 'Limited on big projects; free queue can be busy', speed: 3, power: 2, tier: 'free', },
  { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron Lightning', hint: 'Free model · very fast', badge: 'alt', best: 'Fast answers and small fixes (free)', weak: 'Simple tasks only', speed: 5, power: 2, tier: 'free', },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B', hint: 'Free model · stronger', badge: 'pro', best: 'Stronger coding and writing (free)', weak: 'Slower in busy hours', speed: 3, power: 3, tier: 'go', },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Nemotron Reasoning', hint: 'Free model · thinks first', badge: 'pro', best: 'Step-by-step reasoning, bug hunting (free)', weak: 'Thinks first, so replies take longer', speed: 2, power: 3, tier: 'go', },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron Ultra 550B', hint: 'Frontier size · best for hard tasks', badge: 'pro', best: 'Hard problems, big thinking (free)', weak: 'Often queued. Falls back to a faster model after 20s', speed: 1, power: 5, tier: 'go', },
  {
    id: 'qwen/qwen3.8-27b',
    label: 'Qwen 3.8 27B',
    hint: 'Vision-capable · good balance',
    badge: 'alt', best: 'Reading screenshots, balanced coding', weak: 'Mid-size, not for the hardest jobs', speed: 3, power: 3, tier: 'go',
  },
]

export const THINKING_LEVELS = [
  {
    id: 'low',
    label: 'Low',
    hint: 'Fast · 1 credit',
    multiplier: 1,
    badge: 'fast',
  },
  {
    id: 'medium',
    label: 'Medium',
    hint: 'Balanced · 2 credits',
    multiplier: 2,
    badge: 'default',
  },
  {
    id: 'high',
    label: 'High',
    hint: 'Deep thinking · 4 credits',
    multiplier: 4,
    badge: 'pro',
  },
  {
    id: 'ultra',
    label: 'Ultra',
    hint: 'Maximum effort · 8 credits',
    multiplier: 8,
    badge: 'ultra',
  },
]