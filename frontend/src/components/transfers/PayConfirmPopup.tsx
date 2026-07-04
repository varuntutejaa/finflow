import { useState } from 'react'
import { BUDGET_CATEGORIES, MAX_TRANSFER_AMOUNT_PAISE, formatMoney, rupeesToPaise } from '../../api'

interface Props {
  amountCents?: number
  amountEditable?: boolean
  recipientName: string
  recipientSubtitle?: string
  budgetingEnabled?: boolean
  categories?: string[]
  onConfirm: (details: { note: string; category: string; amountCents: number }) => void
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

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function categoryDisplayLabel(value: string) {
  return value === 'other' ? 'Settle later' : titleCase(value)
}

function hasValidCurrencyPrecision(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim())
}

export function PayConfirmPopup({
  amountCents,
  amountEditable = false,
  recipientName,
  recipientSubtitle,
  budgetingEnabled = false,
  categories,
  onConfirm,
  onCancel,
}: Props) {
  const categoryOptions = (categories && categories.length > 0 ? categories : (BUDGET_CATEGORIES as readonly string[])).filter(
    (c) => c !== 'other'
  )
  const [step, setStep] = useState<'decide' | 'confirm'>('decide')
  const [amount, setAmount] = useState('')
  const [resolvedAmountCents, setResolvedAmountCents] = useState(amountCents ?? 0)
  const [note, setNote] = useState('')
  const [category, setCategory] = useState<string>('other')
  const [error, setError] = useState<string | null>(null)

  const handleContinue = () => {
    if (!amountEditable) {
      setStep('confirm')
      return
    }
    if (!hasValidCurrencyPrecision(amount)) {
      setError('Enter an amount with at most 2 decimal places.')
      return
    }
    const cents = rupeesToPaise(amount)
    if (!Number.isInteger(cents) || cents <= 0) {
      setError('Enter a valid amount greater than ₹0.00.')
      return
    }
    if (cents > MAX_TRANSFER_AMOUNT_PAISE) {
      setError(`A single transfer can be at most ${formatMoney(MAX_TRANSFER_AMOUNT_PAISE)}.`)
      return
    }
    setError(null)
    setResolvedAmountCents(cents)
    setStep('confirm')
  }

  if (step === 'confirm') {
    return (
      <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
        <div className="modal-card pay-confirm-modal pay-confirm-modal-big" role="dialog" aria-modal="true">
          <span className="pay-confirm-kicker">Confirm payment</span>

          <div className="pay-confirm-identity">
            <span className="pay-confirm-avatar" aria-hidden="true">
              {initials(recipientName)}
            </span>
            <h2 className="pay-confirm-name">{recipientName}</h2>
            {recipientSubtitle && <span className="pay-confirm-subtitle">{recipientSubtitle}</span>}
          </div>

          <span className="pay-confirm-amount">{formatMoney(resolvedAmountCents)}</span>

          <div className="pay-confirm-review">
            <div className="pay-confirm-review-row">
              <span>Note</span>
              <strong>{note.trim() || 'None'}</strong>
            </div>
            {budgetingEnabled && (
              <div className="pay-confirm-review-row">
                <span>Budget category</span>
                <strong>{categoryDisplayLabel(category)}</strong>
              </div>
            )}
          </div>

          <div className="pay-confirm-actions">
            <button
              type="button"
              className="primary-btn primary-btn-block"
              onClick={() => onConfirm({ note, category, amountCents: resolvedAmountCents })}
            >
              Pay {formatMoney(resolvedAmountCents)}
            </button>
            <button type="button" className="link-btn" onClick={() => setStep('decide')}>
              Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card pay-confirm-modal pay-confirm-modal-big" role="dialog" aria-modal="true">
        <span className="pay-confirm-kicker">You're paying</span>

        <div className="pay-confirm-identity">
          <span className="pay-confirm-avatar" aria-hidden="true">
            {initials(recipientName)}
          </span>
          <h2 className="pay-confirm-name">{recipientName}</h2>
          {recipientSubtitle && <span className="pay-confirm-subtitle">{recipientSubtitle}</span>}
        </div>

        {amountEditable ? (
          <div className="amount-bare-wrap">
            <span className="amount-bare-currency">₹</span>
            <input
              type="number"
              min="0"
              step="0.01"
              className="amount-bare-input"
              placeholder="0"
              value={amount}
              style={{ width: `${Math.min(Math.max(amount.length || 1, 1), 11)}ch` }}
              onChange={(e) => {
                setError(null)
                setAmount(e.target.value)
              }}
              autoFocus
            />
          </div>
        ) : (
          <span className="pay-confirm-amount">{formatMoney(resolvedAmountCents)}</span>
        )}

        <div className="pay-confirm-fields">
          <div className="pay-confirm-note-row">
            <input
              type="text"
              className="pay-confirm-note-input"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 100))}
              placeholder="Add a note"
              maxLength={100}
            />
          </div>

          {budgetingEnabled && (
            <label className="pay-confirm-category-row">
              <span>Budget category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="other">Settle later</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="pay-confirm-actions">
          <button type="button" className="primary-btn primary-btn-block" onClick={handleContinue}>
            Continue
          </button>
          <button type="button" className="link-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
