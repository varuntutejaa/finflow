import { useEffect, useMemo, useState } from 'react'
import type { GroupDetail, UserSearchResult } from '../../api'
import { addExpense, addGroupMember, formatMoney, generateSettlements, markSettlementPaid, rupeesToPaise } from '../../api'
import { UserSearchPicker } from './UserSearchPicker'

interface Props {
  group: GroupDetail
  currentUsername: string
  onRefresh: () => Promise<void>
  onPaySettlement: (context: {
    groupId: string
    settlementId: string
    groupName: string
    toUsername: string
    toName: string
    remainingAmount: number
  }) => void
}

export function GroupDetailView({ group, currentUsername, onRefresh, onPaySettlement }: Props) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paidByUsername, setPaidByUsername] = useState(currentUsername)
  const [splitType, setSplitType] = useState<'equal' | 'custom'>('equal')
  const [participants, setParticipants] = useState<Set<string>>(() => new Set(group.members.map((m) => m.username)))
  const [customShares, setCustomShares] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [expenseError, setExpenseError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [settlementError, setSettlementError] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)

  const amountPaise = rupeesToPaise(amount || '0')
  const customTotal = useMemo(
    () => group.members.reduce((sum, m) => sum + Math.round(Number(customShares[m.username] || '0') * 100), 0),
    [customShares, group.members]
  )
  const totalSpent = useMemo(() => group.expenses.reduce((sum, expense) => sum + expense.amount, 0), [group.expenses])
  const yourBalance = group.balances.find((balance) => balance.username === currentUsername)?.netBalance ?? 0

  useEffect(() => {
    setParticipants((current) => {
      const currentMembers = new Set(group.members.map((member) => member.username))
      const next = new Set([...current].filter((username) => currentMembers.has(username)))
      for (const member of group.members) next.add(member.username)
      return next
    })
    setPaidByUsername((current) => (group.members.some((member) => member.username === current) ? current : currentUsername))
  }, [currentUsername, group.members])

  const toggleParticipant = (username: string) => {
    setParticipants((current) => {
      const next = new Set(current)
      if (next.has(username)) next.delete(username)
      else next.add(username)
      return next
    })
  }

  const handleAddExpense = async () => {
    setExpenseError(null)
    const trimmedDescription = description.trim()
    if (!trimmedDescription) {
      setExpenseError('Enter what this expense was for.')
      return
    }
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      setExpenseError('Enter a valid amount greater than ₹0.')
      return
    }

    setSaving(true)
    try {
      if (splitType === 'equal') {
        const participantUsernames = [...participants]
        if (participantUsernames.length === 0) {
          setExpenseError('Select at least one participant.')
          setSaving(false)
          return
        }
        await addExpense(group.id, {
          description: trimmedDescription,
          amount: amountPaise,
          paidByUsername,
          splitType: 'equal',
          participantUsernames,
        })
      } else {
        if (customTotal !== amountPaise) {
          setExpenseError(
            `Custom shares add up to ${formatMoney(customTotal)}, but the expense is ${formatMoney(amountPaise)}.`
          )
          setSaving(false)
          return
        }
        const customSplits = group.members
          .map((m) => ({ username: m.username, shareAmount: Math.round(Number(customShares[m.username] || '0') * 100) }))
          .filter((s) => s.shareAmount > 0)
        await addExpense(group.id, {
          description: trimmedDescription,
          amount: amountPaise,
          paidByUsername,
          splitType: 'custom',
          customSplits,
        })
      }
      setDescription('')
      setAmount('')
      setCustomShares({})
      await onRefresh()
    } catch (err) {
      setExpenseError(err instanceof Error ? err.message : 'Could not add expense')
    } finally {
      setSaving(false)
    }
  }

  const handleGenerateSettlements = async () => {
    setGenerating(true)
    setSettlementError(null)
    try {
      await generateSettlements(group.id)
      await onRefresh()
    } catch (err) {
      setSettlementError(err instanceof Error ? err.message : 'Could not generate settlements')
    } finally {
      setGenerating(false)
    }
  }

  const handleMarkPaid = async (settlementId: string) => {
    setPayingId(settlementId)
    setSettlementError(null)
    try {
      await markSettlementPaid(group.id, settlementId)
      await onRefresh()
    } catch (err) {
      setSettlementError(err instanceof Error ? err.message : 'Could not update settlement')
    } finally {
      setPayingId(null)
    }
  }

  const handleAddMember = async (user: UserSearchResult) => {
    setMemberError(null)
    setAddingMember(true)
    try {
      await addGroupMember(group.id, user.username)
      await onRefresh()
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Could not add member')
    } finally {
      setAddingMember(false)
    }
  }

  const pendingSettlements = group.settlements.filter((s) => s.status === 'pending')
  const paidSettlements = group.settlements.filter((s) => s.status === 'paid')

  return (
    <>
      <section className="panel split-overview-panel">
        <div className="split-overview-grid">
          <div className="split-overview-item">
            <span>Total spent</span>
            <strong>{formatMoney(totalSpent)}</strong>
          </div>
          <div className="split-overview-item">
            <span>Your position</span>
            <strong className={yourBalance > 0 ? 'split-positive-text' : yourBalance < 0 ? 'split-negative-text' : ''}>
              {yourBalance === 0 ? 'Settled' : yourBalance > 0 ? `Owed ${formatMoney(yourBalance)}` : `Owe ${formatMoney(-yourBalance)}`}
            </strong>
          </div>
          <div className="split-overview-item">
            <span>Pending</span>
            <strong>{pendingSettlements.length}</strong>
          </div>
          <div className="split-overview-item">
            <span>Members</span>
            <strong>{group.members.length}</strong>
          </div>
        </div>
      </section>

      <section className="panel split-members-panel">
        <div className="budget-panel-head">
          <div>
            <span className="transfer-section-kicker">Members</span>
            <h2>Balances</h2>
          </div>
        </div>
        <div className="split-balance-grid">
          {group.balances.map((balance) => (
            <div key={balance.userId} className="split-balance-card">
              <strong>{balance.username === currentUsername ? 'You' : balance.name}</strong>
              <span
                className={`split-balance-chip${
                  balance.netBalance > 0
                    ? ' split-balance-chip-positive'
                    : balance.netBalance < 0
                      ? ' split-balance-chip-negative'
                      : ''
                }`}
              >
                {balance.netBalance === 0
                  ? 'Settled up'
                  : balance.netBalance > 0
                    ? `Owed ${formatMoney(balance.netBalance)}`
                    : `Owes ${formatMoney(-balance.netBalance)}`}
              </span>
            </div>
          ))}
        </div>

        <div className="split-add-member-row">
          <UserSearchPicker
            placeholder="Add a member by username, name, or email..."
            excludeUsernames={group.members.map((m) => m.username)}
            onSelect={handleAddMember}
          />
          {addingMember && <span className="muted">Adding...</span>}
        </div>
        {memberError && <p className="form-error">{memberError}</p>}
      </section>

      <section className="panel split-expense-panel">
        <div className="budget-panel-head">
          <div>
            <span className="transfer-section-kicker">Add expense</span>
            <h2>Log a shared cost</h2>
          </div>
        </div>

        <div className="split-expense-form">
          <label className="gateway-label">
            <span>Description</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Hotel, dinner, cab"
            />
          </label>

          <div className="split-expense-form-row">
            <label className="gateway-label">
              <span>Amount</span>
              <div className="budget-input-wrap">
                <span>₹</span>
                <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
            </label>

            <label className="gateway-label">
              <span>Paid by</span>
              <select className="gateway-select" value={paidByUsername} onChange={(e) => setPaidByUsername(e.target.value)}>
                {group.members.map((m) => (
                  <option key={m.username} value={m.username}>
                    {m.username === currentUsername ? 'You' : m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="transfer-mode-tabs">
            <button
              type="button"
              className={`transfer-mode-tab${splitType === 'equal' ? ' transfer-mode-tab-active' : ''}`}
              onClick={() => setSplitType('equal')}
            >
              Split equally
            </button>
            <button
              type="button"
              className={`transfer-mode-tab${splitType === 'custom' ? ' transfer-mode-tab-active' : ''}`}
              onClick={() => setSplitType('custom')}
            >
              Custom amounts
            </button>
          </div>

          {splitType === 'equal' ? (
            <div className="split-participant-chips">
              {group.members.map((m) => (
                <button
                  key={m.username}
                  type="button"
                  className={`split-chip${participants.has(m.username) ? ' split-chip-active' : ''}`}
                  onClick={() => toggleParticipant(m.username)}
                >
                  {m.username === currentUsername ? 'You' : m.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="split-custom-shares">
              {group.members.map((m) => (
                <label key={m.username} className="split-custom-share-row">
                  <span>{m.username === currentUsername ? 'You' : m.name}</span>
                  <div className="budget-input-wrap">
                    <span>₹</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={customShares[m.username] ?? ''}
                      onChange={(e) => setCustomShares((current) => ({ ...current, [m.username]: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                </label>
              ))}
              <p className="muted">
                Total: {formatMoney(customTotal)} {amountPaise > 0 ? `of ${formatMoney(amountPaise)}` : ''}
              </p>
            </div>
          )}

          <button type="button" className="primary-btn" onClick={handleAddExpense} disabled={saving}>
            {saving ? 'Adding...' : 'Add expense'}
          </button>
          {expenseError && <p className="form-error">{expenseError}</p>}
        </div>
      </section>

      <section className="panel split-history-panel">
        <div className="budget-panel-head">
          <div>
            <span className="transfer-section-kicker">History</span>
            <h2>
              {group.expenses.length} expense{group.expenses.length === 1 ? '' : 's'}
            </h2>
          </div>
        </div>
        {group.expenses.length === 0 ? (
          <p className="muted tx-empty-state">No expenses logged yet.</p>
        ) : (
          <div className="split-expense-list">
            {group.expenses.map((expense) => (
              <article key={expense.id} className="split-expense-row">
                <div className="split-expense-main">
                  <strong>{expense.description}</strong>
                  <span className="muted">
                    {expense.paidByUsername === currentUsername ? 'You' : expense.paidByName} paid{' '}
                    {formatMoney(expense.amount)}
                  </span>
                </div>
                <div className="split-expense-splits">
                  {expense.splits.map((split) => (
                    <span key={split.userId} className="split-expense-split-chip">
                      {split.username === currentUsername ? 'You' : split.name}: {formatMoney(split.shareAmount)}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel split-settlements-panel">
        <div className="budget-panel-head">
          <div>
            <span className="transfer-section-kicker">Settle up</span>
            <h2>Settlements</h2>
          </div>
          <button type="button" className="secondary-btn" onClick={handleGenerateSettlements} disabled={generating}>
            {generating ? 'Calculating...' : 'Generate settlements'}
          </button>
        </div>

        {settlementError && <p className="form-error">{settlementError}</p>}

        {pendingSettlements.length === 0 ? (
          <p className="muted tx-empty-state">
            No pending settlements. Add expenses, then click "Generate settlements" to compute who should pay whom.
          </p>
        ) : (
          <div className="split-settlement-list">
            {pendingSettlements.map((s) => (
              <div key={s.id} className="split-settlement-row">
                <span className="split-settlement-copy">
                  <strong>{s.fromUsername === currentUsername ? 'You' : s.fromName}</strong> owe
                  {s.fromUsername === currentUsername ? '' : 's'} <strong>{s.toUsername === currentUsername ? 'you' : s.toName}</strong>{' '}
                  <span className="split-settlement-amount">{formatMoney(s.remainingAmount)}</span>
                  {s.amountPaid > 0 && (
                    <span className="muted split-settlement-progress">
                      {formatMoney(s.amountPaid)} paid of {formatMoney(s.amount)}
                    </span>
                  )}
                </span>
                <div className="split-settlement-actions">
                  {s.fromUsername === currentUsername && (
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() =>
                        onPaySettlement({
                          groupId: group.id,
                          settlementId: s.id,
                          groupName: group.name,
                          toUsername: s.toUsername,
                          toName: s.toName,
                          remainingAmount: s.remainingAmount,
                        })
                      }
                    >
                      Pay
                    </button>
                  )}
                  {(s.fromUsername === currentUsername || s.toUsername === currentUsername) && (
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => handleMarkPaid(s.id)}
                      disabled={payingId === s.id}
                    >
                      {payingId === s.id ? 'Saving...' : 'Mark as paid'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {paidSettlements.length > 0 && (
          <div className="split-settlement-list split-settlement-list-paid">
            {paidSettlements.map((s) => (
              <div key={s.id} className="split-settlement-row split-settlement-row-paid">
                <span className="split-settlement-copy">
                  <strong>{s.fromUsername === currentUsername ? 'You' : s.fromName}</strong> paid{' '}
                  <strong>{s.toUsername === currentUsername ? 'you' : s.toName}</strong> {formatMoney(s.amount)}
                </span>
                <span className="split-settlement-status-paid">Paid</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
