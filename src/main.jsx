import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import './index.css'
import App from './App.jsx'
import Landing from './pages/Landing.jsx'
import Features from './pages/Features.jsx'
import Pricing from './pages/Pricing.jsx'
import { API_BASE } from './lib/api'

// wake the free backend as soon as the site opens
try { fetch(`${API_BASE}/api/health`).catch(() => {}) } catch {}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
    document.querySelectorAll('.landing, body, html, #root').forEach((el) => {
      el.scrollTop = 0
    })
  }, [pathname])
  return null
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/features" element={<Features />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/editor" element={<App />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
