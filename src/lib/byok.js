// Your own AI provider key. Saved only in this browser, sent with each AI request,
// and never stored on our server.
const KEY = 'ion-qoders-byok'

export const PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter', hint: 'One key for hundreds of models', model: 'anthropic/claude-sonnet-4.5' },
  { id: 'openai', label: 'ChatGPT (OpenAI)', hint: 'platform.openai.com keys', model: 'gpt-4o' },
  { id: 'gemini', label: 'Google Gemini (AI Studio)', hint: 'Free tier on aistudio.google.com keys', model: 'gemini-2.5-flash' },
  { id: 'anthropic', label: 'Claude (Anthropic)', hint: 'console.anthropic.com keys', model: 'claude-sonnet-4-5' },
  { id: 'xai', label: 'xAI (Grok)', hint: 'console.x.ai keys', model: 'grok-4' },
  { id: 'cerebras', label: 'Cerebras', hint: 'Very fast, free tier', model: 'llama-3.3-70b' },
  { id: 'nvidia', label: 'NVIDIA NIM', hint: 'build.nvidia.com free keys', model: 'meta/llama-3.3-70b-instruct' },
  { id: 'fireworks', label: 'Fireworks AI', hint: 'Open models', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct' },
  { id: 'deepseek', label: 'DeepSeek', hint: 'Low cost, strong at code', model: 'deepseek-chat' },
  { id: 'together', label: 'Together AI', hint: 'Open models', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { id: 'mistral', label: 'Mistral', hint: 'mistral.ai keys', model: 'mistral-large-latest' },
  { id: 'groq', label: 'Groq (your own key)', hint: 'Your own Groq limits', model: 'llama-3.3-70b-versatile' },
  { id: 'custom', label: 'Other (OpenAI-compatible)', hint: 'Any provider with a base URL', model: '' },
]

export function getByok() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v && typeof v === 'object' ? v : null
  } catch { return null }
}

export function setByok(v) {
  try {
    if (!v) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(v))
    window.dispatchEvent(new Event('byok-changed'))
  } catch {}
}

export function byokActive() {
  const b = getByok()
  return !!(b && b.enabled && b.key && b.model && (b.provider !== 'custom' || b.base))
}

export function byokHeaders() {
  if (!byokActive()) return {}
  const b = getByok()
  const h = { 'x-ai-provider': b.provider, 'x-ai-key': b.key, 'x-ai-model': b.model }
  if (b.provider === 'custom') h['x-ai-base'] = b.base
  return h
}
