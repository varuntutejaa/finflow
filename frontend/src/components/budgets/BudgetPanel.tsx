import { useMemo, useState } from 'react'
import { BUDGET_CATEGORIES, deleteBudgetCategory, formatMoney, saveBudgets } from '../../api'
import type { BudgetSummary } from '../../api'

interface Props {
  budgets: BudgetSummary[]
  categories: string[]
  budgetingEnabled: boolean
  onSaved: (budgets: BudgetSummary[], categories: string[]) => void
  onCategoriesChange: (categories: string[]) => void
  onDeleted: (budgets: BudgetSummary[], categories: string[]) => void
  onBudgetingEnabledChange: (enabled: boolean) => void
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeCategory(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function BudgetPanel({
  budgets,
  categories,
  budgetingEnabled,
  onSaved,
  onCategoriesChange,
  onDeleted,
  onBudgetingEnabledChange,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newCategory, setNewCategory] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const budgetMap = useMemo(() => {
    return new Map(budgets.map((budget) => [budget.category, budget]))
  }, [budgets])

  const presetCategories = BUDGET_CATEGORIES as readonly string[]
  const customCategories = categories.filter((category) => !presetCategories.includes(category))
  const warningCount = budgets.filter((budget) => budget.status !== 'healthy').length

  const handleAddCategory = async () => {
    setError(null)
    const normalized = normalizeCategory(newCategory)

    if (!normalized) {
      setError('Enter a category name to add.')
      return
    }
    if (presetCategories.includes(normalized) || categories.includes(normalized)) {
      setError('That category already exists.')
      return
    }

    // Persist immediately rather than only staging it locally — otherwise the
    // category silently disappears if the user navigates away before hitting
    // "Save budgets" separately.
    setAddingCategory(true)
    try {
      const response = await saveBudgets({ budgets: [{ category: normalized, monthlyLimit: 0, thresholdPercent: 80 }] })
      onCategoriesChange(response.categories)
      onSaved(response.budgets, response.categories)
      setNewCategory('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add category')
    } finally {
      setAddingCategory(false)
    }
  }

  const handleDeleteCategory = async (category: string) => {
    setError(null)
    setDeletingCategory(category)

    try {
      const response = await deleteBudgetCategory(category)
      onCategoriesChange(response.categories)
      setDrafts((current) => {
        const next = { ...current }
        delete next[category]
        return next
      })
      onDeleted(response.budgets, response.categories)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete category')
    } finally {
      setDeletingCategory(null)
    }
  }

  const handleSave = async () => {
    setError(null)

    const payload = categories.map((category) => {
      const current = budgetMap.get(category)
      const draftValue = drafts[category]
      const nextValue =
        draftValue === undefined || draftValue === '' ? current?.monthlyLimit ?? 0 : Math.round(Number(draftValue) * 100)

      if (!Number.isFinite(nextValue) || nextValue < 0) {
        throw new Error('Budget amounts must be valid numbers greater than or equal to 0.')
      }

      return {
        category,
        monthlyLimit: nextValue,
        thresholdPercent: current?.thresholdPercent ?? 80,
      }
    })

    setSaving(true)
    try {
      const response = await saveBudgets({ budgets: payload })
      setDrafts({})
      onCategoriesChange(response.categories)
      onSaved(response.budgets, response.categories)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save budgets')
    } finally {
      setSaving(false)
    }
  }

  const controlsDisabled = !budgetingEnabled || saving || addingCategory || deletingCategory !== null

  const renderBudgetCard = (category: string, accentLabel: string, canDelete = false) => {
    const budget = budgetMap.get(category)
    const draft = drafts[category]
    const inputValue = draft ?? (budget ? String(budget.monthlyLimit / 100) : '')
    const utilization = budget?.utilizationPercent ?? 0

    return (
      <div
        key={category}
        id={`budget-category-${category}`}
        className={`budget-card${budget?.status ? ` budget-card-${budget.status}` : ''}`}
      >
        <div className="budget-card-head">
          <div className="budget-card-title">
            <strong>{titleCase(category)}</strong>
            <span>{budget ? `${utilization}% used` : accentLabel}</span>
          </div>
          {canDelete && (
            <button
              type="button"
              className="icon-btn budget-delete-btn"
              onClick={() => handleDeleteCategory(category)}
              disabled={controlsDisabled || deletingCategory === category}
              aria-label={`Delete ${category} category`}
              title="Delete category"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M8 7l1 13h6l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>

        <div className="budget-progress-track" aria-hidden="true">
          <span
            className={`budget-progress-fill${budget?.status ? ` budget-progress-fill-${budget.status}` : ''}`}
            style={{ width: `${Math.min(utilization, 100)}%` }}
          />
        </div>

        <div className="budget-metrics">
          <span>Spent: {formatMoney(budget?.spent ?? 0)}</span>
          <span>Left: {formatMoney(budget?.remaining ?? 0)}</span>
        </div>

        <label className="budget-input-row">
          <span>Monthly limit</span>
          <div className="budget-input-wrap">
            <span>₹</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={inputValue}
              disabled={!budgetingEnabled}
              onChange={(e) => setDrafts((current) => ({ ...current, [category]: e.target.value }))}
              placeholder="0.00"
            />
          </div>
        </label>

        <p className={`budget-status budget-status-${budget?.status ?? 'healthy'}`}>
          {budget?.status === 'exceeded'
            ? 'Budget exceeded this month.'
            : budget?.status === 'warning'
              ? 'Approaching monthly limit.'
              : 'Spending is within limit.'}
        </p>
      </div>
    )
  }

  return (
    <section className="panel budget-panel">
      <div className="budget-panel-head">
        <div>
          <span className="transfer-section-kicker">Smart budgeting</span>
          <h2>Track the four preset budgets</h2>
        </div>
        <div className="budget-panel-head-meta">
          <label className="budget-toggle">
            <input
              type="checkbox"
              checked={budgetingEnabled}
              onChange={(e) => onBudgetingEnabledChange(e.target.checked)}
            />
            <span className="budget-toggle-track" aria-hidden="true">
              <span className="budget-toggle-thumb" />
            </span>
            <span className="budget-toggle-label">{budgetingEnabled ? 'Budgeting on' : 'Budgeting off'}</span>
          </label>
          <span className={`budget-panel-badge${warningCount > 0 ? ' budget-panel-badge-warning' : ''}`}>
            {warningCount > 0 ? `${warningCount} alert${warningCount === 1 ? '' : 's'}` : 'On track'}
          </span>
        </div>
      </div>

      <div className="budget-add-row">
        <label className="budget-add-field">
          <span>Add budget category</span>
          <input
            type="text"
            value={newCategory}
            disabled={!budgetingEnabled}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="e.g. travel"
          />
        </label>
        <button type="button" className="secondary-btn" onClick={handleAddCategory} disabled={controlsDisabled}>
          {addingCategory ? 'Adding...' : 'Add category'}
        </button>
      </div>

      <div className="budget-section">
        <div className="budget-section-head">
          <h3>Preset categories</h3>
          <span>Four starter categories shown here</span>
        </div>
        <div className="budget-grid">{presetCategories.map((category) => renderBudgetCard(category, 'Preset'))}</div>
      </div>

      {customCategories.length > 0 && (
        <div className="budget-section">
          <div className="budget-section-head">
            <h3>Custom categories</h3>
            <span>Categories you added</span>
          </div>
          <div className="budget-grid">{customCategories.map((category) => renderBudgetCard(category, 'Custom', true))}</div>
        </div>
      )}

      <div className="budget-panel-actions">
        <p className="muted">Budgets reset automatically every new month based on current-month transfer activity.</p>
        <button type="button" className="primary-btn" onClick={handleSave} disabled={controlsDisabled}>
          {!budgetingEnabled ? 'Budgeting paused' : saving ? 'Saving...' : 'Save budgets'}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}
    </section>
  )
}
