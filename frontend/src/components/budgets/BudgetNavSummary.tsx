import type { BudgetSummary } from '../../api'
import { formatMoney } from '../../api'

interface Props {
  budgets: BudgetSummary[]
  onOpenBudgets: () => void
}

export function BudgetNavSummary({ budgets, onOpenBudgets }: Props) {
  const totalLimit = budgets.reduce((sum, budget) => sum + budget.monthlyLimit, 0)
  const totalSpent = budgets.reduce((sum, budget) => sum + budget.spent, 0)
  const remaining = Math.max(totalLimit - totalSpent, 0)
  const alertCount = budgets.filter((budget) => budget.status !== 'healthy').length

  return (
    <button type="button" className="budget-nav-summary" onClick={onOpenBudgets} aria-label="Open budgeting page">
      <div className="budget-nav-copy">
        <span className="budget-nav-label">Budgeting</span>
        <strong>{formatMoney(remaining)} left</strong>
      </div>
      <div className="budget-nav-meta">
        <span>{budgets.length} categories</span>
        <span>{alertCount > 0 ? `${alertCount} watch` : 'All clear'}</span>
      </div>
    </button>
  )
}
