import { useEffect, useState } from 'react'
import { PinInput } from './PinInput'

interface Props {
  title: string
  subtitle: string
  confirmLabel?: string
  submittingLabel?: string
  errorFallback?: string
  onConfirm: (pin: string) => Promise<void>
  onCancel: () => void
  onAccountLocked?: (unlockAt: string) => void
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export function PinModal({
  title,
  subtitle,
  confirmLabel = 'Pay',
  submittingLabel = 'Processing…',
  errorFallback = 'Transfer failed',
  onConfirm,
  onCancel,
  onAccountLocked,
}: Props) {
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null)
  const [lockedUntil, setLockedUntil] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onCancel, submitting])

  useEffect(() => {
    if (!lockedUntil) return
    const handle = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(handle)
  }, [lockedUntil])

  const handlePay = () => {
    if (pin.length !== 4 || submitting) return
    setSubmitting(true)
    setError(null)
    onConfirm(pin)
      .catch((err) => {
        const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined
        const unlockAt = err instanceof Error ? (err as Error & { unlockAt?: string }).unlockAt : undefined
        const remaining = err instanceof Error ? (err as Error & { attemptsRemaining?: number }).attemptsRemaining : undefined
        if (code === 'ACCOUNT_LOCKED' && unlockAt) {
          setLockedUntil(unlockAt)
          onAccountLocked?.(unlockAt)
        } else if (typeof remaining === 'number') {
          setAttemptsRemaining(remaining)
        }
        setError(err instanceof Error ? err.message : errorFallback)
        setPin('')
      })
      .finally(() => setSubmitting(false))
  }

  if (lockedUntil) {
    const msRemaining = new Date(lockedUntil).getTime() - now
    return (
      <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
        <div className="modal-card pin-modal pin-modal-locked" role="dialog" aria-modal="true">
          <span className="pin-modal-icon pin-modal-icon-danger">
            <LockIcon />
          </span>
          <h2>Account locked</h2>
          <p className="muted">
            Too many incorrect PIN attempts. For your security, payments are locked on this account for 24 hours.
          </p>
          {msRemaining > 0 && <span className="pin-lockout-countdown">{formatCountdown(msRemaining)}</span>}
          <p className="muted pin-lockout-hint">Unlocks {new Date(lockedUntil).toLocaleString()}</p>

          <button type="button" className="secondary-btn primary-btn-block" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !submitting && onCancel()}
    >
      <div className="modal-card pin-modal" role="dialog" aria-modal="true">
        <span className="pin-modal-icon">
          <LockIcon />
        </span>
        <h2>{title}</h2>
        <p className="muted">{subtitle}</p>

        <PinInput
          value={pin}
          onChange={(v) => {
            setError(null)
            setPin(v)
          }}
          autoFocus
        />

        <p
          className={`pin-modal-status${attemptsRemaining !== null && attemptsRemaining <= 1 ? ' pin-modal-status-warning' : ''}`}
          aria-live="polite"
        >
          {submitting ? 'Verifying…' : error ?? ' '}
        </p>

        <button
          type="button"
          className="primary-btn primary-btn-block"
          onClick={handlePay}
          disabled={pin.length !== 4 || submitting}
        >
          {submitting ? submittingLabel : confirmLabel}
        </button>

        <button type="button" className="link-btn" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </div>
  )
}
