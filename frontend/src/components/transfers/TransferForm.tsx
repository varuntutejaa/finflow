import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Account, UserSearchResult } from '../../api'
import {
  BUDGET_CATEGORIES,
  MAX_TRANSFER_AMOUNT_PAISE,
  rupeesToPaise,
  formatMoney,
  searchUsers,
  transfer,
  selfTransfer,
} from '../../api'
import { PinModal } from '../shared/PinModal'

export interface SettlementPrefill {
  groupId: string
  settlementId: string
  groupName: string
  toUsername: string
  toName: string
  amountPaise: number
}

interface Props {
  accounts: Account[]
  categories: string[]
  budgetingEnabled: boolean
  onTransferred: () => void
  settlementPrefill?: SettlementPrefill | null
  onSettlementPaid?: (context: { groupId: string; settlementId: string }, transactionId: string, amountPaise: number) => void
  onCancelSettlement?: () => void
}

interface PendingPersonTransfer {
  kind: 'person'
  fromAccountId: string
  fromAccountName: string
  toUsername: string
  toLabel: string
  category: string
  amountCents: number
  idempotencyKey: string
  settlementContext?: { groupId: string; settlementId: string } | null
}

interface PendingOwnTransfer {
  kind: 'own'
  fromAccountId: string
  fromAccountName: string
  toAccountId: string
  toAccountName: string
  amountCents: number
  idempotencyKey: string
}

type PendingTransfer = PendingPersonTransfer | PendingOwnTransfer

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

function formatCategoryLabel(category: string) {
  return category === 'other'
    ? 'Other (resolve later)'
    : category
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}

