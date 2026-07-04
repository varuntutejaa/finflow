import { useCallback, useEffect, useState } from 'react'
import type { ImportedTransaction, SpendingAnalytics } from '../../api'
import {
  deleteImportedTransaction,
  fetchImportedTransactions,
  fetchSpendingAnalytics,
  formatMoney,
  importCsvStatement,
  importPdfStatement,
  rollbackImportBatch,
  updateImportedTransactionCategory,
} from '../../api'
import { CategoryBarChart } from './CategoryBarChart'
import { MonthlyTrendChart } from './MonthlyTrendChart'
import { colorForCategory } from '../../utils/chartColors'

interface Props {
  onBack: () => void
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function AnalyticsPage({ onBack }: Props) {
  const [analytics, setAnalytics] = useState<SpendingAnalytics | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)

  const [imported, setImported] = useState<ImportedTransaction[]>([])
  const [importedLoading, setImportedLoading] = useState(true)

  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [lastBatchId, setLastBatchId] = useState<string | null>(null)
  const [rollingBack, setRollingBack] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCategory, setEditCategory] = useState('')

  const loadAll = useCallback(async () => {
    setAnalyticsLoading(true)
    setImportedLoading(true)
    try {
      const [a, i] = await Promise.all([fetchSpendingAnalytics(), fetchImportedTransactions()])
      setAnalytics(a)
      setImported(i)
      setAnalyticsError(null)
    } catch (err) {
      setAnalyticsError(err instanceof Error ? err.message : 'Could not load analytics')
    } finally {
      setAnalyticsLoading(false)
      setImportedLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const handleFileUpload = async (file: File) => {
    setUploading(true)
    setUploadMessage(null)
    setUploadError(null)
      setLastBatchId(null)
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      const result = isPdf ? await importPdfStatement(file) : await importCsvStatement(file)
      const notes: string[] = []
      if (result.skippedCount > 0) notes.push(`${result.skippedCount} line${result.skippedCount === 1 ? '' : 's'} skipped`)
      if (result.duplicateCount > 0) notes.push(`${result.duplicateCount} duplicate${result.duplicateCount === 1 ? '' : 's'} ignored`)
      setUploadMessage(
        `Imported ${result.importedCount} transaction${result.importedCount === 1 ? '' : 's'}` +
          (notes.length > 0 ? ` (${notes.join(', ')})` : '')
      )
      setLastBatchId(result.batchId)
      await loadAll()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not import this file')
    } finally {
      setUploading(false)
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void handleFileUpload(file)
  }

  const handleUndoImport = async () => {
    if (!lastBatchId) return
    setRollingBack(true)
    setUploadError(null)
    try {
      await rollbackImportBatch(lastBatchId)
      setUploadMessage(null)
      setLastBatchId(null)
      await loadAll()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not undo this import')
    } finally {
      setRollingBack(false)
    }
  }

  const startEdit = (tx: ImportedTransaction) => {
    if (tx.entryType === 'credit') return
    setEditingId(tx.id)
    setEditCategory(tx.category)
  }

  const saveEdit = async (tx: ImportedTransaction) => {
    try {
      const updated = await updateImportedTransactionCategory(tx.id, editCategory)
      setImported((current) => current.map((t) => (t.id === tx.id ? updated : t)))
      setEditingId(null)
      void fetchSpendingAnalytics().then(setAnalytics)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not update category')
    }
  }

  const handleDelete = async (tx: ImportedTransaction) => {
    try {
      await deleteImportedTransaction(tx.id)
      setImported((current) => current.filter((t) => t.id !== tx.id))
      void fetchSpendingAnalytics().then(setAnalytics)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not delete this row')
    }
  }

  return (
    <section className="budget-page">
      <div className="budget-page-head">
        <div>
          <span className="transfer-section-kicker">Analytics</span>
          <h1>Spending Analytics</h1>
          <p className="muted">Import bank statements and see where your money actually goes.</p>
        </div>
        <button type="button" className="link-btn" onClick={onBack}>
          Back to dashboard
        </button>
      </div>

      <section className="panel">
        <div className="budget-panel-head">
          <div>
            <span className="transfer-section-kicker">Import</span>
            <h2>Import a statement</h2>
          </div>
        </div>
        <p className="muted">
          Upload a CSV or PDF bank/card statement. We'll pull out the merchant, amount, and date for each transaction and
          suggest a category automatically — edit any of it afterward.
        </p>
        <label className="secondary-btn analytics-upload-btn">
          {uploading ? 'Importing...' : 'Choose CSV or PDF file'}
          <input type="file" accept=".csv,.pdf,text/csv,application/pdf" onChange={handleFileInputChange} disabled={uploading} hidden />
        </label>
        {uploadMessage && (
          <div className="analytics-undo-row">
            <p className="form-success">{uploadMessage}</p>
            {lastBatchId && (
              <button type="button" className="link-btn" onClick={handleUndoImport} disabled={rollingBack}>
                {rollingBack ? 'Undoing...' : 'Undo this import'}
              </button>
            )}
          </div>
        )}
        {uploadError && <p className="form-error">{uploadError}</p>}
      </section>

      {analyticsError && <p className="form-error">{analyticsError}</p>}

      {analyticsLoading && !analytics ? (
        <p className="muted tx-empty-state">Loading analytics...</p>
      ) : analytics ? (
        <>
          <div className="analytics-stat-row">
            <div className="analytics-stat-tile">
              <span className="muted">Total spent</span>
              <strong>{formatMoney(analytics.totalSpent)}</strong>
            </div>
            <div className="analytics-stat-tile">
              <span className="muted">Total credited</span>
              <strong className="tx-amount-in">{formatMoney(analytics.totalCredited)}</strong>
            </div>
            <div className="analytics-stat-tile">
              <span className="muted">Transactions</span>
              <strong>{analytics.transactionCount}</strong>
            </div>
            <div className="analytics-stat-tile">
              <span className="muted">Recurring expenses</span>
              <strong>{analytics.recurring.length}</strong>
            </div>
          </div>

          <div className="analytics-detail-toggle">
            <button type="button" className="secondary-btn" onClick={() => setShowAdvanced((current) => !current)}>
              {showAdvanced ? 'Hide advanced details' : 'Show advanced details'}
            </button>
          </div>

          <div className="app-layout">
            <div className="app-col">
              <section className="panel">
                <div className="budget-panel-head">
                  <div>
                    <span className="transfer-section-kicker">By category</span>
                    <h2>Where it goes</h2>
                  </div>
                </div>
                <CategoryBarChart data={analytics.byCategory} />
              </section>

              {showAdvanced && (
                <section className="panel">
                  <div className="budget-panel-head">
                    <div>
                      <span className="transfer-section-kicker">Recurring</span>
                      <h2>Recurring expenses</h2>
                    </div>
                  </div>
                  {analytics.recurring.length === 0 ? (
                    <p className="muted tx-empty-state">Nothing recurring detected yet — needs at least 2 payments to the same place.</p>
                  ) : (
                    <div className="split-settlement-list">
                      {analytics.recurring.map((r) => (
                        <div key={r.merchant} className="split-settlement-row">
                        <span>
                          <strong>{r.merchant}</strong> · {r.cadence} · {r.occurrences}x
                          <br />
                          <span className="muted">Avg {formatMoney(r.averageAmount)} · last {formatMoney(r.lastAmount)}</span>
                        </span>
                        <span className="split-expense-split-chip" style={{ background: colorForCategory(r.category) + '22' }}>
                          {titleCase(r.category)}
                        </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>

            <div className="app-col app-col-wide">
              <section className="panel">
                <div className="budget-panel-head">
                  <div>
                    <span className="transfer-section-kicker">Over time</span>
                    <h2>Monthly spend</h2>
                  </div>
                </div>
                <MonthlyTrendChart data={analytics.byMonth} />
              </section>

              {showAdvanced && (
                <section className="panel">
                  <div className="budget-panel-head">
                    <div>
                      <span className="transfer-section-kicker">Top merchants</span>
                      <h2>Where you spend the most</h2>
                    </div>
                  </div>
                  {analytics.topMerchants.length === 0 ? (
                    <p className="muted tx-empty-state">No spending yet.</p>
                  ) : (
                    <div className="tx-manage-list">
                      {analytics.topMerchants.map((m, i) => (
                        <div key={m.merchant} className="tx-manage-row">
                        <div className="tx-manage-header">
                          <span className="analytics-rank">{i + 1}</span>
                          <div className="tx-manage-main">
                            <strong>{m.merchant}</strong>
                            <span className="muted">
                              {m.count} transaction{m.count === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>
                        <div className="tx-manage-meta">
                          <span className="tx-amount tx-amount-out">{formatMoney(m.amount)}</span>
                        </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        </>
      ) : null}

      {showAdvanced && (
      <section className="panel">
        <div className="tx-panel-head">
          <div>
            <span className="transfer-section-kicker">Imported</span>
            <h2>Imported transactions</h2>
          </div>
          <span className="tx-panel-count">{imported.length} records</span>
        </div>
        {importedLoading && imported.length === 0 ? (
          <p className="muted tx-empty-state">Loading...</p>
        ) : imported.length === 0 ? (
          <p className="muted tx-empty-state">Nothing imported yet — upload a statement above.</p>
        ) : (
          <div className="tx-manage-list">
            {imported.map((tx) => {
              const editing = editingId === tx.id
              const isCredit = tx.entryType === 'credit'
              return (
                <article key={tx.id} className="tx-manage-row">
                  <div className="tx-manage-header">
                    <span className={`tx-icon ${isCredit ? 'tx-icon-in' : 'tx-icon-out'}`}>
                      <svg viewBox="0 0 24 24" fill="none">
                        {isCredit ? (
                          <path d="M17 7L7 17M7 17H15M7 17V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        ) : (
                          <path d="M7 17L17 7M17 7H9M17 7V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                      </svg>
                    </span>
                    <div className="tx-manage-main">
                      <strong>{tx.merchant}</strong>
                      <span className="muted">
                        {new Date(tx.occurredAt).toLocaleDateString()} · {tx.source.toUpperCase()} · {isCredit ? 'Credit' : 'Debit'}
                      </span>
                    </div>
                  </div>
                  <div className="tx-manage-meta">
                    <span className="status-badge status-imported">Imported</span>
                    <span className="split-expense-split-chip">{titleCase(tx.category)}</span>
                    <span className={`tx-amount ${isCredit ? 'tx-amount-in' : 'tx-amount-out'}`}>
                      {isCredit ? '+' : '-'}
                      {formatMoney(tx.amount)}
                    </span>
                    {!editing && (
                      <>
                        {!isCredit && (
                          <button type="button" className="secondary-btn" onClick={() => startEdit(tx)}>
                            Edit
                          </button>
                        )}
                        <button type="button" className="icon-btn" onClick={() => handleDelete(tx)} aria-label="Delete imported transaction">
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M4 7h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            <path d="M9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            <path d="M8 7l1 13h6l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                  {editing && (
                    <div className="tx-manage-edit">
                      <label className="gateway-label">
                        <span>Category</span>
                        <select className="gateway-select" value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                          {['food', 'transport', 'shopping', 'bills', 'entertainment', 'other'].map((c) => (
                            <option key={c} value={c}>
                              {titleCase(c)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="tx-manage-edit-actions">
                        <button type="button" className="primary-btn" onClick={() => saveEdit(tx)}>
                          Save
                        </button>
                        <button type="button" className="link-btn" onClick={() => setEditingId(null)}>
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
      )}
    </section>
  )
}
