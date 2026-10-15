import { Link } from 'react-router-dom'
import './Landing.css'

export default function Features() {
  return (
    <div className="landing">
      <nav className="landing-nav">
        <Link to="/" className="landing-nav-brand">
          <div className="logo-dot" />
          STREAM
        </Link>
        <div className="landing-nav-links">
          <Link to="/features" className="landing-nav-link active">Features</Link>
          <Link to="/pricing" className="landing-nav-link">Pricing</Link>
          <Link to="/editor" className="landing-nav-cta">Open Editor →</Link>
        </div>
      </nav>

      <section className="landing-page-hero">
        <div className="landing-page-hero-inner">
          <Link to="/" className="landing-back-home">← Back to home</Link>
          <h1 className="landing-page-title">Features</h1>
          <p className="landing-page-sub">
            Everything you need to build, test, and ship — without leaving your browser.
          </p>
        </div>
      </section>

      <section className="landing-features">
        <div className="landing-features-grid">
          <FeatureCard
            icon="🧭"
            title="AI that plans first"
            desc="Tell Stream what to build. It breaks the task into steps you can review, then executes them one at a time — no more one-shot prompt roulette."
          />
          <FeatureCard
            icon="📁"
            title="Real multi-file projects"
            desc="Create, rename, delete files and folders. Tabs, file tree, syntax highlighting — everything a code editor should have."
          />
          <FeatureCard
            icon="▶️"
            title="Live preview"
            desc="Watch your project render instantly. React, JSX, TypeScript, plain HTML/CSS/JS — the bundler runs in your browser."
          />
          <FeatureCard
            icon="🤖"
            title="Chat + Agent modes"
            desc="Chat for questions, planning, and ideas. Agent mode for making it happen. The AI writes directly into your files with a diff you approve."
          />
          <FeatureCard
            icon="💬"
            title="Sessions that follow you"
            desc="Every project is a session — its own files, its own chat. Sign in and your sessions sync across devices. Work from anywhere."
          />
          <FeatureCard
            icon="⚡"
            title="Thinking levels"
            desc="Low, Medium, High, or Ultra. Dial how hard the AI works on each request. Perfect for going from quick prototypes to production code."
          />
          <FeatureCard
            icon="💾"
            title="Import and export"
            desc="Drop a zip and load a project. Export your work in one click. Nothing is locked in."
          />
          <FeatureCard
            icon="📱"
            title="Works on mobile"
            desc="Full editor experience on your phone. Files, chat, code — everything adapts to touch."
          />
          <FeatureCard
            icon="🎨"
            title="Themes and settings"
            desc="Emerald, blue, purple, or sunset. Font sizes, tab widths, word wrap — tune it to how you work."
          />
          <FeatureCard
            icon="🔍"
            title="Search across files"
            desc="Find any text in any file. Ctrl+Shift+F opens a search panel with results grouped by file."
          />
          <FeatureCard
            icon="⚙️"
            title="Command palette"
            desc="Ctrl+P to jump to any file. Ctrl+Shift+P for every editor action. Built for keyboard-first workflows."
          />
          <FeatureCard
            icon="🕐"
            title="Version history"
            desc="Every AI change is snapshotted. Roll back to any point in your project's history with a click."
          />
        </div>
      </section>

      <section className="landing-final">
        <h2 className="landing-final-title">Ready to build?</h2>
        <p className="landing-final-sub">
          Open Stream and start your first project in 5 seconds.
        </p>
        <Link to="/editor" className="landing-btn landing-btn-primary landing-btn-large">
          Open Stream →
        </Link>
      </section>

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

function FeatureCard({ icon, title, desc }) {
  return (
    <div className="landing-feature-card">
      <div className="landing-feature-icon">{icon}</div>
      <div className="landing-feature-title">{title}</div>
      <div className="landing-feature-desc">{desc}</div>
    </div>
  )
}