import { useEffect, useState } from 'react'
import { PinInput } from './PinInput'

interface Props {
  title: string
  subtitle: string
  onConfirm: (pin: string) => Promise<void>
  onCancel: () => void
}

export function PinModal({ title, subtitle, onConfirm, onCancel }: Props) {
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onCancel, submitting])

  const handlePay = () => {
    if (pin.length !== 4 || submitting) return
    setSubmitting(true)
    setError(null)
    onConfirm(pin)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Transfer failed')
        setPin('')
      })
      .finally(() => setSubmitting(false))
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !submitting && onCancel()}
    >
      <div className="modal-card pin-modal" role="dialog" aria-modal="true">
        <span className="pin-modal-icon">
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
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

        <p className="pin-modal-status" aria-live="polite">
          {submitting ? 'Verifying…' : error ?? ' '}
        </p>

        <button
          type="button"
          className="primary-btn primary-btn-block"
          onClick={handlePay}
          disabled={pin.length !== 4 || submitting}
        >
          {submitting ? 'Processing…' : 'Pay'}
        </button>

        <button type="button" className="link-btn" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </div>
  )
}
