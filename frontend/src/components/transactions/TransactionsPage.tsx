import { useEffect, useMemo, useState } from 'react'
import type { Account, Transaction } from '../../api'
import { downloadTransactionsCsv, fetchTransactions, formatMoney, updateTransaction } from '../../api'
import { DirectionIcon } from './DirectionIcon'

interface Props {
  accounts: Account[]
  categories: string[]
  currentUsername: string
  onBack: () => void
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function describeCounterparty(tx: Transaction, currentUsername: string) {
  if (tx.fromUsername === tx.toUsername) return `${tx.fromAccountName} → ${tx.toAccountName}`
  const outgoing = tx.fromUsername === currentUsername
  return outgoing ? `To ${tx.toName} (@${tx.toUsername})` : `From ${tx.fromName} (@${tx.fromUsername})`
}

type DatePreset = 'all' | 'today' | 'yesterday' | 'last7days' | 'thisMonth' | 'lastMonth' | 'custom'

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  all: 'All time',
  today: 'Today',
  yesterday: 'Yesterday',
  last7days: 'Last 7 days',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  custom: 'Custom range',
}

function startOfDayUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

function endOfDayUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)).toISOString()
}

function computePresetRange(preset: DatePreset): { dateFrom: string; dateTo: string } | null {
  const now = new Date()
  switch (preset) {
    case 'today':
      return { dateFrom: startOfDayUtc(now), dateTo: endOfDayUtc(now) }
    case 'yesterday': {
      const y = new Date(now)
      y.setUTCDate(y.getUTCDate() - 1)
      return { dateFrom: startOfDayUtc(y), dateTo: endOfDayUtc(y) }
    }
    case 'last7days': {
      const from = new Date(now)
      from.setUTCDate(from.getUTCDate() - 6)
      return { dateFrom: startOfDayUtc(from), dateTo: endOfDayUtc(now) }
    }
    case 'thisMonth': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      return { dateFrom: startOfDayUtc(from), dateTo: endOfDayUtc(now) }
    }
    case 'lastMonth': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
      return { dateFrom: startOfDayUtc(from), dateTo: endOfDayUtc(to) }
    }
    default:
      return null
  }
}

const AMOUNT_PRESETS: Array<{ label: string; min: string; max: string }> = [
  { label: '₹0 – 500', min: '0', max: '500' },
  { label: '₹500 – 2,000', min: '500', max: '2000' },
  { label: '₹2,000 – 5,000', min: '2000', max: '5000' },
  { label: '₹5,000+', min: '5000', max: '' },
]

