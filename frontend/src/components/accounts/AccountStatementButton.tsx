import { useState } from 'react'
import type { Account } from '../../api'
import { downloadAccountStatementCsv } from '../../api'

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
      await downloadAccountStatementCsv(account.id)
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
