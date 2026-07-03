import { useState } from 'react'
import type { FormEvent } from 'react'
import { setUpiPin } from '../../api'
import { PinInput } from '../shared/PinInput'

interface Props {
  name: string
  onDone: () => void
}

export function SetPinModal({ name, onDone }: Props) {
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinMasked, setPinMasked] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (pin.length !== 4) {
      setError('Enter a 4-digit UPI PIN.')
      return
    }
    if (pin !== pinConfirm) {
      setError('PINs do not match. Try again.')
      setPin('')
      setPinConfirm('')
      return
    }

    setSubmitting(true)
    try {
      await setUpiPin({ pin, pinConfirm })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set PIN')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-card pin-modal" role="dialog" aria-modal="true" onSubmit={handleSubmit}>
        <span className="pin-modal-icon">
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <h2>Set your UPI PIN</h2>
        <p className="muted">
          Welcome, {name}. Choose a 4-digit PIN — you'll enter it to approve every transfer.
        </p>

        <button
          type="button"
          className="pin-visibility-btn"
          onClick={() => setPinMasked((current) => !current)}
          aria-pressed={!pinMasked}
          aria-label={pinMasked ? 'Show PIN digits' : 'Hide PIN digits'}
        >
          <span className="pin-visibility-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              {pinMasked ? (
                <>
                  <path
                    d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 5.2A9.5 9.5 0 0112 5c6.5 0 10 7 10 7a15.8 15.8 0 01-3.4 4.3M6.5 6.5A15.8 15.8 0 002 12s3.5 7 10 7a9.5 9.5 0 003.3-.6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              ) : (
                <>
                  <path
                    d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                </>
              )}
            </svg>
          </span>
          <span>{pinMasked ? 'Show PIN' : 'Hide PIN'}</span>
        </button>

        <label className="pin-modal-label">
          PIN
          <PinInput value={pin} onChange={setPin} autoFocus masked={pinMasked} />
        </label>
        <label className="pin-modal-label">
          Confirm PIN
          <PinInput value={pinConfirm} onChange={setPinConfirm} masked={pinMasked} />
        </label>

        <p className="pin-modal-status" aria-live="polite">
          {submitting ? 'Saving…' : error ?? ' '}
        </p>

        <button type="submit" className="primary-btn primary-btn-block" disabled={submitting}>
          {submitting ? 'Saving…' : 'Set PIN'}
        </button>
      </form>
    </div>
  )
}
