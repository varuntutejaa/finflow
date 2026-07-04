import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { ImportInvestmentsResult, Investment, InvestmentSummary, InvestmentType } from '../../api'
import {
  INVESTMENT_TYPES,
  createInvestment,
  deleteInvestment,
  fetchInvestments,
  fetchMutualFundQuote,
  fetchStockQuote,
  formatMoney,
  importGrowwMutualFundHoldings,
  importGrowwStockHoldings,
  refreshInvestmentPrices,
  rupeesToPaise,
  searchMutualFundSuggestions,
  searchStockSuggestions,
} from '../../api'
import { colorForCategory } from '../../utils/chartColors'

interface NameSuggestion {
  label: string
  sub: string
  symbol?: string
  schemeCode?: number
}

interface Props {
  onBack: () => void
}

function titleCaseType(type: InvestmentType): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function logoInitials(inv: Investment): string {
  if (inv.symbol) {
    const letters = inv.symbol.replace(/[^A-Za-z]/g, '')
    if (letters.length > 0) return letters.slice(0, 2).toUpperCase()
  }
  const words = inv.name.trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function usesLivePricing(type: InvestmentType): boolean {
  return type !== 'gold' && type !== 'other'
}

export function InvestmentsPage({ onBack }: Props) {
  const [investments, setInvestments] = useState<Investment[]>([])
  const [summary, setSummary] = useState<InvestmentSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [platform, setPlatform] = useState('')
  const [type, setType] = useState<InvestmentType>('stock')
  const [quantity, setQuantity] = useState('')
  const [buyPrice, setBuyPrice] = useState('')
  const [currentPrice, setCurrentPrice] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [nameSuggestions, setNameSuggestions] = useState<NameSuggestion[]>([])
  const [showNameSuggestions, setShowNameSuggestions] = useState(false)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const nameFieldRef = useRef<HTMLDivElement>(null)

  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [refreshUnmatched, setRefreshUnmatched] = useState<Array<{ id: string; name: string; reason: string }>>([])
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    fetchInvestments()
      .then((data) => {
        setInvestments(data.investments)
        setSummary(data.summary)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load investments'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const trimmed = name.trim()
    if (trimmed.length < 2 || type === 'gold' || type === 'other') {
      setNameSuggestions([])
      return
    }
    setSuggestionsLoading(true)
    const handle = setTimeout(() => {
      const search =
        type === 'mutual_fund'
          ? searchMutualFundSuggestions(trimmed).then((results) =>
              results.map((r) => ({ label: r.name, sub: 'Mutual fund', schemeCode: r.schemeCode }))
            )
          : searchStockSuggestions(trimmed).then((results) =>
              results.map((r) => ({ label: r.name, sub: `${r.exchange} · ${r.symbol}`, symbol: r.symbol }))
            )
      search
        .then(setNameSuggestions)
        .catch(() => setNameSuggestions([]))
        .finally(() => setSuggestionsLoading(false))
    }, 350)
    return () => clearTimeout(handle)
  }, [name, type])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (nameFieldRef.current && !nameFieldRef.current.contains(e.target as Node)) {
        setShowNameSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectNameSuggestion = (suggestion: NameSuggestion) => {
    setName(suggestion.label)
    setSymbol(suggestion.symbol ?? '')
    setShowNameSuggestions(false)
    setNameSuggestions([])
    setFormError(null)
    setCurrentPrice('')

    const quote =
      suggestion.symbol
        ? fetchStockQuote(suggestion.symbol)
        : suggestion.schemeCode
          ? fetchMutualFundQuote(suggestion.schemeCode)
          : null
    if (!quote) return

    setQuoteLoading(true)
    quote
      .then(({ price }) => {
        setCurrentPrice(String(price))
        if (!buyPrice) setBuyPrice(String(price))
      })
      .catch(() => setFormError('Could not fetch a live price for this holding. Try another suggestion or refresh later.'))
      .finally(() => setQuoteLoading(false))
  }

  const handleImportFile = (importFn: (file: File) => Promise<ImportInvestmentsResult>) =>
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return

      setImporting(true)
      setImportMessage(null)
      setImportError(null)
      try {
        const result = await importFn(file)
        setInvestments(result.investments)
        setSummary(result.summary)
        const parts: string[] = []
        if (result.importedCount > 0) parts.push(`${result.importedCount} added`)
        if (result.updatedCount > 0) parts.push(`${result.updatedCount} updated`)
        if (result.skippedCount > 0) parts.push(`${result.skippedCount} row${result.skippedCount === 1 ? '' : 's'} skipped`)
        setImportMessage(parts.length > 0 ? parts.join(', ') : 'Nothing new to import.')
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Could not import this file')
      } finally {
        setImporting(false)
      }
    }

  const handleImportMutualFunds = handleImportFile(importGrowwMutualFundHoldings)
  const handleImportStocks = handleImportFile(importGrowwStockHoldings)

  const handleRefreshPrices = async () => {
    setRefreshing(true)
    setRefreshMessage(null)
    setRefreshUnmatched([])
    setRefreshError(null)
    try {
      const result = await refreshInvestmentPrices()
      setInvestments(result.investments)
      setSummary(result.summary)
      setRefreshMessage(
        `Updated ${result.updatedCount} of ${result.updatedCount + result.unmatchedCount} holding${
          result.updatedCount + result.unmatchedCount === 1 ? '' : 's'
        }.`
      )
      setRefreshUnmatched(result.unmatched)
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Could not refresh prices')
    } finally {
      setRefreshing(false)
    }
  }

  const resetForm = () => {
    setName('')
    setSymbol('')
    setPlatform('')
    setType('stock')
    setQuantity('')
    setBuyPrice('')
    setCurrentPrice('')
    setFormError(null)
    setNameSuggestions([])
  }

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const quantityValue = Number(quantity)
    const buyPricePaise = rupeesToPaise(buyPrice)
    const quotedCurrentPricePaise = rupeesToPaise(currentPrice)
    const requiresLivePrice = usesLivePricing(type)

    if (!name.trim()) {
      setFormError('Enter a name for this holding.')
      return
    }
    if (!platform.trim()) {
      setFormError('Enter the platform for this holding.')
      return
    }
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      setFormError('Enter a valid quantity greater than 0.')
      return
    }
    if (!Number.isInteger(buyPricePaise) || buyPricePaise < 0) {
      setFormError('Enter a valid buy price.')
      return
    }
    if (requiresLivePrice && (!Number.isInteger(quotedCurrentPricePaise) || quotedCurrentPricePaise < 0)) {
      setFormError('Select a market suggestion first so FinFlow can fetch the live price.')
      return
    }
    const currentPricePaise =
      Number.isInteger(quotedCurrentPricePaise) && quotedCurrentPricePaise >= 0 ? quotedCurrentPricePaise : buyPricePaise

    setSubmitting(true)
    try {
      const created = await createInvestment({
        name: name.trim(),
        platform: platform.trim(),
        type,
        quantity: quantityValue,
        buyPrice: buyPricePaise,
        currentPrice: currentPricePaise,
        symbol: symbol.trim() || undefined,
      })
      setInvestments((current) => {
        const existingIndex = current.findIndex((item) => item.id === created.id)
        if (existingIndex === -1) return [created, ...current]
        return current.map((item) => (item.id === created.id ? created : item))
      })
      resetForm()
      load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add this investment')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (inv: Investment) => {
    try {
      await deleteInvestment(inv.id)
      setInvestments((current) => current.filter((item) => item.id !== inv.id))
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this holding')
    }
  }

  const gainPositive = (summary?.gainLoss ?? 0) >= 0

  const allocation = useMemo(() => {
    const totals = new Map<InvestmentType, number>()
    let total = 0
    for (const inv of investments) {
      totals.set(inv.type, (totals.get(inv.type) ?? 0) + inv.currentValue)
      total += inv.currentValue
    }
    const slices = INVESTMENT_TYPES.map((t) => ({ type: t, value: totals.get(t) ?? 0 })).filter((s) => s.value > 0)
    return { total, slices }
  }, [investments])

  const portfolioAnalytics = useMemo(() => {
    const invested = summary?.investedValue ?? investments.reduce((total, inv) => total + inv.investedValue, 0)
    const current = summary?.currentValue ?? investments.reduce((total, inv) => total + inv.currentValue, 0)
    const absoluteReturn = current - invested
    const returnPercent = invested > 0 ? (absoluteReturn / invested) * 100 : 0
    const sortedByValue = [...investments].sort((a, b) => b.currentValue - a.currentValue)
    const topHolding = sortedByValue[0] ?? null
    const topHoldingShare = topHolding && current > 0 ? (topHolding.currentValue / current) * 100 : 0
    const bestPerformer = investments.length > 0 ? [...investments].sort((a, b) => b.gainLossPercent - a.gainLossPercent)[0] : null
    const weakestPerformer = investments.length > 0 ? [...investments].sort((a, b) => a.gainLossPercent - b.gainLossPercent)[0] : null
    const winners = investments.filter((inv) => inv.gainLoss >= 0).length
    const avgHoldingValue = investments.length > 0 ? current / investments.length : 0

    const rows = INVESTMENT_TYPES.map((assetType) => {
      const holdings = investments.filter((inv) => inv.type === assetType)
      const assetInvested = holdings.reduce((total, inv) => total + inv.investedValue, 0)
      const assetCurrent = holdings.reduce((total, inv) => total + inv.currentValue, 0)
      const assetGainLoss = assetCurrent - assetInvested
      return {
        type: assetType,
        count: holdings.length,
        invested: assetInvested,
        current: assetCurrent,
        gainLoss: assetGainLoss,
        gainLossPercent: assetInvested > 0 ? (assetGainLoss / assetInvested) * 100 : 0,
        share: current > 0 ? (assetCurrent / current) * 100 : 0,
      }
    })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.current - a.current)

    return {
      invested,
      current,
      absoluteReturn,
      returnPercent,
      topHolding,
      topHoldingShare,
      bestPerformer,
      weakestPerformer,
      winners,
      avgHoldingValue,
      rows,
    }
  }, [investments, summary])

  const allocationGradient = useMemo(() => {
    if (allocation.slices.length === 0) return 'conic-gradient(var(--border) 0% 100%)'
    let cumulative = 0
    const parts = allocation.slices.map((slice) => {
      const pct = allocation.total > 0 ? (slice.value / allocation.total) * 100 : 0
      const start = cumulative
      cumulative += pct
      return `${colorForCategory(slice.type)} ${start}% ${cumulative}%`
    })
    return `conic-gradient(${parts.join(', ')})`
  }, [allocation])

  return (
    <section className="budget-page investment-page">
      <div className="budget-page-head investment-page-head">
        <div>
          <span className="transfer-section-kicker">Investments</span>
          <h1>Portfolio Command Center</h1>
          <p className="muted">
            Track holdings, allocation, returns, and imported Groww positions across every broker in one polished view.
          </p>
        </div>
        <div className="investment-header-actions">
          <button type="button" className="secondary-btn" onClick={handleRefreshPrices} disabled={refreshing || investments.length === 0}>
            {refreshing ? 'Refreshing...' : 'Refresh prices'}
          </button>
          <button type="button" className="link-btn" onClick={onBack}>
            Back to dashboard
          </button>
        </div>
      </div>

      {(refreshMessage || refreshError || refreshUnmatched.length > 0) && (
        <div className="investment-refresh-status">
          {refreshMessage && <p className="form-success">{refreshMessage}</p>}
          {refreshError && <p className="form-error">{refreshError}</p>}
          {refreshUnmatched.length > 0 && (
            <p className="muted">
              Couldn't match: {refreshUnmatched.map((u) => u.name).join(', ')}
            </p>
          )}
        </div>
      )}

      <section className="panel investment-import-strip">
        <div className="investment-import-copy">
          <div>
            <span className="transfer-section-kicker">Import</span>
            <h2>Import Groww holdings</h2>
          </div>
          <p className="muted">
            Upload a holdings statement to add or refresh mutual funds and stocks without creating duplicates.
          </p>
        </div>
        <span className="investment-import-filetype">.xlsx</span>
        <div className="investment-import-buttons">
          <label className="secondary-btn analytics-upload-btn">
            {importing ? 'Importing...' : 'Import mutual funds'}
            <input type="file" accept=".xlsx" onChange={handleImportMutualFunds} disabled={importing} hidden />
          </label>
          <label className="secondary-btn analytics-upload-btn">
            {importing ? 'Importing...' : 'Import stocks'}
            <input type="file" accept=".xlsx" onChange={handleImportStocks} disabled={importing} hidden />
          </label>
        </div>
        {importMessage && <p className="form-success">{importMessage}</p>}
        {importError && <p className="form-error">{importError}</p>}
      </section>

      {summary && (
        <div className="investment-kpi-grid">
          <div className="analytics-stat-tile investment-kpi-card investment-kpi-card-primary">
            <span className="muted">Invested</span>
            <strong>{formatMoney(summary.investedValue)}</strong>
            <small>Capital deployed across {summary.holdingCount} holdings</small>
          </div>
          <div className="analytics-stat-tile investment-kpi-card">
            <span className="muted">Current value</span>
            <strong>{formatMoney(summary.currentValue)}</strong>
            <small>Mark-to-market portfolio value</small>
          </div>
          <div className="analytics-stat-tile investment-kpi-card">
            <span className="muted">Net return</span>
            <strong className={gainPositive ? 'tx-amount-in' : 'tx-amount-out'}>
              {gainPositive ? '+' : ''}
              {formatMoney(summary.gainLoss)} ({gainPositive ? '+' : ''}
              {summary.gainLossPercent}%)
            </strong>
            <small>{portfolioAnalytics.winners} positions at or above cost</small>
          </div>
          <div className="analytics-stat-tile investment-kpi-card">
            <span className="muted">Largest position</span>
            <strong>{portfolioAnalytics.topHolding ? `${portfolioAnalytics.topHoldingShare.toFixed(1)}%` : '0%'}</strong>
            <small>{portfolioAnalytics.topHolding?.name ?? 'No holdings yet'}</small>
          </div>
        </div>
      )}

      <section className="panel investment-overview-panel">
        <div className="tx-panel-head">
          <div>
            <span className="transfer-section-kicker">Overview</span>
            <h2>Portfolio analytics</h2>
          </div>
          <span className="tx-panel-count">{allocation.slices.length} asset classes</span>
        </div>
        <div className="investment-overview-grid">
          <div className="investment-overview-block">
            <h3>Asset allocation</h3>
            {investments.length === 0 ? (
              <p className="muted tx-empty-state">Add a holding to see your allocation breakdown.</p>
            ) : (
              <div className="investment-allocation">
                <div className="investment-donut" style={{ background: allocationGradient }}>
                  <div className="investment-donut-hole">
                    <span className="muted">Current value</span>
                    <strong>{formatMoney(allocation.total)}</strong>
                  </div>
                </div>
                <ul className="investment-allocation-legend">
                  {allocation.slices.map((slice) => (
                    <li key={slice.type}>
                      <span className="investment-allocation-swatch" style={{ background: colorForCategory(slice.type) }} />
                      <span className="investment-allocation-label">{titleCaseType(slice.type)}</span>
                      <span className="investment-allocation-value">{formatMoney(slice.value)}</span>
                      <span className="investment-allocation-pct">
                        {allocation.total > 0 ? Math.round((slice.value / allocation.total) * 100) : 0}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="investment-overview-block">
            <h3>Health metrics</h3>
            <div className="investment-health-grid">
              <div className="investment-health-metric">
                <span className="muted">Average return</span>
                <strong className={portfolioAnalytics.returnPercent >= 0 ? 'tx-amount-in' : 'tx-amount-out'}>
                  {formatPercent(portfolioAnalytics.returnPercent)}
                </strong>
              </div>
              <div className="investment-health-metric">
                <span className="muted">Average holding</span>
                <strong>{formatMoney(portfolioAnalytics.avgHoldingValue)}</strong>
              </div>
              <div className="investment-health-metric">
                <span className="muted">Best performer</span>
                <strong>{portfolioAnalytics.bestPerformer ? formatPercent(portfolioAnalytics.bestPerformer.gainLossPercent) : '0.00%'}</strong>
                <small>{portfolioAnalytics.bestPerformer?.name ?? 'No holdings yet'}</small>
              </div>
              <div className="investment-health-metric">
                <span className="muted">Needs review</span>
                <strong>{portfolioAnalytics.weakestPerformer ? formatPercent(portfolioAnalytics.weakestPerformer.gainLossPercent) : '0.00%'}</strong>
                <small>{portfolioAnalytics.weakestPerformer?.name ?? 'No holdings yet'}</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel investment-asset-panel">
        <div className="tx-panel-head">
          <div>
            <span className="transfer-section-kicker">Performance</span>
            <h2>Asset class analytics</h2>
          </div>
          <span className="tx-panel-count">{portfolioAnalytics.rows.length} rows</span>
        </div>
        {portfolioAnalytics.rows.length === 0 ? (
          <p className="muted tx-empty-state">Asset class analytics will appear after you add holdings.</p>
        ) : (
          <div className="investment-asset-table-scroll">
            <table className="investment-asset-table">
              <thead>
                <tr>
                  <th>Asset class</th>
                  <th>Holdings</th>
                  <th>Allocation</th>
                  <th>Invested</th>
                  <th>Current</th>
                  <th>Return</th>
                </tr>
              </thead>
              <tbody>
                {portfolioAnalytics.rows.map((row) => {
                  const positive = row.gainLoss >= 0
                  return (
                    <tr key={row.type}>
                      <td>
                        <div className="investment-asset-cell">
                          <span className="investment-allocation-swatch" style={{ background: colorForCategory(row.type) }} />
                          <strong>{titleCaseType(row.type)}</strong>
                        </div>
                      </td>
                      <td>{row.count}</td>
                      <td>
                        <div className="investment-share-cell">
                          <span className="investment-share-track">
                            <span
                              className="investment-share-fill"
                              style={{ width: `${Math.min(100, row.share)}%`, background: colorForCategory(row.type) }}
                            />
                          </span>
                          <strong>{row.share.toFixed(1)}%</strong>
                        </div>
                      </td>
                      <td>{formatMoney(row.invested)}</td>
                      <td>{formatMoney(row.current)}</td>
                      <td className={positive ? 'tx-amount-in' : 'tx-amount-out'}>
                        {positive ? '+' : ''}
                        {formatMoney(row.gainLoss)} ({formatPercent(row.gainLossPercent)})
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel investment-form-panel">
        <div className="budget-panel-head">
          <div>
            <span className="transfer-section-kicker">Add</span>
            <h2>Add a holding</h2>
          </div>
        </div>
        <form className="investment-form" onSubmit={handleAdd}>
          <div className="fields-row">
            <div className="investment-name-field" ref={nameFieldRef}>
              <label className="gateway-label">
                <span>Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setSymbol('')
                    setCurrentPrice('')
                    setShowNameSuggestions(true)
                  }}
                  onFocus={() => setShowNameSuggestions(true)}
                  placeholder={type === 'mutual_fund' ? 'e.g. HDFC Defence Fund' : 'e.g. Reliance Industries'}
                  autoComplete="off"
                  required
                />
              </label>
              {showNameSuggestions && (suggestionsLoading || nameSuggestions.length > 0) && (
                <ul className="suggestions-list">
                  {suggestionsLoading && nameSuggestions.length === 0 ? (
                    <li>
                      <span className="suggestion-main">
                        <span className="suggestion-name">Searching...</span>
                      </span>
                    </li>
                  ) : (
                    nameSuggestions.map((s, i) => (
                      <li key={`${s.label}-${i}`}>
                        <button type="button" onClick={() => selectNameSuggestion(s)}>
                          <span className="suggestion-main">
                            <span className="suggestion-name-row">
                              <span className="suggestion-name">{s.label}</span>
                            </span>
                            <span className="suggestion-email">{s.sub}</span>
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            <label className="gateway-label">
              <span>Platform</span>
              <input
                type="text"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                placeholder="e.g. Zerodha, Groww"
                required
              />
            </label>
          </div>

          <div className="fields-row">
            <label className="gateway-label">
              <span>Type</span>
              <select
                className="gateway-select"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as InvestmentType)
                  setSymbol('')
                  setCurrentPrice('')
                  setNameSuggestions([])
                }}
                required
              >
                {INVESTMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCaseType(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="gateway-label">
              <span>Quantity / units</span>
              <input
                type="number"
                min="0"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                required
              />
            </label>
          </div>

          <div className="fields-row">
            <label className="gateway-label">
              <span>Buy price (per unit)</span>
              <div className="budget-input-wrap">
                <span>₹</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={buyPrice}
                  onChange={(e) => setBuyPrice(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
            </label>
            <label className="gateway-label">
              <span>Live price (per unit){quoteLoading && ' · fetching...'}</span>
              <div className="budget-input-wrap">
                <span>₹</span>
                <input
                  type="number"
                  value={currentPrice}
                  placeholder={
                    usesLivePricing(type)
                      ? quoteLoading
                        ? 'Fetching live price...'
                        : 'Select a suggestion'
                      : 'Uses buy price'
                  }
                  disabled
                />
              </div>
              <small className="investment-live-price-note">
                {usesLivePricing(type)
                  ? currentPrice
                    ? 'Fetched from market data'
                    : 'Locked until you select a market suggestion'
                  : 'Manual asset types use buy price as the starting value'}
              </small>
            </label>
          </div>

          {formError && <p className="form-error">{formError}</p>}

          <button type="submit" className="primary-btn primary-btn-block" disabled={submitting || quoteLoading}>
            {submitting ? 'Adding...' : 'Add holding'}
          </button>
        </form>
      </section>

      <section className="panel investment-holdings-panel">
        <div className="tx-panel-head">
          <div>
            <span className="transfer-section-kicker">Holdings</span>
            <h2>Your investments</h2>
          </div>
          <span className="tx-panel-count">{investments.length} holdings</span>
        </div>

        {error && <p className="form-error">{error}</p>}

        {loading && investments.length === 0 ? (
          <p className="muted tx-empty-state">Loading investments...</p>
        ) : investments.length === 0 ? (
          <p className="muted tx-empty-state">No investments yet. Add your first holding above.</p>
        ) : (
          <div className="investment-table-scroll">
            <table className="investment-table">
              <thead>
                <tr>
                  <th>Holding</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Buy</th>
                  <th>Current</th>
                  <th>Invested</th>
                  <th>Value</th>
                  <th>Gain / loss</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {investments.map((inv) => {
                  const positive = inv.gainLoss >= 0
                  return (
                    <tr className="investment-table-row" key={inv.id}>
                      <td>
                        <div className="investment-holding-cell">
                          <span className="investment-logo" style={{ background: colorForCategory(inv.type) }}>
                            {logoInitials(inv)}
                          </span>
                          <span className="investment-holding-copy">
                            <strong>{inv.name}</strong>
                            <span className="muted">
                              {inv.platform}
                              {inv.symbol ? ` · ${inv.symbol}` : ''}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td>{titleCaseType(inv.type)}</td>
                      <td>{inv.quantity}</td>
                      <td>{formatMoney(inv.buyPrice)}</td>
                      <td>{formatMoney(inv.currentPrice)}</td>
                      <td>{formatMoney(inv.investedValue)}</td>
                      <td>{formatMoney(inv.currentValue)}</td>
                      <td className={positive ? 'tx-amount-in' : 'tx-amount-out'}>
                        {positive ? '+' : ''}
                        {formatMoney(inv.gainLoss)} ({positive ? '+' : ''}
                        {inv.gainLossPercent}%)
                      </td>
                      <td>
                        <div className="investment-table-actions">
                          <button type="button" className="link-btn" onClick={() => handleDelete(inv)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
