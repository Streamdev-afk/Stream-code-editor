// Web search toggle for the AI (on by default; the server only searches when the question needs it)
export function getWeb() {
  try { return localStorage.getItem('qoders-web') !== 'off' } catch { return true }
}
export function setWeb(on) {
  try { localStorage.setItem('qoders-web', on ? 'on' : 'off') } catch {}
}
