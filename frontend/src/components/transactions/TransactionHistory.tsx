import { useMemo, useState } from 'react'
import type { Transaction } from '../../api'
import { formatMoney } from '../../api'
import { DirectionIcon } from './DirectionIcon'

interface Props {
  transactions: Transaction[]
  currentUsername: string
  loading: boolean
}

type StatusFilter = '' | 'completed' | 'pending' | 'failed'
type DateFilter = '' | 'week' | 'month'

function describe(tx: Transaction, currentUsername: string) {
  const outgoing = tx.fromUsername === currentUsername
  const selfTransfer = tx.fromUsername === tx.toUsername

  if (selfTransfer) {
    return { outgoing, label: `${tx.fromAccountName} → ${tx.toAccountName}` }
  }
  return {
    outgoing,
    label: outgoing ? `To @${tx.toUsername}` : `From @${tx.fromUsername}`,
  }
}

function startOfWeekUtc(now: Date) {
  const day = now.getUTCDay()
  const diff = (day + 6) % 7 // days since Monday
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff))
  return start
}

export function TransactionHistory({ transactions, currentUsername, loading }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('')
  const [idSearch, setIdSearch] = useState('')

  const filtered = useMemo(() => {
    let result = transactions

    if (statusFilter) {
      // "pending" has no real backing status in this app — transfers resolve
      // synchronously to completed or failed — so it will always show zero
      // results rather than being a fake option that's hidden from the UI.
      result = result.filter((tx) => tx.status === statusFilter)
    }

    if (dateFilter) {
      const now = new Date()
      const cutoff = dateFilter === 'week' ? startOfWeekUtc(now) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      result = result.filter((tx) => new Date(tx.createdAt) >= cutoff)
    }

    if (idSearch.trim()) {
      const needle = idSearch.trim().toLowerCase()
      result = result.filter(
        (tx) => tx.id.toLowerCase().includes(needle) || (tx.idempotencyKey ?? '').toLowerCase().includes(needle)
      )
    }

    return result
  }, [transactions, statusFilter, dateFilter, idSearch])

  const hasActiveFilters = Boolean(statusFilter || dateFilter || idSearch)

  return (
    <section className="panel tx-panel">
      <div className="tx-panel-head">
        <div>
          <span className="transfer-section-kicker">Ledger</span>
          <h2>Transaction History</h2>
        </div>
        <span className="tx-panel-count">{filtered.length} records</span>
      </div>

      <div className="tx-ledger-filters">
        <select
          className="gateway-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <select
          className="gateway-select"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          aria-label="Filter by date"
        >
          <option value="">All time</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
        </select>
        <input
          type="text"
          className="tx-ledger-id-search"
          value={idSearch}
          onChange={(e) => setIdSearch(e.target.value)}
          placeholder="Transaction ID..."
          aria-label="Search by transaction ID"
        />
        {hasActiveFilters && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setStatusFilter('')
              setDateFilter('')
              setIdSearch('')
            }}
          >
            Clear
          </button>
        )}
      </div>

      {loading && transactions.length === 0 ? (
        <p className="muted tx-empty-state">Loading transactions…</p>
      ) : transactions.length === 0 ? (
        <p className="muted tx-empty-state">No transactions yet. Your payment activity will appear here.</p>
      ) : filtered.length === 0 ? (
        <p className="muted tx-empty-state">No transactions match these filters.</p>
      ) : (
        <ul className="tx-list">
          {filtered.map((tx) => {
            const { outgoing, label } = describe(tx, currentUsername)
            const failed = tx.status === 'failed'
            return (
              <li key={tx.id} className="tx-row">
                <span className={`tx-icon ${outgoing ? 'tx-icon-out' : 'tx-icon-in'}`}>
                  <DirectionIcon outgoing={outgoing} />
                </span>
                <span className="tx-main">
                  <span className="tx-label">{label}</span>
                  <span className="tx-time">{new Date(tx.createdAt).toLocaleString()}</span>
                </span>
                <span className="tx-end">
                  <span className={`tx-amount ${failed ? 'tx-amount-failed' : outgoing ? 'tx-amount-out' : 'tx-amount-in'}`}>
                    {failed ? '' : outgoing ? '−' : '+'}
                    {formatMoney(tx.amount)}
                  </span>
                  {failed && <span className="status-badge status-failed">failed</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