function loadCategoryNotes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem('finflow_category_notes') ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export function TransferForm({
  accounts,
  categories,
  budgetingEnabled,
  onTransferred,
  settlementPrefill = null,
  onSettlementPaid,
  onCancelSettlement,
}: Props) {
  const [mode, setMode] = useState<'person' | 'own'>('person')
  const [toQuery, setToQuery] = useState('')
  const [toUsername, setToUsername] = useState('')
  const [selectedRecipient, setSelectedRecipient] = useState<UserSearchResult | null>(null)
  const [suggestions, setSuggestions] = useState<UserSearchResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<string>(BUDGET_CATEGORIES[0])
  const [categoryNote, setCategoryNote] = useState('')
  const [ownFromAccountId, setOwnFromAccountId] = useState('')
  const [ownToAccountId, setOwnToAccountId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [paymentPopup, setPaymentPopup] = useState<PaymentPopup | null>(null)
  const [pending, setPending] = useState<PendingTransfer | null>(null)
  const [, setCategoryNotes] = useState<Record<string, string>>(() => loadCategoryNotes())
  const searchBoxRef = useRef<HTMLDivElement>(null)
  const quickAmounts = ['500', '1,000', '2,500', '5,000']
  const defaultAccount = accounts[0] ?? null
  const categoryOptions = useMemo(() => {
    const merged = categories.length > 0 ? [...categories] : [...BUDGET_CATEGORIES]
    if (!merged.includes('other')) merged.push('other')
    return merged
  }, [categories])
  const selectedCategory = budgetingEnabled
    ? categoryOptions.includes(category)
      ? category
      : categoryOptions[0] ?? BUDGET_CATEGORIES[0]
    : 'other'
  const categoryNoteRequired = selectedCategory === 'other'

  useEffect(() => {
    if (settlementPrefill) {
      setMode('person')
      setToUsername(settlementPrefill.toUsername)
      setToQuery(`${settlementPrefill.toName} (@${settlementPrefill.toUsername})`)
      setSelectedRecipient({
        id: settlementPrefill.toUsername,
        username: settlementPrefill.toUsername,
        name: settlementPrefill.toName,
        email: '',
        isSelf: false,
      })
      setAmount(String(settlementPrefill.amountPaise / 100))
      setError(null)
    } else {
      setToUsername('')
      setToQuery('')
      setSelectedRecipient(null)
      setAmount('')
    }
  }, [settlementPrefill])

  useEffect(() => {
    if (accounts.length === 0) return
    setOwnFromAccountId((current) => (accounts.some((a) => a.id === current) ? current : accounts[0].id))
  }, [accounts])

  useEffect(() => {
    if (accounts.length === 0) return
    setOwnToAccountId((current) => {
      if (accounts.some((a) => a.id === current) && current !== ownFromAccountId) return current
      return accounts.find((a) => a.id !== ownFromAccountId)?.id ?? ''
    })
  }, [accounts, ownFromAccountId])

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

  const switchMode = (nextMode: 'person' | 'own') => {
    if (paymentPopup || pending) return
    setMode(nextMode)
    setError(null)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (paymentPopup || pending) return
    setError(null)

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

    if (mode === 'own') {
      const fromAccount = accounts.find((a) => a.id === ownFromAccountId)
      const toAccount = accounts.find((a) => a.id === ownToAccountId)
      if (!fromAccount || !toAccount) {
        setError('Choose both a source and destination account.')
        return
      }
      if (fromAccount.id === toAccount.id) {
        setError('Choose two different accounts to transfer between.')
        return
      }

      setPending({
        kind: 'own',
        fromAccountId: fromAccount.id,
        fromAccountName: fromAccount.accountName,
        toAccountId: toAccount.id,
        toAccountName: toAccount.accountName,
        amountCents: cents,
        idempotencyKey: crypto.randomUUID(),
      })
      return
    }

    const fromAccount = defaultAccount
    if (!fromAccount) {
      setError('No source account is available right now.')
      return
    }
    if (!toUsername) {
      setError('Search for a recipient and select them from the list.')
      return
    }
    if (!settlementPrefill && categoryNoteRequired && categoryNote.trim().length === 0) {
      setError('Add a short note to explain which category this should go under.')
      return
    }

    setPending({
      kind: 'person',
      fromAccountId: fromAccount.id,
      fromAccountName: fromAccount.accountName,
      toUsername,
      toLabel: toQuery,
      category: settlementPrefill ? 'settlement' : selectedCategory,
      amountCents: cents,
      idempotencyKey: crypto.randomUUID(),
      settlementContext: settlementPrefill
        ? { groupId: settlementPrefill.groupId, settlementId: settlementPrefill.settlementId }
        : null,
    })
  }

  const confirmWithPin = async (pin: string) => {
    if (!pending) return
    const transferRequest = pending
    const recipientName =
      transferRequest.kind === 'own'
        ? transferRequest.toAccountName
        : selectedRecipient?.isSelf
          ? 'You'
          : selectedRecipient?.name ?? transferRequest.toUsername

    setPaymentPopup({
      stage: 'processing',
      amountCents: transferRequest.amountCents,
      recipientName,
    })

    try {
      const { transaction } =
        transferRequest.kind === 'own'
          ? await selfTransfer({
              fromAccountId: transferRequest.fromAccountId,
              toAccountId: transferRequest.toAccountId,
              amount: transferRequest.amountCents,
              idempotencyKey: transferRequest.idempotencyKey,
              pin,
            })
          : await transfer({
              fromAccountId: transferRequest.fromAccountId,
              toUsername: transferRequest.toUsername,
              amount: transferRequest.amountCents,
              idempotencyKey: transferRequest.idempotencyKey,
              pin,
              category: transferRequest.category,
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
      setCategory('other')
      setCategoryNote('')
      if (transferRequest.kind === 'person' && transferRequest.category === 'other' && categoryNote.trim()) {
        const note = categoryNote.trim()
        setCategoryNotes((current) => {
          const next = { ...current, [transaction.id]: note }
          localStorage.setItem('finflow_category_notes', JSON.stringify(next))
          return next
        })
      }
      if (transferRequest.kind === 'person' && transferRequest.settlementContext) {
        onSettlementPaid?.(transferRequest.settlementContext, transaction.id, transferRequest.amountCents)
      }
      onTransferred()

      await wait(10000)
      setPaymentPopup(null)
    } catch (err) {
      setPaymentPopup(null)
      // A failed attempt (e.g. insufficient funds) still persists as an audit
      // row server-side, so refresh local state to pick it up even on failure.
      onTransferred()
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
          <h2>{settlementPrefill ? 'Settle Up' : 'Send Money'}</h2>
          <p className="muted">
            {settlementPrefill
              ? `Paying your share for ${settlementPrefill.groupName}.`
              : 'Route a verified payout with live confirmation and one-step UPI authorization.'}
          </p>
        </div>
      </div>

      {settlementPrefill && (
        <div className="settlement-summary-card">
          <strong>{settlementPrefill.groupName}</strong>
          <div className="settlement-summary-row">
            <span>Paying</span>
            <span>{settlementPrefill.toName}</span>
          </div>
          <div className="settlement-summary-row">
            <span>Amount</span>
            <span>{formatMoney(settlementPrefill.amountPaise)}</span>
          </div>
          <button type="button" className="link-btn" onClick={onCancelSettlement}>
            Cancel and send a regular payment instead
          </button>
        </div>
      )}

      {!settlementPrefill && (
      <div className="transfer-mode-tabs" role="tablist" aria-label="Transfer type">
        <button
          type="button"
          className={`transfer-mode-tab${mode === 'person' ? ' transfer-mode-tab-active' : ''}`}
          onClick={() => switchMode('person')}
          aria-pressed={mode === 'person'}
        >
          Send to someone
        </button>
        <button
          type="button"
          className={`transfer-mode-tab${mode === 'own' ? ' transfer-mode-tab-active' : ''}`}
          onClick={() => switchMode('own')}
          aria-pressed={mode === 'own'}
          disabled={accounts.length < 2}
          title={accounts.length < 2 ? 'You need at least two accounts to move money between them' : undefined}
        >
          Between my accounts
        </button>
      </div>
      )}

      <form className="transfer-form" onSubmit={handleSubmit}>
        {settlementPrefill ? null : mode === 'person' ? (
          <>
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
              {budgetingEnabled && (
                <label className="gateway-label">
                  <span className="transfer-section-head">
                    <span className="transfer-section-kicker">Budget category</span>
                    <span className="transfer-section-meta">Used for monthly budget tracking</span>
                  </span>
                  <select className="gateway-select" value={selectedCategory} onChange={(e) => setCategory(e.target.value)}>
                    {categoryOptions.map((item) => (
                      <option key={item} value={item}>
                        {formatCategoryLabel(item)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {selectedCategory === 'other' && (
                <label className="gateway-label">
                  <span className="transfer-section-head">
                    <span className="transfer-section-kicker">Category note</span>
                    <span className="transfer-section-meta">Tell us which budget category this should be tracked under</span>
                  </span>
                  <textarea
                    className="gateway-textarea"
                    placeholder="e.g. Travel"
                    value={categoryNote}
                    onChange={(e) => setCategoryNote(e.target.value)}
                    rows={3}
                  />
                </label>
              )}
            </div>
          </>
        ) : (
          <div className="transfer-section">
            <label className="gateway-label">
              <span className="transfer-section-head">
                <span className="transfer-section-kicker">From account</span>
                <span className="transfer-section-meta">Where the money leaves</span>
              </span>
              <select
                className="gateway-select"
                value={ownFromAccountId}
                onChange={(e) => setOwnFromAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountName} ({formatMoney(a.balance)})
                  </option>
                ))}
              </select>
            </label>

            <label className="gateway-label">
              <span className="transfer-section-head">
                <span className="transfer-section-kicker">To account</span>
                <span className="transfer-section-meta">Where the money lands</span>
              </span>
              <select
                className="gateway-select"
                value={ownToAccountId}
                onChange={(e) => setOwnToAccountId(e.target.value)}
              >
                {accounts
                  .filter((a) => a.id !== ownFromAccountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountName} ({formatMoney(a.balance)})
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}

        {!settlementPrefill && (
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
        )}

        <button type="submit" className="primary-btn primary-btn-block" disabled={Boolean(paymentPopup || pending)}>
          {paymentPopup || pending ? 'Processing...' : settlementPrefill ? 'Pay settlement' : mode === 'own' ? 'Move money' : 'Pay'}
        </button>

        {error && <p className="form-error">{error}</p>}
      </form>

      {pending && (
        <PinModal
          title="Enter UPI PIN"
          subtitle={
            pending.kind === 'own'
              ? `Move ${formatMoney(pending.amountCents)} from ${pending.fromAccountName} to ${pending.toAccountName}`
              : `Send ${formatMoney(pending.amountCents)} from ${pending.fromAccountName} to ${pending.toLabel}`
          }
          onConfirm={confirmWithPin}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  )
}
