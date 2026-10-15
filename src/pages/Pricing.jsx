import { Link } from 'react-router-dom'
import './Landing.css'

export default function Pricing() {
  return (
    <div className="landing">
      <nav className="landing-nav">
        <Link to="/" className="landing-nav-brand">
          <div className="logo-dot" />
          STREAM
        </Link>
        <div className="landing-nav-links">
          <Link to="/features" className="landing-nav-link">Features</Link>
          <Link to="/pricing" className="landing-nav-link active">Pricing</Link>
          <Link to="/editor" className="landing-nav-cta">Open Editor →</Link>
        </div>
      </nav>

      <section className="landing-page-hero">
        <div className="landing-page-hero-inner">
          <Link to="/" className="landing-back-home">← Back to home</Link>
          <h1 className="landing-page-title">Simple pricing</h1>
          <p className="landing-page-sub">
            Start free. Upgrade when you need more.
          </p>
        </div>
      </section>

      <section className="landing-pricing">
        <div className="landing-pricing-grid">
          <PricingCard
            name="Free"
            price="₦0"
            hint="forever"
            features={[
              '20 requests / 5 hours',
              '500 requests / 2 weeks',
              'All AI models',
              'Sessions sync across devices',
              'Full editor + preview',
            ]}
            cta="Start free"
            ctaHref="/editor"
          />
          <PricingCard
            name="Pro 3×"
            price="₦3,000"
            hint="per month"
            features={[
              '60 requests / 5 hours',
              '1,500 requests / 2 weeks',
              'Priority AI speed',
              'Everything in Free',
            ]}
            cta="Choose Pro 3×"
            ctaHref="/editor"
          />
          <PricingCard
            name="Pro 5×"
            price="₦5,000"
            hint="per month"
            features={[
              '100 requests / 5 hours',
              '2,500 requests / 2 weeks',
              'Priority AI speed',
              'Everything in Free',
            ]}
            cta="Choose Pro 5×"
            ctaHref="/editor"
          />
          <PricingCard
            name="Pro 10×"
            price="₦9,000"
            hint="per month"
            features={[
              '200 requests / 5 hours',
              '5,000 requests / 2 weeks',
              'Priority AI speed',
              'Everything in Free',
            ]}
            cta="Choose Pro 10×"
            ctaHref="/editor"
            highlight={true}
          />
        </div>

        <div className="landing-pricing-note">
          All plans renew monthly. Cancel anytime. Prices in Nigerian Naira.
        </div>
      </section>

      <section className="landing-final">
        <h2 className="landing-final-title">Ready to start?</h2>
        <p className="landing-final-sub">
          Free forever plan. No card required.
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

function PricingCard({ name, price, hint, features, cta, ctaHref, highlight }) {
  return (
    <div className={`landing-pricing-card ${highlight ? 'highlight' : ''}`}>
      {highlight && <div className="landing-pricing-badge">Most popular</div>}
      <div className="landing-pricing-name">{name}</div>
      <div className="landing-pricing-price">
        <span className="landing-pricing-price-amount">{price}</span>
        <span className="landing-pricing-price-hint">{hint}</span>
      </div>
      <ul className="landing-pricing-features">
        {features.map((f, i) => (
          <li key={i}>
            <span className="landing-pricing-check">✓</span>
            {f}
          </li>
        ))}
      </ul>
      <Link to={ctaHref} className={`landing-btn ${highlight ? 'landing-btn-primary' : 'landing-btn-ghost'} landing-btn-full`}>
        {cta}
      </Link>
    </div>
  )
}