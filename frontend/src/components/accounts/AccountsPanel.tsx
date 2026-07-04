import type { Account } from '../../api'
import { formatMoney } from '../../api'
import { AccountStatementButton } from './AccountStatementButton'

interface Props {
  accounts: Account[]
  loading: boolean
  balancesVisible: boolean
  embedded?: boolean
}

function AccountIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M3 10L12 4L21 10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 10V19H19V10M9 19V14H15V19"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AccountsPanel({ accounts, loading, balancesVisible, embedded = false }: Props) {
  const content = loading && accounts.length === 0 ? (
    <p className={`muted${embedded ? ' muted-inverse' : ''}`}>Loading accounts…</p>
  ) : (
    <ul className={`accounts-list${embedded ? ' accounts-list-embedded' : ''}`}>
      {accounts.map((account) => (
        <li key={account.id} className={`account-card${embedded ? ' account-card-embedded' : ''}`}>
          <span className={`account-icon${embedded ? ' account-icon-embedded' : ''}`}>
            <AccountIcon />
          </span>
          <span className="account-info">
            <span className={`account-name${embedded ? ' account-name-embedded' : ''}`}>{account.accountName}</span>
            <span className={`account-balance${embedded ? ' account-balance-embedded' : ''}`}>
              {balancesVisible ? formatMoney(account.balance) : '••••••'}
            </span>
          </span>
          {balancesVisible && <AccountStatementButton account={account} />}
        </li>
      ))}
    </ul>
  )

  if (embedded) return content

  return (
    <section className="panel">
      <h2>Accounts</h2>
      {content}
    </section>
  )
}
