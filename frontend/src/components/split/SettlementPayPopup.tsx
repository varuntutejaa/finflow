import { useState } from 'react'
import type { FormEvent } from 'react'
import { formatMoney, rupeesToPaise } from '../../api'

interface Props {
  groupName: string
  toName: string
  remainingAmount: number
  onConfirm: (amountPaise: number) => void
  onCancel: () => void
}

export function SettlementPayPopup({ groupName, toName, remainingAmount, onConfirm, onCancel }: Props) {
  const [amount, setAmount] = useState(String(remainingAmount / 100))
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const amountPaise = rupeesToPaise(amount)
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      setError('Enter a valid amount greater than ₹0.00.')
      return
    }
    if (amountPaise > remainingAmount) {
      setError(`You can pay at most ${formatMoney(remainingAmount)} — that's what's still owed.`)
      return
    }
    onConfirm(amountPaise)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal-card settlement-pay-modal" role="dialog" aria-modal="true" onSubmit={handleSubmit}>
        <span className="transfer-section-kicker">Settle up · {groupName}</span>
        <h2>Pay {toName}</h2>
        <p className="muted">You owe {formatMoney(remainingAmount)} in this group. Pay it all, or part of it now.</p>

        <label className="gateway-label">
          <span>Amount to pay</span>
          <div className="budget-input-wrap">
            <span>₹</span>
            <input
              type="number"
              min="0"
              max={remainingAmount / 100}
              step="0.01"
              value={amount}
              onChange={(e) => {
                setError(null)
                setAmount(e.target.value)
              }}
              autoFocus
            />
          </div>
        </label>

        <div className="split-participant-chips">
          <button type="button" className="split-chip" onClick={() => setAmount(String(remainingAmount / 100))}>
            Pay in full ({formatMoney(remainingAmount)})
          </button>
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
