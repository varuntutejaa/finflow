import { useCallback, useEffect, useState } from 'react'
import type { GroupDetail, GroupSummary } from '../../api'
import { createGroup, fetchGroupDetail, fetchGroups } from '../../api'
import { GroupList } from './GroupList'
import { GroupDetailView } from './GroupDetailView'

interface Props {
  currentUsername: string
  onBack: () => void
  onPaySettlement: (context: {
    groupId: string
    settlementId: string
    groupName: string
    toUsername: string
    toName: string
    remainingAmount: number
  }) => void
}

export function SplitPage({ currentUsername, onBack, onPaySettlement }: Props) {
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [groupDetail, setGroupDetail] = useState<GroupDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const refreshGroups = useCallback(async () => {
    try {
      const data = await fetchGroups()
      setGroups(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load groups')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshGroups()
  }, [refreshGroups])

  const openGroup = useCallback(async (groupId: string) => {
    setSelectedGroupId(groupId)
    setDetailLoading(true)
    try {
      const detail = await fetchGroupDetail(groupId)
      setGroupDetail(detail)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load group')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const refreshDetail = useCallback(async () => {
    if (!selectedGroupId) return
    const detail = await fetchGroupDetail(selectedGroupId)
    setGroupDetail(detail)
  }, [selectedGroupId])

  const handleCreateGroup = async (name: string, memberUsernames: string[]) => {
    const detail = await createGroup({ name, memberUsernames })
    await refreshGroups()
    setSelectedGroupId(detail.id)
    setGroupDetail(detail)
  }

  const backToList = () => {
    setSelectedGroupId(null)
    setGroupDetail(null)
    void refreshGroups()
  }

  return (
    <section className="budget-page">
      <div className="budget-page-head">
        <div>
          <span className="transfer-section-kicker">Bill splitting</span>
          <h1>{selectedGroupId ? groupDetail?.name ?? 'Group' : 'Split expenses'}</h1>
          <p className="muted">
            {selectedGroupId
              ? 'Track who paid, who owes what, and settle up with the fewest payments.'
              : 'Create a group, log shared expenses, and settle up automatically.'}
          </p>
        </div>
        <button type="button" className="link-btn" onClick={selectedGroupId ? backToList : onBack}>
          {selectedGroupId ? '← All groups' : 'Back to dashboard'}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {!selectedGroupId ? (
        <GroupList groups={groups} loading={loading} onOpenGroup={openGroup} onCreateGroup={handleCreateGroup} />
      ) : detailLoading || !groupDetail ? (
        <p className="muted">Loading group...</p>
      ) : (
        <GroupDetailView
          group={groupDetail}
          currentUsername={currentUsername}
          onRefresh={refreshDetail}
          onPaySettlement={onPaySettlement}
        />
      )}
    </section>
  )
}
