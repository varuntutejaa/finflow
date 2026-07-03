import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Account, UserSearchResult } from '../../api'
import { MAX_TRANSFER_AMOUNT_PAISE, rupeesToPaise, formatMoney, searchUsers, transfer } from '../../api'
import { PinModal } from '../shared/PinModal'

interface Props {
  accounts: Account[]
  onTransferred: () => void
}

interface PendingTransfer {
  fromAccountId: string
  fromAccountName: string
  toUsername: string
  toLabel: string
  amountCents: number
  idempotencyKey: string
}

interface PaymentPopup {
  stage: 'processing' | 'done'
  amountCents: number
  recipientName: string
  transactionId?: string
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function hasValidCurrencyPrecision(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim())
}

export function TransferForm({ accounts, onTransferred }: Props) {
  const [toQuery, setToQuery] = useState('')
  const [toUsername, setToUsername] = useState('')
  const [selectedRecipient, setSelectedRecipient] = useState<UserSearchResult | null>(null)
  const [suggestions, setSuggestions] = useState<UserSearchResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [paymentPopup, setPaymentPopup] = useState<PaymentPopup | null>(null)
  const [pending, setPending] = useState<PendingTransfer | null>(null)
  const searchBoxRef = useRef<HTMLDivElement>(null)
  const quickAmounts = ['500', '1,000', '2,500', '5,000']
  const defaultAccount = accounts[0] ?? null

  useEffect(() => {
    if (toUsername || toQuery.trim().length === 0) {
      queueMicrotask(() => setSuggestions([]))
      return
    }
    const handle = setTimeout(() => {
      searchUsers(toQuery.trim())
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
    }, 250)
    return () => clearTimeout(handle)
  }, [toQuery, toUsername])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectRecipient = (user: UserSearchResult) => {
    setToUsername(user.username)
    setToQuery(`${user.name} (@${user.username})`)
    setSelectedRecipient(user)
    setShowSuggestions(false)
  }

  const applyQuickAmount = (value: string) => {
    setAmount(value.replace(/,/g, ''))
    setError(null)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (paymentPopup || pending) return
    setError(null)

    const fromAccount = defaultAccount
    if (!fromAccount) {
      setError('No source account is available right now.')
      return
    }
    if (!toUsername) {
      setError('Search for a recipient and select them from the list.')
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

    setPending({
      fromAccountId: fromAccount.id,
      fromAccountName: fromAccount.accountName,
      toUsername,
      toLabel: toQuery,
      amountCents: cents,
      idempotencyKey: crypto.randomUUID(),
    })
  }

  const confirmWithPin = async (pin: string) => {
    if (!pending) return
    const transferRequest = pending
    const recipientName = selectedRecipient?.isSelf ? 'You' : selectedRecipient?.name ?? transferRequest.toUsername

    setPaymentPopup({
      stage: 'processing',
      amountCents: transferRequest.amountCents,
      recipientName,
    })

    try {
      const { transaction } = await transfer({
        fromAccountId: transferRequest.fromAccountId,
        toUsername: transferRequest.toUsername,
        amount: transferRequest.amountCents,
        idempotencyKey: transferRequest.idempotencyKey,
        pin,
      })
      setPending(null)

      await wait(2000)
      setPaymentPopup({
        stage: 'done',
        amountCents: transferRequest.amountCents,
        recipientName,
        transactionId: transaction.id.slice(0, 8),
      })

      setAmount('')
      setToQuery('')
      setToUsername('')
      setSelectedRecipient(null)
      onTransferred()

      await wait(10000)
      setPaymentPopup(null)
    } catch (err) {
      setPaymentPopup(null)
      throw err
    }
  }

  return (
    <section className="panel transfer-panel">
      {paymentPopup && (
        <div
          className={`payment-status-popup payment-status-popup-${paymentPopup.stage}`}
          role="status"
          aria-live="polite"
        >
          <div className="payment-status-icon" aria-hidden="true">
            {paymentPopup.stage === 'processing' ? (
              <span className="payment-spinner" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12.5l4.2 4.2L19 7"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
          <div className="payment-status-copy">
            <strong>{paymentPopup.stage === 'processing' ? 'Sending payment...' : 'Payment done'}</strong>
            <span>
              {formatMoney(paymentPopup.amountCents)} {paymentPopup.stage === 'processing' ? 'is on the way to' : 'sent to'}{' '}
              {paymentPopup.recipientName}
            </span>
            {paymentPopup.transactionId && (
              <span className="payment-status-meta">Txn #{paymentPopup.transactionId}</span>
            )}
          </div>
        </div>
      )}

      <div className="transfer-panel-head">
        <div>
          <h2>Send Money</h2>
          <p className="muted">Route a verified payout with live confirmation and one-step UPI authorization.</p>
        </div>
      </div>
      <form className="transfer-form" onSubmit={handleSubmit}>
        <div className="search-field" ref={searchBoxRef}>
          <label className="gateway-label">
            <span className="transfer-section-head">
              <span className="transfer-section-kicker">Recipient</span>
              <span className="transfer-section-meta">Search by username, name, or email</span>
            </span>
            <div className="input-with-icon">
              <svg className="input-icon" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search by username, name, or email..."
                value={toQuery}
                autoComplete="off"
                onChange={(e) => {
                  setToQuery(e.target.value)
                  setToUsername('')
                  setSelectedRecipient(null)
                  setShowSuggestions(true)
                }}
                onFocus={() => setShowSuggestions(true)}
              />
            </div>
          </label>
          {!selectedRecipient && toQuery.trim().length > 0 && suggestions.length === 0 && (
            <p className="transfer-search-hint">No matches yet. Try a username, full name, or email.</p>
          )}
          {showSuggestions && suggestions.length > 0 && (
            <ul className="suggestions-list">
              {suggestions.map((user) => (
                <li key={user.id}>
                  <button type="button" onClick={() => selectRecipient(user)}>
                    <span className="suggestion-main">
                      <span className="suggestion-name-row">
                        <span className="suggestion-name">{user.isSelf ? 'You' : user.name}</span>
                        <span className="suggestion-username">@{user.username}</span>
                      </span>
                      <span className="suggestion-email">{user.email}</span>
                    </span>
                    <span className="suggestion-meta">{user.isSelf ? 'Your account' : 'FinFlow user'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selectedRecipient && (
          <div className="recipient-card" aria-live="polite">
            <div className="recipient-card-avatar">{selectedRecipient.name.slice(0, 1).toUpperCase()}</div>
            <div className="recipient-card-copy">
              <strong>{selectedRecipient.isSelf ? 'You' : selectedRecipient.name}</strong>
              <span>@{selectedRecipient.username}</span>
              <span>{selectedRecipient.email}</span>
            </div>
            <div className="recipient-card-status">
              <span className="recipient-card-chip">Verified payee</span>
              <span className="recipient-card-note">Eligible for instant transfer</span>
            </div>
          </div>
        )}

        <div className="transfer-section">
          <label className="gateway-label">
            <span className="transfer-section-head">
              <span className="transfer-section-kicker">Payout amount</span>
              <span className="transfer-section-meta">Up to {formatMoney(MAX_TRANSFER_AMOUNT_PAISE)} per transfer</span>
            </span>
            <div className="input-with-icon">
              <span className="input-icon input-icon-text">₹</span>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </label>

          <div className="amount-presets" aria-label="Quick amounts">
            {quickAmounts.map((value) => (
              <button key={value} type="button" className="amount-preset" onClick={() => applyQuickAmount(value)}>
                ₹{value}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" className="primary-btn primary-btn-block" disabled={Boolean(paymentPopup || pending)}>
          {paymentPopup || pending ? 'Processing...' : 'Pay'}
        </button>

        {error && <p className="form-error">{error}</p>}
      </form>

      {pending && (
        <PinModal
          title="Enter UPI PIN"
          subtitle={`Send ${formatMoney(pending.amountCents)} from ${pending.fromAccountName} to ${pending.toLabel}`}
          onConfirm={confirmWithPin}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  )
}
