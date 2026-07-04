import { useMemo, useState } from 'react'
import type { BudgetSummary, Transaction } from '../../api'
import { BudgetPanel } from './BudgetPanel'
import { UnresolvedTransactionsPanel } from './UnresolvedTransactionsPanel'

interface Props {
  budgets: BudgetSummary[]
  transactions: Transaction[]
  currentUsername: string
  categories: string[]
  budgetingEnabled: boolean
  onSaved: (budgets: BudgetSummary[], categories: string[]) => void
  onCategoriesChange: (categories: string[]) => void
  onDeleted: (budgets: BudgetSummary[], categories: string[]) => void
  onBudgetingEnabledChange: (enabled: boolean) => void
  onBack: () => void
  onResolved: () => void
}

export function BudgetPage({
  budgets,
  transactions,
  currentUsername,
  categories,
  budgetingEnabled,
  onSaved,
  onCategoriesChange,
  onDeleted,
  onBudgetingEnabledChange,
  onBack,
  onResolved,
}: Props) {
  const [showReviewQueue, setShowReviewQueue] = useState(false)
  const unresolvedCount = useMemo(
    () => transactions.filter((tx) => tx.fromUsername === currentUsername && tx.category === 'other').length,
    [transactions, currentUsername]
  )

  return (
    <section className="budget-page">
      <div className="budget-page-head">
        <div>
          <span className="transfer-section-kicker">Budgeting</span>
          <h1>Monthly budgets</h1>
          <p className="muted">Track spending by category, see what is left, and adjust limits anytime.</p>
        </div>
        <button type="button" className="link-btn" onClick={onBack}>
          Back to dashboard
        </button>
      </div>

      <BudgetPanel
        budgets={budgets}
        categories={categories}
        budgetingEnabled={budgetingEnabled}
        onSaved={onSaved}
        onCategoriesChange={onCategoriesChange}
        onDeleted={onDeleted}
        onBudgetingEnabledChange={onBudgetingEnabledChange}
      />

      <section className="panel budget-review-gate">
        <div>
          <span className="transfer-section-kicker">Review queue</span>
          <h2>{unresolvedCount} transaction{unresolvedCount === 1 ? '' : 's'} need review</h2>
          <p className="muted">Keep this tucked away until you want to clean up uncategorized spending.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => setShowReviewQueue((current) => !current)}>
          {showReviewQueue ? 'Hide review' : 'Review transactions'}
        </button>
      </section>

      {showReviewQueue && (
        <UnresolvedTransactionsPanel
          transactions={transactions}
          currentUsername={currentUsername}
          categories={categories}
          onResolved={onResolved}
        />
      )}
    </section>
  )
}
