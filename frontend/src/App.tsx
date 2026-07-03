import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Account, BudgetSummary, Transaction, User } from './api'
import { clearToken, fetchAccounts, fetchBudgets, fetchMe, fetchTransactions, getToken, setToken } from './api'
import { AccountsPanel } from './components/accounts/AccountsPanel'
import { AuthForm } from './components/auth/AuthForm'
import { BudgetPage } from './components/budgets/BudgetPage'
import { SetPinModal } from './components/auth/SetPinModal'
import { PinModal } from './components/shared/PinModal'
import { TransactionHistory } from './components/transactions/TransactionHistory'
import { TransferForm } from './components/transfers/TransferForm'
import { formatMoney, verifyPin } from './api'
import './styles/App.css'

const HIDDEN_BALANCE = '₹ ••••••'

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      {open ? (
        <>
          <path
            d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
        </>
      ) : (
        <>
          <path
            d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 5.2A9.5 9.5 0 0112 5c6.5 0 10 7 10 7a15.8 15.8 0 01-3.4 4.3M6.5 6.5A15.8 15.8 0 002 12s3.5 7 10 7a9.5 9.5 0 003.3-.6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  )
}

function isAuthError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code
  return code === 'UNAUTHENTICATED' || code === 'INVALID_TOKEN'
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function Logo() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M4 17L10 11L14 15L20 8"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M14 8H20V14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="brand-name">FinFlow</span>
    </div>
  )
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13 2L5 13h5l-1 9 8-11h-5l1-9z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l7 3v5c0 4.4-2.8 8.4-7 10-4.2-1.6-7-5.6-7-10V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.5 12l1.7 1.7L14.8 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [needsPinSetup, setNeedsPinSetup] = useState(false)
  const [checkingSession, setCheckingSession] = useState(() => Boolean(getToken()))
  const [accounts, setAccounts] = useState<Account[]>([])
  const [budgets, setBudgets] = useState<BudgetSummary[]>([])
  const [budgetCategories, setBudgetCategories] = useState<string[]>([])
  const [budgetingPreferences, setBudgetingPreferences] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('finflow_budgeting_preferences') ?? '{}') as Record<string, boolean>
    } catch {
      return {}
    }
  })
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [balancesVisible, setBalancesVisible] = useState(false)
  const [revealingBalances, setRevealingBalances] = useState(false)
  const [page, setPage] = useState<'dashboard' | 'budgets'>('dashboard')
  const [budgetAlert, setBudgetAlert] = useState<{ category: string; status: 'warning' | 'exceeded'; utilizationPercent: number } | null>(
    null
  )
  const previousBudgetsRef = useRef<BudgetSummary[]>([])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setNeedsPinSetup(false)
    setBalancesVisible(false)
    setAccounts([])
    setBudgets([])
    setBudgetCategories([])
    setTransactions([])
    setPage('dashboard')
    setBudgetAlert(null)
    previousBudgetsRef.current = []
  }, [])

  const budgetingEnabled = user ? budgetingPreferences[user.username] ?? true : true

  const handleBudgetingEnabledChange = useCallback(
    (nextEnabled: boolean) => {
      if (user) {
        setBudgetingPreferences((current) => {
          const nextPreferences = { ...current, [user.username]: nextEnabled }
          localStorage.setItem('finflow_budgeting_preferences', JSON.stringify(nextPreferences))
          return nextPreferences
        })
      }
    },
    [user]
  )

  const refresh = useCallback(async () => {
    try {
      const [accountsData, transactionsData, budgetData] = await Promise.all([
        fetchAccounts(),
        fetchTransactions(),
        fetchBudgets(),
      ])
      setAccounts(accountsData)
      setTransactions(transactionsData)

      // Surface a real-time alert the moment a category newly crosses into
      // "warning" or "exceeded" — passive card colors on the Budget page
      // only help if you're looking at it, this catches it right after the
      // payment that triggered it.
      const previousByCategory = new Map(previousBudgetsRef.current.map((b) => [b.category, b]))
      const newlyCrossed = budgetData.budgets.find((b) => {
        if (b.status === 'healthy') return false
        const prev = previousByCategory.get(b.category)
        return !prev || prev.status !== b.status
      })
      if (newlyCrossed && newlyCrossed.status !== 'healthy') {
        setBudgetAlert({
          category: newlyCrossed.category,
          status: newlyCrossed.status,
          utilizationPercent: newlyCrossed.utilizationPercent,
        })
      }
      previousBudgetsRef.current = budgetData.budgets

      setBudgets(budgetData.budgets)
      setBudgetCategories(budgetData.categories)
      setLoadError(null)
    } catch (err) {
      if (isAuthError(err)) {
        logout()
        return
      }
      setLoadError(err instanceof Error ? err.message : 'Failed to reach the backend')
    } finally {
      setLoading(false)
    }
  }, [logout])

  useEffect(() => {
    const token = getToken()
    if (!token) return
    fetchMe()
      .then((me) => setUser(me))
      .catch(() => clearToken())
      .finally(() => setCheckingSession(false))
  }, [])

  useEffect(() => {
    if (!user) return
    async function loadUserData() {
      await refresh()
    }
    void loadUserData()
  }, [user, refresh])

  useEffect(() => {
    if (!budgetAlert) return
    const handle = window.setTimeout(() => setBudgetAlert(null), 7000)
    return () => window.clearTimeout(handle)
  }, [budgetAlert])

  const totalBalance = useMemo(() => accounts.reduce((sum, a) => sum + a.balance, 0), [accounts])

  if (checkingSession) {
    return null
  }

  if (!user) {
    return (
      <div className="landing">
        <div className="landing-panel">
          <Logo />
          <h1 className="landing-headline">Money, moving with you.</h1>
          <p className="landing-copy">
            FinFlow keeps every account, transfer, and transaction in one clean view — send money to
            anyone by username, instantly.
          </p>
          <ul className="landing-features">
            <li>
              <span className="feature-icon">
                <BoltIcon />
              </span>
              Instant transfers between accounts and people
            </li>
            <li>
              <span className="feature-icon">
                <ShieldIcon />
              </span>
              Bank-grade balance checks, every transfer atomic
            </li>
            <li>
              <span className="feature-icon">
                <SearchIcon />
              </span>
              Find anyone in seconds with username search
            </li>
          </ul>
        </div>
        <div className="landing-form-wrap">
          <AuthForm
            onAuthenticated={(authUser, token, pinSetupNeeded) => {
              setToken(token)
              setUser(authUser)
              setNeedsPinSetup(pinSetupNeeded)
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <>
      <header className="navbar">
        <Logo />
        <div className="navbar-tabs" role="tablist" aria-label="Primary sections">
          <button
            type="button"
            className={`navbar-tab navbar-tab-budget${page === 'budgets' ? ' navbar-tab-active' : ''}`}
            onClick={() => setPage('budgets')}
            aria-pressed={page === 'budgets'}
          >
            Budget
          </button>
          <button
            type="button"
            className={`navbar-tab navbar-tab-pay${page === 'dashboard' ? ' navbar-tab-active' : ''}`}
            onClick={() => setPage('dashboard')}
            aria-pressed={page === 'dashboard'}
          >
            Pay
          </button>
        </div>
        <div className="navbar-user">
          <span className="avatar">{initials(user.name)}</span>
          <div className="navbar-user-info">
            <span className="navbar-user-name">{user.name}</span>
            <span className="navbar-user-handle">@{user.username}</span>
          </div>
          <button type="button" className="icon-btn" onClick={logout} title="Log out" aria-label="Log out">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>

      {loadError && (
        <div className="banner-error">
          Could not reach the backend ({loadError}). Is it running?
        </div>
      )}

      <main className="app-shell">
        {page === 'dashboard' ? (
          <>
            <section className="hero-stat">
              <div className="hero-stat-top">
                <span className="hero-stat-label">Total balance</span>
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => (balancesVisible ? setBalancesVisible(false) : setRevealingBalances(true))}
                  title={balancesVisible ? 'Hide balances' : 'Show balances'}
                  aria-label={balancesVisible ? 'Hide balances' : 'Show balances'}
                >
                  <EyeIcon open={balancesVisible} />
                </button>
              </div>
              <span className="hero-stat-value">
                {balancesVisible ? formatMoney(totalBalance) : HIDDEN_BALANCE}
              </span>
              <span className="hero-stat-sub">
                {balancesVisible
                  ? `across ${accounts.length} account${accounts.length === 1 ? '' : 's'}`
                  : 'Tap the eye and enter your UPI PIN to reveal'}
              </span>
              <div className="hero-accounts">
                <div className="hero-accounts-head">
                  <span className="hero-accounts-title">Your accounts</span>
                </div>
                <AccountsPanel
                  accounts={accounts}
                  loading={loading}
                  balancesVisible={balancesVisible}
                  embedded
                />
              </div>
            </section>

            <div className="app-layout">
              <div className="app-col">
                <TransferForm
                  accounts={accounts}
                  categories={budgetCategories}
                  budgetingEnabled={budgetingEnabled}
                  onTransferred={refresh}
                />
              </div>
              <div className="app-col app-col-wide">
                <TransactionHistory transactions={transactions} currentUsername={user.username} loading={loading} />
              </div>
            </div>
          </>
        ) : (
          <BudgetPage
            budgets={budgets}
            transactions={transactions}
            currentUsername={user.username}
            categories={budgetCategories}
            budgetingEnabled={budgetingEnabled}
            onSaved={(nextBudgets, nextCategories) => {
              setBudgets(nextBudgets)
              setBudgetCategories(nextCategories)
            }}
            onCategoriesChange={setBudgetCategories}
            onDeleted={(nextBudgets, nextCategories) => {
              setBudgets(nextBudgets)
              setBudgetCategories(nextCategories)
            }}
            onBudgetingEnabledChange={handleBudgetingEnabledChange}
            onBack={() => setPage('dashboard')}
            onResolved={refresh}
          />
        )}
      </main>

      {needsPinSetup && (
        <SetPinModal name={user.name} onDone={() => setNeedsPinSetup(false)} />
      )}

      {revealingBalances && (
        <PinModal
          title="Enter UPI PIN"
          subtitle="Verify your PIN to view your balances"
          onConfirm={async (pin) => {
            await verifyPin(pin)
            setBalancesVisible(true)
            setRevealingBalances(false)
          }}
          onCancel={() => setRevealingBalances(false)}
        />
      )}

      {budgetAlert && (
        <div
          className={`budget-toast budget-toast-${budgetAlert.status}`}
          role="status"
          aria-live="polite"
        >
          <div className="budget-toast-copy">
            <strong>
              {budgetAlert.status === 'exceeded'
                ? `${titleCase(budgetAlert.category)} budget exceeded`
                : `Approaching ${titleCase(budgetAlert.category)} budget limit`}
            </strong>
            <span>{budgetAlert.utilizationPercent}% of this month's limit used</span>
          </div>
          <button
            type="button"
            className="icon-btn budget-toast-dismiss"
            onClick={() => setBudgetAlert(null)}
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </>
  )
}

export default App
