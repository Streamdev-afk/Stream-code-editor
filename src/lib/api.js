// API base URL — overridden by VITE_API_URL in production.
// In dev, defaults to localhost:3001.
export const API_BASE =
  import.meta.env.VITE_API_URL || 'http://localhost:3001'