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

      <UnresolvedTransactionsPanel
        transactions={transactions}
        currentUsername={currentUsername}
        categories={categories}
        onResolved={onResolved}
      />
    </section>
  )
}
