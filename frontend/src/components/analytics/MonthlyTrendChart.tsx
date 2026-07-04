import { useState } from 'react'
import type { MonthSpend } from '../../api'
import { formatMoney } from '../../api'
import { SEQUENTIAL_HUE } from '../../utils/chartColors'

interface Props {
  data: MonthSpend[]
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

export function MonthlyTrendChart({ data }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)
  const max = Math.max(...data.map((d) => d.amount), 1)

  if (data.length === 0) {
    return <p className="muted tx-empty-state">No spending yet to chart.</p>
  }

  return (
    <div className="trend-chart">
      {data.map((d) => {
        const heightPercent = Math.max((d.amount / max) * 100, 4)
        const isHovered = hovered === d.month
        return (
          <div
            key={d.month}
            className="trend-chart-col"
            onMouseEnter={() => setHovered(d.month)}
            onMouseLeave={() => setHovered(null)}
          >
            {isHovered && <span className="trend-chart-tooltip">{formatMoney(d.amount)}</span>}
            <div className="trend-chart-track">
              <div
                className="trend-chart-bar"
                style={{ height: `${heightPercent}%`, background: SEQUENTIAL_HUE, opacity: isHovered ? 1 : 0.85 }}
              />
            </div>
            <span className="trend-chart-label">{formatMonthLabel(d.month)}</span>
          </div>
        )
      })}
    </div>
  )
}