export function TransactionsPage({ accounts, categories, currentUsername, onBack }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportingCsv, setExportingCsv] = useState(false)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [accountId, setAccountId] = useState('')
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [direction, setDirection] = useState<'' | 'sent' | 'received'>('')
  const [status, setStatus] = useState<'' | 'completed' | 'failed'>('')
  const [referenceId, setReferenceId] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCategory, setEditCategory] = useState('')
  const [editNote, setEditNote] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const handleDatePreset = (preset: DatePreset) => {
    setDatePreset(preset)
    const range = computePresetRange(preset)
    if (range) {
      setDateFrom(range.dateFrom.slice(0, 10))
      setDateTo(range.dateTo.slice(0, 10))
    } else if (preset === 'all') {
      setDateFrom('')
      setDateTo('')
    }
  }

  const applyAmountPreset = (min: string, max: string) => {
    setMinAmount(min)
    setMaxAmount(max)
  }

  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      category: category || undefined,
      accountId: accountId || undefined,
      dateFrom: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined,
      dateTo: dateTo ? `${dateTo}T23:59:59.999Z` : undefined,
      minAmount: minAmount ? Math.round(Number(minAmount) * 100) : undefined,
      maxAmount: maxAmount ? Math.round(Number(maxAmount) * 100) : undefined,
      direction: direction || undefined,
      status: status || undefined,
      referenceId: referenceId.trim() || undefined,
    }),
    [search, category, accountId, dateFrom, dateTo, minAmount, maxAmount, direction, status, referenceId]
  )

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      setLoading(true)
      fetchTransactions(filters)
        .then((data) => {
          if (cancelled) return
          setTransactions(data)
          setError(null)
        })
        .catch((err) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : 'Could not load transactions')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [filters])

  const clearFilters = () => {
    setSearch('')
    setCategory('')
    setAccountId('')
    setDatePreset('all')
    setDateFrom('')
    setDateTo('')
    setMinAmount('')
    setMaxAmount('')
    setDirection('')
    setStatus('')
    setReferenceId('')
  }

  const hasActiveFilters = Boolean(
    search || category || accountId || dateFrom || dateTo || minAmount || maxAmount || direction || status || referenceId
  )

  const startEdit = (tx: Transaction) => {
    setEditingId(tx.id)
    setEditCategory(tx.category)
    setEditNote(tx.note ?? '')
  }

  const cancelEdit = () => setEditingId(null)

  const saveEdit = async (tx: Transaction) => {
    setSavingEdit(true)
    setError(null)
    try {
      const updated = await updateTransaction(tx.id, { category: editCategory, note: editNote.trim() || null })
      setTransactions((current) => current.map((t) => (t.id === tx.id ? updated : t)))
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes')
    } finally {
      setSavingEdit(false)
    }
  }

  const exportCsv = async () => {
    setExportingCsv(true)
    setError(null)
    try {
      await downloadTransactionsCsv(filters)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export transactions')
    } finally {
      setExportingCsv(false)
    }
  }

  // Merge in the categories the app tags automatically (internal transfers and
  // settlement payments) — they won't be in the budget category list unless
  // the user happens to have created a matching budget for them.
  const categoryOptions = useMemo(() => {
    const known = new Set([...categories, 'transfer', 'settlement', ...transactions.map((t) => t.category)])
    return [...known].sort()
  }, [categories, transactions])

  return (
    <section className="budget-page">
      <div className="budget-page-head">
        <div>
          <span className="transfer-section-kicker">Transaction management</span>
          <h1>Transaction History</h1>
          <p className="muted">Search, filter, categorize, and export your full payment history.</p>
        </div>
        <button type="button" className="link-btn" onClick={onBack}>
          Back to dashboard
        </button>
      </div>

      <div className="app-layout tx-page-layout">
      <div className="app-col tx-filters-col">
      <section className="panel tx-filters-panel">
        <div className="tx-filters-row tx-filters-row-full">
          <label className="gateway-label tx-filters-search">
            <span>Recipient / Sender</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, username, description, or note..."
            />
          </label>
        </div>

        <div className="tx-filters-row">
          <label className="gateway-label">
            <span>Transaction type</span>
            <select className="gateway-select" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="">Sent & received</option>
              <option value="sent">Sent</option>
              <option value="received">Received</option>
            </select>
          </label>

          <label className="gateway-label">
            <span>Status</span>
            <select className="gateway-select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="">Any status</option>
              <option value="completed">Successful</option>
              <option value="failed">Failed</option>
            </select>
          </label>
        </div>

        <div className="tx-filters-row">
          <label className="gateway-label">
            <span>Purpose (category)</span>
            <select className="gateway-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {titleCase(c)}
                </option>
              ))}
            </select>
          </label>

          <label className="gateway-label">
            <span>Bank account</span>
            <select className="gateway-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="tx-filters-row">
          <label className="gateway-label">
            <span>Reference ID</span>
            <input
              type="text"
              value={referenceId}
              onChange={(e) => setReferenceId(e.target.value)}
              placeholder="Transaction or idempotency ID"
            />
          </label>

          <label className="gateway-label">
            <span>Date range</span>
            <select className="gateway-select" value={datePreset} onChange={(e) => handleDatePreset(e.target.value as DatePreset)}>
              {(Object.keys(DATE_PRESET_LABELS) as DatePreset[]).map((preset) => (
                <option key={preset} value={preset}>
                  {DATE_PRESET_LABELS[preset]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="tx-filters-row">
          <label className="gateway-label">
            <span>From date</span>
            <input
              type="date"
              value={dateFrom}
              disabled={datePreset !== 'custom' && datePreset !== 'all'}
              onChange={(e) => {
                setDatePreset('custom')
                setDateFrom(e.target.value)
              }}
            />
          </label>
          <label className="gateway-label">
            <span>To date</span>
            <input
              type="date"
              value={dateTo}
              disabled={datePreset !== 'custom' && datePreset !== 'all'}
              onChange={(e) => {
                setDatePreset('custom')
                setDateTo(e.target.value)
              }}
            />
          </label>
        </div>

        <div className="tx-filters-row">
          <label className="gateway-label">
            <span>Min amount</span>
            <div className="budget-input-wrap">
              <span>₹</span>
              <input type="number" min="0" step="0.01" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0.00" />
            </div>
          </label>
          <label className="gateway-label">
            <span>Max amount</span>
            <div className="budget-input-wrap">
              <span>₹</span>
              <input type="number" min="0" step="0.01" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="0.00" />
            </div>
          </label>
        </div>

        <div className="tx-filters-row tx-filters-row-full">
          <div className="gateway-label">
            <span>Quick ranges</span>
            <div className="tx-amount-presets">
              {AMOUNT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="split-chip"
                  onClick={() => applyAmountPreset(preset.min, preset.max)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="tx-filters-actions">
          <button type="button" className="link-btn" onClick={clearFilters} disabled={!hasActiveFilters}>
            Clear filters
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={exportCsv}
            disabled={transactions.length === 0 || exportingCsv}
          >
            {exportingCsv ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </section>
      </div>

      <div className="app-col app-col-wide">
      <section className="panel">
        <div className="tx-panel-head">
          <div>
            <span className="transfer-section-kicker">Results</span>
            <h2>Transaction History</h2>
          </div>
          <span className="tx-panel-count">{transactions.length} records</span>
        </div>

        {error && <p className="form-error">{error}</p>}

        {loading && transactions.length === 0 ? (
          <p className="muted tx-empty-state">Loading transactions...</p>
        ) : transactions.length === 0 ? (
          <p className="muted tx-empty-state">
            {hasActiveFilters ? 'No transactions match these filters.' : 'No transactions yet.'}
          </p>
        ) : (
          <div className="tx-manage-list">
            {transactions.map((tx) => {
              const outgoing = tx.fromUsername === currentUsername
              const failed = tx.status === 'failed'
              const editing = editingId === tx.id

              return (
                <article key={tx.id} className="tx-manage-row">
                  <div className="tx-manage-header">
                    <span className={`tx-icon ${outgoing ? 'tx-icon-out' : 'tx-icon-in'}`}>
                      <DirectionIcon outgoing={outgoing} />
                    </span>
                    <div className="tx-manage-main">
                      <strong>{describeCounterparty(tx, currentUsername)}</strong>
                      <span className="muted">
                        {new Date(tx.createdAt).toLocaleString()}
                        {tx.referenceNumber && <span className="tx-ref"> · #{tx.referenceNumber}</span>}
                      </span>
                      {tx.note && !editing && <span className="tx-manage-note">Note: {tx.note}</span>}
                    </div>
                  </div>

                  <div className="tx-manage-meta">
                    {tx.isAutoMandate && <span className="tx-automandate-tag">Auto mandate</span>}
                    {tx.isQrPayment && <span className="tx-qr-tag">QR</span>}
                    <span className="split-expense-split-chip">{titleCase(tx.category)}</span>
                    <span className={`tx-amount ${failed ? 'tx-amount-failed' : outgoing ? 'tx-amount-out' : 'tx-amount-in'}`}>
                      {failed ? '' : outgoing ? '−' : '+'}
                      {formatMoney(tx.amount)}
                    </span>
                    {failed && <span className="status-badge status-failed">failed</span>}
                    {!editing && outgoing && (
                      <button type="button" className="secondary-btn" onClick={() => startEdit(tx)}>
                        Edit
                      </button>
                    )}
                    {!editing && !outgoing && (
                      <span className="muted tx-manage-readonly" title="Only the person who sent a transfer can categorize or annotate it">
                        Received
                      </span>
                    )}
                  </div>

                  {editing && (
                    <div className="tx-manage-edit">
                      <label className="gateway-label">
                        <span>Category</span>
                        <select className="gateway-select" value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                          {categoryOptions.map((c) => (
                            <option key={c} value={c}>
                              {titleCase(c)}
                            </option>
                          ))}
                          {!categoryOptions.includes(editCategory) && (
                            <option value={editCategory}>{titleCase(editCategory)}</option>
                          )}
                        </select>
                      </label>
                      <label className="gateway-label">
                        <span>Note</span>
                        <input
                          type="text"
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          placeholder="What was this for?"
                          maxLength={280}
                        />
                      </label>
                      <div className="tx-manage-edit-actions">
                        <button type="button" className="primary-btn" onClick={() => saveEdit(tx)} disabled={savingEdit}>
                          {savingEdit ? 'Saving...' : 'Save'}
                        </button>
                        <button type="button" className="link-btn" onClick={cancelEdit} disabled={savingEdit}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
      </div>
      </div>
    </section>
  )
}
