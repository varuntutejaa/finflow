import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Account, Transaction, User } from './api'
import { clearToken, fetchAccounts, fetchMe, fetchTransactions, getToken, setToken } from './api'
import { AccountsPanel } from './components/accounts/AccountsPanel'
import { AuthForm } from './components/auth/AuthForm'
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
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [balancesVisible, setBalancesVisible] = useState(false)
  const [revealingBalances, setRevealingBalances] = useState(false)

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setNeedsPinSetup(false)
    setBalancesVisible(false)
    setAccounts([])
    setTransactions([])
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [accountsData, transactionsData] = await Promise.all([
        fetchAccounts(),
        fetchTransactions(),
      ])
      setAccounts(accountsData)
      setTransactions(transactionsData)
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
            <TransferForm accounts={accounts} onTransferred={refresh} />
          </div>
          <div className="app-col app-col-wide">
            <TransactionHistory transactions={transactions} currentUsername={user.username} loading={loading} />
          </div>
        </div>
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
    </>
  )
}

export default App
