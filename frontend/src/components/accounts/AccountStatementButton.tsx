import { useState } from 'react'
import type { Account } from '../../api'
import { fetchTransactions } from '../../api'
import { downloadCsv } from '../../utils/csv'

interface Props {
  account: Account
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AccountStatementButton({ account }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDownload = async () => {
    setDownloading(true)
    setError(null)
    try {
      // Newest-first from the API — walk backward from the account's current
      // balance to reconstruct what it was after each past transaction, then
      // reverse into chronological order for the statement.
      const transactions = await fetchTransactions({ accountId: account.id })
      let runningBalance = account.balance
      const rows: string[][] = []

      for (const tx of transactions) {
        const balanceAfter = runningBalance
        const isDebit = tx.fromAccountId === account.id
        const isCredit = tx.toAccountId === account.id
        const affectsBalance = tx.status === 'completed'
        const description = isCredit
          ? tx.fromUsername === tx.toUsername
            ? `From ${tx.fromAccountName}`
            : `From ${tx.fromName} (@${tx.fromUsername})`
          : tx.fromUsername === tx.toUsername
            ? `To ${tx.toAccountName}`
            : `To ${tx.toName} (@${tx.toUsername})`

        rows.push([
          tx.createdAt,
          description,
          tx.category,
          isDebit && affectsBalance ? (tx.amount / 100).toFixed(2) : '',
          isCredit && affectsBalance ? (tx.amount / 100).toFixed(2) : '',
          (balanceAfter / 100).toFixed(2),
          tx.status,
        ])

        if (affectsBalance) {
          if (isDebit) runningBalance += tx.amount
          if (isCredit) runningBalance -= tx.amount
        }
      }
      rows.reverse()

      downloadCsv(
        `finflow-${account.accountName.toLowerCase()}-statement-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Date', 'Description', 'Category', 'Debit (INR)', 'Credit (INR)', 'Balance (INR)', 'Status'],
        rows
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate statement')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <span className="account-statement-action">
      <button
        type="button"
        className="icon-btn account-statement-btn"
        onClick={handleDownload}
        disabled={downloading}
        title="Download account statement (CSV)"
        aria-label={`Download statement for ${account.accountName}`}
      >
        {downloading ? <span className="payment-spinner" /> : <DownloadIcon />}
      </button>
      {error && <span className="form-error">{error}</span>}
    </span>
  )
}
