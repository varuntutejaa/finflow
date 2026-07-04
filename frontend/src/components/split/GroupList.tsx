import { useState } from 'react'
import type { GroupSummary, UserSearchResult } from '../../api'
import { formatMoney } from '../../api'
import { UserSearchPicker } from './UserSearchPicker'

interface Props {
  groups: GroupSummary[]
  loading: boolean
  onOpenGroup: (groupId: string) => void
  onCreateGroup: (name: string, memberUsernames: string[]) => Promise<void>
}

export function GroupList({ groups, loading, onOpenGroup, onCreateGroup }: Props) {
  const [name, setName] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<UserSearchResult[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePickMember = (user: UserSearchResult) => {
    setSelectedMembers((current) => (current.some((m) => m.id === user.id) ? current : [...current, user]))
  }

  const handleRemoveMember = (userId: string) => {
    setSelectedMembers((current) => current.filter((m) => m.id !== userId))
  }

  const handleCreate = async () => {
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Enter a group name.')
      return
    }
    if (selectedMembers.length === 0) {
      setError('Search and add at least one other member.')
      return
    }

    setCreating(true)
    try {
      await onCreateGroup(
        trimmedName,
        selectedMembers.map((m) => m.username)
      )
      setName('')
      setSelectedMembers([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create group')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <section className="panel split-create-panel">
        <div className="budget-panel-head">
          <div>
            <span className="transfer-section-kicker">New group</span>
            <h2>Start a group</h2>
          </div>
        </div>
        <div className="split-create-form">
          <label className="gateway-label">
            <span>Group name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Goa Trip" />
          </label>

          <label className="gateway-label">
            <span>Members</span>
            <UserSearchPicker
              placeholder="Search by username, name, or email..."
              excludeUsernames={selectedMembers.map((m) => m.username)}
              onSelect={handlePickMember}
            />
          </label>

          {selectedMembers.length > 0 && (
            <div className="split-participant-chips">
              {selectedMembers.map((m) => (
                <span key={m.id} className="split-chip split-chip-removable">
                  {m.name} (@{m.username})
                  <button type="button" onClick={() => handleRemoveMember(m.id)} aria-label={`Remove ${m.username}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <button type="button" className="primary-btn" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'Create group'}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </section>

      <section className="panel split-groups-panel">
        <div className="budget-panel-head">
          <div>
            <span className="transfer-section-kicker">Your groups</span>
            <h2>
              {groups.length} group{groups.length === 1 ? '' : 's'}
            </h2>
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading groups...</p>
        ) : groups.length === 0 ? (
          <p className="muted tx-empty-state">No groups yet — create one above to start splitting expenses.</p>
        ) : (
          <div className="split-group-grid">
            {groups.map((group) => (
              <button key={group.id} type="button" className="split-group-card" onClick={() => onOpenGroup(group.id)}>
                <strong>{group.name}</strong>
                <span className="muted">
                  {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
                </span>
                <span
                  className={`split-balance-chip${
                    group.yourNetBalance > 0
                      ? ' split-balance-chip-positive'
                      : group.yourNetBalance < 0
                        ? ' split-balance-chip-negative'
                        : ''
                  }`}
                >
                  {group.yourNetBalance === 0
                    ? 'Settled up'
                    : group.yourNetBalance > 0
                      ? `You are owed ${formatMoney(group.yourNetBalance)}`
                      : `You owe ${formatMoney(-group.yourNetBalance)}`}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
