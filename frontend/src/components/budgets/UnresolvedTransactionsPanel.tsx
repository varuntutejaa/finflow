import { useMemo, useState } from 'react'
import type { Transaction } from '../../api'
import { formatMoney, updateTransactionCategory } from '../../api'

interface Props {
  transactions: Transaction[]
  currentUsername: string
  categories: string[]
  onResolved: () => void
}

function loadCategoryNotes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem('finflow_category_notes') ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function UnresolvedTransactionsPanel({ transactions, currentUsername, categories, onResolved }: Props) {
  const unresolvedTransactions = useMemo(() => {
    return transactions.filter((tx) => tx.fromUsername === currentUsername && tx.category === 'other').slice(0, 12)
  }, [transactions, currentUsername])
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [categoryNotes] = useState<Record<string, string>>(() => loadCategoryNotes())
  const noteOptions = useMemo(() => {
    const uniqueCategories = [...new Set(categories)].filter((category) => category !== 'other')
    return ['Resolve later', ...uniqueCategories]
  }, [categories])

  const handleNoteChange = (transactionId: string, note: string) => {
    setSelections((current) => ({ ...current, [transactionId]: note }))
  }

  const handleSave = async (transactionId: string) => {
    const selected = selections[transactionId] ?? 'Resolve later'
    if (selected === 'Resolve later') return

    setError(null)
    setSavingId(transactionId)
    try {
      await updateTransactionCategory(transactionId, selected)
      const element = document.getElementById(`budget-category-${selected}`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update category')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className="panel budget-unresolved-panel">
      <div className="budget-unresolved-head">
        <div>
          <span className="transfer-section-kicker">Review queue</span>
          <h2>Unresolved transactions</h2>
          <p className="muted">Assign these transfers to a budget category so your spending stays accurate.</p>
        </div>
        <span className="tx-panel-count">{unresolvedTransactions.length} open</span>
      </div>

      {error && <p className="form-error">{error}</p>}

      {unresolvedTransactions.length === 0 ? (
        <p className="muted tx-empty-state">No unresolved transactions right now.</p>
      ) : (
        <div className="budget-unresolved-list">
          {unresolvedTransactions.map((tx) => (
            <article key={tx.id} className="budget-unresolved-row">
              <div className="budget-unresolved-main">
                <strong>
                  {tx.fromUsername === tx.toUsername ? `${tx.fromAccountName} → ${tx.toAccountName}` : `@${tx.toUsername}`}
                </strong>
                <span>{new Date(tx.createdAt).toLocaleString()}</span>
                <span>{formatMoney(tx.amount)}</span>
                {categoryNotes[tx.id] && <span className="budget-unresolved-note-text">Note: {categoryNotes[tx.id]}</span>}
              </div>

              <label className="budget-unresolved-note">
                <span>Assign category</span>
                <select
                  value={selections[tx.id] ?? 'Resolve later'}
                  onChange={(e) => handleNoteChange(tx.id, e.target.value)}
                  disabled={savingId === tx.id}
                >
                  {noteOptions.map((note) => (
                    <option key={note} value={note}>
                      {note === 'Resolve later' ? note : titleCase(note)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary-btn budget-unresolved-save"
                  onClick={() => handleSave(tx.id)}
                  disabled={savingId === tx.id || (selections[tx.id] ?? 'Resolve later') === 'Resolve later'}
                >
                  {savingId === tx.id ? 'Saving...' : 'Save'}
                </button>
              </label>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
