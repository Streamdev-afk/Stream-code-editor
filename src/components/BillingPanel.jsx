import { useState, useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { getSubscription, cancelSubscription } from '../lib/paystack'

const TIER_LABELS = {
  free: 'Free',
  go: 'Go',
  plus: 'Plus',
  pro: 'Pro',
  max: 'Max',
  pro3x: 'Pro 3×',
  pro5x: 'Pro 5×',
  pro10x: 'Pro 10×',
}

export default function BillingPanel({ onUpgrade }) {
  const { user } = useAuth()
  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const s = await getSubscription()
        if (!cancelled) setSub(s)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user])

  const handleCancel = async () => {
    if (!confirm('Cancel your subscription? You\'ll keep access until the end of the current period.')) return
    setCancelling(true)
    setError(null)
    try {
      const updated = await cancelSubscription()
      setSub(updated)
    } catch (err) {
      setError(err.message)
    } finally {
      setCancelling(false)
    }
  }

  if (!user) {
    return (
      <div className="billing-empty">
        Sign in to manage your subscription.
      </div>
    )
  }

  if (loading) {
    return <div className="billing-empty">Loading…</div>
  }

  const tier = sub?.tier || 'free'
  const isPro = tier !== 'free'
  const status = sub?.status || 'inactive'

  return (
    <div className="billing-panel">
      <div className="billing-current">
        <div className="billing-tier">
          <span className={`billing-tier-badge billing-tier-${tier}`}>
            {tier === 'free' ? '⭐' : '💎'} {TIER_LABELS[tier] || tier}
          </span>
          {isPro && status && (
            <span className={`billing-status billing-status-${status}`}>
              {status}
            </span>
          )}
        </div>
        {sub?.current_period_end && (
          <div className="billing-period">
            {status === 'active' ? 'Renews' : 'Ends'} {new Date(sub.current_period_end).toLocaleDateString()}
          </div>
        )}
      </div>

      {error && <div className="billing-error">⚠️ {error}</div>}

      <div className="billing-upgrade">
        <div className="billing-upgrade-title">{isPro ? 'Your plan comes from your ION account' : 'Upgrade your plan'}</div>
        <div className="billing-upgrade-limits">
          Plans are bought, changed and cancelled in the ION app (Plans page) with this same login. Your editor plan updates by itself{tier === 'max' || tier === 'pro' ? ' and you already have the frontier models.' : ': Go adds more models, Plus better models, Pro and Max frontier models.'}
        </div>
      </div>
    </div>
  )
}
