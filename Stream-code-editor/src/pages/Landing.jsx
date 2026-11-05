import { Link } from 'react-router-dom'
import './Landing.css'

export default function Landing() {
  return (
    <div className="landing">
      {/* ---- Navbar ---- */}
      <nav className="landing-nav">
        <Link to="/" className="landing-nav-brand">
          <div className="logo-dot" />
          STREAM
        </Link>
        <div className="landing-nav-links">
          <Link to="/features" className="landing-nav-link">Features</Link>
          <Link to="/pricing" className="landing-nav-link">Pricing</Link>
          <Link to="/editor" className="landing-nav-cta">Open Editor →</Link>
        </div>
      </nav>

      {/* ---- Hero ---- */}
      <section className="landing-hero">
        <div className="landing-hero-badge">
          <span className="landing-hero-badge-dot" />
          AI-powered code editor in your browser
        </div>
        <h1 className="landing-hero-title">
          Code with an AI that
          <br />
          <span className="landing-hero-accent">thinks in steps.</span>
        </h1>
        <p className="landing-hero-sub">
          Stream is a browser-based code editor where the AI doesn't just answer questions —
          it plans, writes, tests, and fixes your code across multiple files.
          No install. No setup. Just open and build.
        </p>
        <div className="landing-hero-actions">
          <Link to="/editor" className="landing-btn landing-btn-primary">
            Open Stream →
          </Link>
          <Link to="/features" className="landing-btn landing-btn-ghost">
            See features
          </Link>
        </div>
        <div className="landing-hero-hint">
          Free to try · No signup required · Works on any device
        </div>
      </section>

      {/* ---- Stats bar ---- */}
      <section className="landing-stats">
        <div className="landing-stats-grid">
          <Stat icon="🌐" num="90+" label="Languages highlighted" />
          <Stat icon="⚡" num="0 sec" label="Setup time" />
          <Stat icon="🧭" num="3 modes" label="Chat · Agent · Plan" />
          <Stat icon="💎" num="4 tiers" label="Free to Pro 10×" />
        </div>
      </section>

      {/* ---- Screenshot ---- */}
      <section className="landing-screenshot">
        <div className="landing-screenshot-frame">
          <div className="landing-screenshot-bar">
            <span className="landing-screenshot-dot" />
            <span className="landing-screenshot-dot" />
            <span className="landing-screenshot-dot" />
          </div>
          <div className="landing-screenshot-body">
            <img
              src="/screenshot.png"
              alt="Stream editor"
              className="landing-screenshot-img"
              onError={(e) => {
                e.target.style.display = 'none'
                if (!e.target.parentElement.querySelector('.landing-screenshot-placeholder')) {
                  const ph = document.createElement('div')
                  ph.className = 'landing-screenshot-placeholder'
                  ph.textContent = 'Screenshot coming soon — open the editor to see it live'
                  e.target.parentElement.appendChild(ph)
                }
              }}
            />
          </div>
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section className="landing-how">
        <h2 className="landing-section-title">How it works</h2>
        <p className="landing-section-sub">
          From idea to running code in four steps.
        </p>
        <div className="landing-how-grid">
          <HowStep
            num="1"
            title="Describe it"
            desc="Tell the AI what you want to build — a landing page, a game, an app."
          />
          <HowStep
            num="2"
            title="Review the plan"
            desc="Stream breaks the task into steps. Edit the plan, skip what you don't need."
          />
          <HowStep
            num="3"
            title="Watch it build"
            desc="The AI executes each step. Files get created. Preview updates live."
          />
          <HowStep
            num="4"
            title="Ship it"
            desc="Download as zip, share the live URL, or keep building with more prompts."
          />
        </div>
      </section>

      {/* ---- Final CTA ---- */}
      <section className="landing-final">
        <h2 className="landing-final-title">Ready to build?</h2>
        <p className="landing-final-sub">
          Open Stream and start your first project in 5 seconds.
        </p>
        <Link to="/editor" className="landing-btn landing-btn-primary landing-btn-large">
          Open Stream →
        </Link>
      </section>

      {/* ---- Footer ---- */}
      <footer className="landing-footer">
        <div className="landing-footer-brand">
          <div className="logo-dot" />
          STREAM
        </div>
        <div className="landing-footer-copy">
          © {new Date().getFullYear()} Stream. Built with Stream.
        </div>
      </footer>
    </div>
  )
}

function Stat({ icon, num, label }) {
  return (
    <div className="landing-stat">
      <div className="landing-stat-icon">{icon}</div>
      <div className="landing-stat-num">{num}</div>
      <div className="landing-stat-label">{label}</div>
    </div>
  )
}

function HowStep({ num, title, desc }) {
  return (
    <div className="landing-how-step">
      <div className="landing-how-num">{num}</div>
      <div className="landing-how-title">{title}</div>
      <div className="landing-how-desc">{desc}</div>
    </div>
  )
}