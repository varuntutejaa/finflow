import { useState } from 'react'
import type { FormEvent } from 'react'
import { MAX_TRANSFER_AMOUNT_PAISE, formatMoney, rupeesToPaise } from '../../api'

interface Props {
  toName: string
  toUsername: string
  kicker?: string
  onConfirm: (amountPaise: number) => void
  onCancel: () => void
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function QrPayAmountPopup({ toName, toUsername, kicker = 'Scanned QR', onConfirm, onCancel }: Props) {
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const amountPaise = rupeesToPaise(amount)
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      setError('Enter a valid amount greater than ₹0.00.')
      return
    }
    if (amountPaise > MAX_TRANSFER_AMOUNT_PAISE) {
      setError(`A single transfer can be at most ${formatMoney(MAX_TRANSFER_AMOUNT_PAISE)}.`)
      return
    }
    onConfirm(amountPaise)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal-card qr-amount-modal" role="dialog" aria-modal="true" onSubmit={handleSubmit}>
        <span className="pay-confirm-kicker">{kicker}</span>
        <span className="pay-confirm-avatar" aria-hidden="true">
          {initials(toName)}
        </span>
        <h2 className="pay-confirm-name">{toName}</h2>
        <span className="pay-confirm-subtitle">@{toUsername}</span>

        <div className="amount-bare-wrap">
          <span className="amount-bare-currency">₹</span>
          <input
            type="number"
            min="0"
            step="0.01"
            className="amount-bare-input"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              setError(null)
              setAmount(e.target.value)
            }}
            autoFocus
          />
        </div>

        {error && <p className="form-error">{error}</p>}

        <button type="submit" className="primary-btn primary-btn-block">
          Continue to pay
        </button>
        <button type="button" className="link-btn" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </div>
  )
}
