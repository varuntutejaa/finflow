import type { Transaction } from '../../api'
import { formatMoney } from '../../api'

interface Props {
  transactions: Transaction[]
  currentUsername: string
  loading: boolean
}

function DirectionIcon({ outgoing }: { outgoing: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      {outgoing ? (
        <path
          d="M7 17L17 7M17 7H9M17 7V15"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M17 7L7 17M7 17H15M7 17V9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

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

export function TransactionHistory({ transactions, currentUsername, loading }: Props) {
  return (
    <section className="panel tx-panel">
      <div className="tx-panel-head">
        <div>
          <span className="transfer-section-kicker">Ledger</span>
          <h2>Transaction History</h2>
        </div>
        <span className="tx-panel-count">{transactions.length} records</span>
      </div>
      {loading && transactions.length === 0 ? (
        <p className="muted tx-empty-state">Loading transactions…</p>
      ) : transactions.length === 0 ? (
        <p className="muted tx-empty-state">No transactions yet. Your payment activity will appear here.</p>
      ) : (
        <ul className="tx-list">
          {transactions.map((tx) => {
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
