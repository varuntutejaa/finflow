import { useState } from 'react'
import type { CategorySpend } from '../../api'
import { formatMoney } from '../../api'
import { colorForCategory } from '../../utils/chartColors'

interface Props {
  data: CategorySpend[]
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function CategoryBarChart({ data }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)
  const max = Math.max(...data.map((d) => d.amount), 1)

  if (data.length === 0) {
    return <p className="muted tx-empty-state">No spending yet to chart.</p>
  }

  return (
    <div className="chart-root">
      <div className="bar-chart">
        {data.map((d) => {
          const color = colorForCategory(d.category)
          const widthPercent = Math.max((d.amount / max) * 100, 2)
          const isHovered = hovered === d.category
          return (
            <div
              key={d.category}
              className="bar-chart-row"
              onMouseEnter={() => setHovered(d.category)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="bar-chart-label">
                <span className="bar-chart-swatch" style={{ background: color }} aria-hidden="true" />
                {titleCase(d.category)}
              </span>
              <span className="bar-chart-track">
                <span
                  className="bar-chart-fill"
                  style={{ width: `${widthPercent}%`, background: color, opacity: isHovered ? 1 : 0.88 }}
                />
                {isHovered && (
                  <span className="bar-chart-tooltip">
                    {formatMoney(d.amount)} · {d.percent}%
                  </span>
                )}
              </span>
              <span className="bar-chart-value">{formatMoney(d.amount)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
