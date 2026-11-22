// Where the three big panels sit (the terminal always stays at the bottom) and the order of the side bar icons
export const PANELS = ['sidebar', 'editor', 'ai']
export const SB_TABS = ['explorer', 'search', 'history', 'git', 'outline']

export function normalizeOrder(order, aiSide) {
  if (Array.isArray(order) && order.length === 3 && PANELS.every((p) => order.includes(p))) return order
  return aiSide === 'left' ? ['ai', 'sidebar', 'editor'] : ['sidebar', 'editor', 'ai']
}
export function normalizeSb(order) {
  const base = Array.isArray(order) ? order.filter((t) => SB_TABS.includes(t)) : []
  return [...new Set([...base, ...SB_TABS])]
}
// two items trade places
export function swapIn(list, a, b) {
  const i = list.indexOf(a); const j = list.indexOf(b)
  if (i < 0 || j < 0 || i === j) return list
  const out = [...list]; out[i] = b; out[j] = a
  return out
}
