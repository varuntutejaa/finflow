export interface User {
  id: string
  username: string
  email: string
  name: string
  createdAt: string
}

export interface UserSearchResult {
  id: string
  username: string
  name: string
  email: string
  isSelf: boolean
}

export interface Account {
  id: string
  userId: string
  accountName: string
  balance: number
  createdAt: string
}

export interface Transaction {
  id: string
  referenceNumber: string | null
  idempotencyKey: string | null
  fromAccountId: string
  fromAccountName: string
  fromUsername: string
  fromName: string
  toAccountId: string
  toAccountName: string
  toUsername: string
  toName: string
  category: string
  note: string | null
  amount: number
  status: 'completed' | 'failed'
  failureReason: string | null
  isAutoMandate: boolean
  isQrPayment: boolean
  createdAt: string
}

export interface TransactionFilters {
  accountId?: string
  search?: string
  category?: string
  dateFrom?: string
  dateTo?: string
  minAmount?: number
  maxAmount?: number
  direction?: 'sent' | 'received'
  status?: 'completed' | 'failed'
  referenceId?: string
  limit?: number
  offset?: number
}

export interface BudgetSummary {
  id: string
  category: string
  monthlyLimit: number
  spent: number
  remaining: number
  utilizationPercent: number
  thresholdPercent: number
  status: 'healthy' | 'warning' | 'exceeded'
  monthKey: string
}

export interface GroupSummary {
  id: string
  name: string
  createdAt: string
  memberCount: number
  yourNetBalance: number
}

export interface GroupMember {
  id: string
  username: string
  name: string
}

export interface ExpenseSplit {
  userId: string
  username: string
  name: string
  shareAmount: number
}

export interface Expense {
  id: string
  description: string
  amount: number
  paidByUserId: string
  paidByUsername: string
  paidByName: string
  createdAt: string
  splits: ExpenseSplit[]
}

export interface GroupBalance {
  userId: string
  username: string
  name: string
  totalPaid: number
  totalOwed: number
  netBalance: number
}

export interface Settlement {
  id: string
  fromUserId: string
  fromUsername: string
  fromName: string
  toUserId: string
  toUsername: string
  toName: string
  amount: number
  amountPaid: number
  remainingAmount: number
  status: 'pending' | 'paid'
  createdAt: string
  paidAt: string | null
}

export interface GroupDetail {
  id: string
  name: string
  createdAt: string
  members: GroupMember[]
  expenses: Expense[]
  balances: GroupBalance[]
  settlements: Settlement[]
}

export interface ApiError {
  code: string
  message: string
  unlockAt?: string
  attemptsRemaining?: number
}

const BASE_URL = import.meta.env.VITE_API_URL ?? ''
const TOKEN_STORAGE_KEY = 'finflow_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  // FormData bodies must NOT get an explicit Content-Type — the browser sets
  // one itself (with the multipart boundary), and overriding it here would
  // break the upload.
  const isFormData = init?.body instanceof FormData
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  const contentType = res.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')
  const body = isJson ? await res.json() : await res.text()

  if (!isJson) {
    const preview = typeof body === 'string' ? body.slice(0, 48).replace(/\s+/g, ' ') : ''
    throw new Error(
      `Non-JSON response from ${BASE_URL || 'current origin'}${path}${preview ? ` (${preview}...)` : ''}`
    )
  }

  if (!res.ok) {
    const error: ApiError = body.error ?? { code: 'UNKNOWN', message: 'Request failed' }
    const err = new Error(error.message) as Error & {
      code: string
      transaction?: Transaction
      unlockAt?: string
      attemptsRemaining?: number
    }
    err.code = error.code
    err.unlockAt = error.unlockAt
    err.attemptsRemaining = error.attemptsRemaining
    err.transaction = body.transaction
    throw err
  }
  return body as T
}

async function downloadFile(path: string) {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })

  if (!res.ok) {
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const body = await res.json()
      const error: ApiError = body.error ?? { code: 'UNKNOWN', message: 'Download failed' }
      throw new Error(error.message)
    }
    throw new Error('Download failed')
  }

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const filenameMatch = disposition.match(/filename="([^"]+)"/)
  const filename = filenameMatch?.[1] ?? `finflow-export-${new Date().toISOString().slice(0, 10)}.csv`
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function signup(input: {
  username: string
  email: string
  password: string
  name: string
}): Promise<{ user: User; token: string; needsPinSetup: boolean }> {
  return request('/api/auth/signup', { method: 'POST', body: JSON.stringify(input) })
}

export function login(input: { identifier: string; password: string }): Promise<{ user: User; token: string }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify(input) })
}

export function fetchMe(): Promise<User> {
  return request('/api/auth/me')
}

export function setUpiPin(input: { pin: string; pinConfirm: string }): Promise<{ success: true }> {
  return request('/api/auth/pin', { method: 'POST', body: JSON.stringify(input) })
}

export interface UsernameCheck {
  valid: boolean
  available: boolean
  message: string
}

export function checkUsername(username: string): Promise<UsernameCheck> {
  return request(`/api/auth/check-username?username=${encodeURIComponent(username)}`)
}

export function verifyPin(pin: string): Promise<{ valid: true }> {
  return request('/api/auth/verify-pin', { method: 'POST', body: JSON.stringify({ pin }) })
}

export function fetchPinLockoutStatus(): Promise<{ locked: boolean; unlockAt: string | null }> {
  return request('/api/auth/pin-lockout')
}

export function searchUsers(query: string): Promise<UserSearchResult[]> {
  return request(`/api/users/search?q=${encodeURIComponent(query)}`)
}

export function fetchAccounts(): Promise<Account[]> {
  return request('/api/accounts')
}

export function fetchTransactions(filters: TransactionFilters = {}): Promise<Transaction[]> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return request(`/api/transactions${qs ? `?${qs}` : ''}`)
}

// Like fetchTransactions, but for the History page's paged view: passing
// `limit` opts the backend into LIMIT/OFFSET + an X-Total-Count header
// instead of returning the whole matching set, so browsing a large ledger
// doesn't ship (or render) every row at once. Bypasses the shared `request`
// helper since that only returns the parsed body, not response headers.
export async function fetchTransactionsPage(
  filters: TransactionFilters = {}
): Promise<{ transactions: Transaction[]; total: number }> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  const token = getToken()
  const res = await fetch(`${BASE_URL}/api/transactions${qs ? `?${qs}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const body = await res.json()
  if (!res.ok) {
    const error: ApiError = body.error ?? { code: 'UNKNOWN', message: 'Request failed' }
    const err = new Error(error.message) as Error & { code: string }
    err.code = error.code
    throw err
  }
  const totalHeader = res.headers.get('X-Total-Count')
  const total = totalHeader !== null ? Number(totalHeader) : body.length
  return { transactions: body as Transaction[], total }
}

export function downloadTransactionsCsv(filters: TransactionFilters = {}): Promise<void> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return downloadFile(`/api/transactions/export.csv${qs ? `?${qs}` : ''}`)
}

export function downloadAccountStatementCsv(accountId: string): Promise<void> {
  return downloadFile(`/api/transactions/accounts/${encodeURIComponent(accountId)}/statement.csv`)
}

export function fetchBudgets(): Promise<{ categories: string[]; budgets: BudgetSummary[] }> {
  return request('/api/budgets')
}

export function saveBudgets(input: {
  budgets: Array<{ category: string; monthlyLimit: number; thresholdPercent?: number }>
}): Promise<{ categories: string[]; budgets: BudgetSummary[] }> {
  return request('/api/budgets', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function deleteBudgetCategory(category: string): Promise<{ categories: string[]; budgets: BudgetSummary[] }> {
  return request(`/api/budgets/${encodeURIComponent(category)}`, {
    method: 'DELETE',
  })
}

export function selfTransfer(input: {
  fromAccountId: string
  toAccountId: string
  amount: number
  idempotencyKey: string
  pin: string
  note?: string
}): Promise<{ transaction: Transaction; replayed: boolean; accounts: Account[] }> {
  return request('/api/transactions/self-transfer', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateTransactionCategory(transactionId: string, category: string): Promise<Transaction> {
  return request(`/api/transactions/${encodeURIComponent(transactionId)}/category`, {
    method: 'PATCH',
    body: JSON.stringify({ category }),
  })
}

export function updateTransaction(
  transactionId: string,
  input: { category?: string; note?: string | null }
): Promise<Transaction> {
  return request(`/api/transactions/${encodeURIComponent(transactionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function transfer(input: {
  fromAccountId: string
  toUsername: string
  amount: number
  idempotencyKey: string
  pin: string
  category: string
  note?: string
  isQrPayment?: boolean
}): Promise<{ transaction: Transaction; replayed: boolean; accounts: Account[] }> {
  return request('/api/transactions/transfer', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function fetchGroups(): Promise<GroupSummary[]> {
  return request('/api/groups')
}

export function createGroup(input: { name: string; memberUsernames: string[] }): Promise<GroupDetail> {
  return request('/api/groups', { method: 'POST', body: JSON.stringify(input) })
}

export function fetchGroupDetail(groupId: string): Promise<GroupDetail> {
  return request(`/api/groups/${encodeURIComponent(groupId)}`)
}

export function addGroupMember(groupId: string, username: string): Promise<GroupDetail> {
  return request(`/api/groups/${encodeURIComponent(groupId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ username }),
  })
}

export function removeGroupMember(groupId: string, username: string): Promise<GroupDetail> {
  return request(`/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(username)}`, {
    method: 'DELETE',
  })
}

export function addExpense(
  groupId: string,
  input: {
    description: string
    amount: number
    paidByUsername?: string
    splitType: 'equal' | 'custom'
    participantUsernames?: string[]
    customSplits?: Array<{ username: string; shareAmount: number }>
  }
): Promise<GroupDetail> {
  return request(`/api/groups/${encodeURIComponent(groupId)}/expenses`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function generateSettlements(groupId: string): Promise<GroupDetail> {
  return request(`/api/groups/${encodeURIComponent(groupId)}/settlements/generate`, { method: 'POST' })
}

export function markSettlementPaid(groupId: string, settlementId: string): Promise<GroupDetail> {
  return request(`/api/groups/${encodeURIComponent(groupId)}/settlements/${encodeURIComponent(settlementId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'paid' }),
  })
}

export function paySettlement(
  groupId: string,
  settlementId: string,
  input: { amount: number; transactionId: string }
): Promise<GroupDetail> {
  return request(`/api/groups/${encodeURIComponent(groupId)}/settlements/${encodeURIComponent(settlementId)}/pay`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export interface ImportedTransaction {
  id: string
  source: 'csv' | 'pdf'
  merchant: string
  amount: number
  entryType: 'debit' | 'credit'
  category: string
  occurredAt: string
  rawText: string | null
  importedAt: string
  batchId: string | null
}

export interface ImportResult {
  imported: ImportedTransaction[]
  importedCount: number
  skippedCount: number
  duplicateCount: number
  batchId: string
}

export function importCsvStatement(file: File): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('csv', file)
  return request('/api/imports/csv', { method: 'POST', body: formData })
}

export function importPdfStatement(file: File): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('pdf', file)
  return request('/api/imports/pdf', { method: 'POST', body: formData })
}

export function fetchImportedTransactions(filters: { category?: string; dateFrom?: string; dateTo?: string } = {}): Promise<
  ImportedTransaction[]
> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return request(`/api/imports${qs ? `?${qs}` : ''}`)
}

export function updateImportedTransactionCategory(id: string, category: string): Promise<ImportedTransaction> {
  return request(`/api/imports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ category }),
  })
}

export function deleteImportedTransaction(id: string): Promise<{ success: true }> {
  return request(`/api/imports/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function rollbackImportBatch(batchId: string): Promise<{ success: true; deletedCount: number }> {
  return request(`/api/imports/batch/${encodeURIComponent(batchId)}`, { method: 'DELETE' })
}

export interface CategorySpend {
  category: string
  amount: number
  percent: number
}

export interface MonthSpend {
  month: string
  amount: number
}

export interface MerchantSpend {
  merchant: string
  amount: number
  count: number
}

export interface RecurringExpense {
  merchant: string
  category: string
  occurrences: number
  averageAmount: number
  lastAmount: number
  lastOccurredAt: string
  cadence: 'Monthly' | 'Weekly' | 'Biweekly' | 'Yearly' | 'Recurring'
}

export interface SpendingAnalytics {
  totalSpent: number
  totalCredited: number
  transactionCount: number
  byCategory: CategorySpend[]
  byMonth: MonthSpend[]
  topMerchants: MerchantSpend[]
  recurring: RecurringExpense[]
}

export function fetchSpendingAnalytics(filters: { dateFrom?: string; dateTo?: string } = {}): Promise<SpendingAnalytics> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return request(`/api/analytics/spending${qs ? `?${qs}` : ''}`)
}

export type RecurringFrequency = 'once' | 'daily' | 'weekly' | 'monthly'

export interface RecurringPayment {
  id: string
  fromAccountId: string
  fromAccountName: string
  toUsername: string
  toName: string
  category: string
  amount: number
  frequency: RecurringFrequency
  nextRunAt: string
  lastRunAt: string | null
  lastStatus: 'completed' | 'failed' | null
  active: boolean
  createdAt: string
}

export function fetchRecurringPayments(): Promise<RecurringPayment[]> {
  return request('/api/recurring')
}

export function createRecurringPayment(input: {
  fromAccountId: string
  toUsername: string
  amount: number
  category: string
  frequency: RecurringFrequency
  startAt: string
  pin: string
}): Promise<RecurringPayment> {
  return request('/api/recurring', { method: 'POST', body: JSON.stringify(input) })
}

export function cancelRecurringPayment(id: string): Promise<{ success: true; action: 'cancelled' | 'deleted' }> {
  return request(`/api/recurring/${id}`, { method: 'DELETE' })
}

export type InvestmentType = 'stock' | 'mutual_fund' | 'etf' | 'crypto' | 'gold' | 'other'

export const INVESTMENT_TYPES: InvestmentType[] = ['stock', 'mutual_fund', 'etf', 'crypto', 'gold', 'other']

export interface Investment {
  id: string
  name: string
  platform: string
  type: InvestmentType
  quantity: number
  buyPrice: number
  currentPrice: number
  symbol: string | null
  notes: string | null
  investedValue: number
  currentValue: number
  gainLoss: number
  gainLossPercent: number
  createdAt: string
  updatedAt: string
}

export interface InvestmentSummary {
  investedValue: number
  currentValue: number
  gainLoss: number
  gainLossPercent: number
  holdingCount: number
}

export interface InvestmentInput {
  name: string
  platform?: string
  type?: InvestmentType
  quantity: number
  buyPrice: number
  currentPrice: number
  notes?: string
  symbol?: string
}

export interface StockSuggestion {
  name: string
  symbol: string
  exchange: string
}

export interface MutualFundSuggestion {
  name: string
  schemeCode: number
}

export function fetchInvestments(): Promise<{ investments: Investment[]; summary: InvestmentSummary }> {
  return request('/api/investments')
}

export function searchStockSuggestions(query: string): Promise<StockSuggestion[]> {
  return request(`/api/investments/search/stocks?q=${encodeURIComponent(query)}`)
}

export function searchMutualFundSuggestions(query: string): Promise<MutualFundSuggestion[]> {
  return request(`/api/investments/search/mutual-funds?q=${encodeURIComponent(query)}`)
}

export function fetchStockQuote(symbol: string): Promise<{ price: number }> {
  return request(`/api/investments/quote/stock?symbol=${encodeURIComponent(symbol)}`)
}

export function fetchMutualFundQuote(schemeCode: number): Promise<{ price: number }> {
  return request(`/api/investments/quote/mutual-fund?schemeCode=${schemeCode}`)
}

export function createInvestment(input: InvestmentInput): Promise<Investment> {
  return request('/api/investments', { method: 'POST', body: JSON.stringify(input) })
}

export function updateInvestment(id: string, input: Partial<InvestmentInput>): Promise<Investment> {
  return request(`/api/investments/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function deleteInvestment(id: string): Promise<{ success: true }> {
  return request(`/api/investments/${id}`, { method: 'DELETE' })
}

export interface RefreshPricesResult {
  investments: Investment[]
  summary: InvestmentSummary
  updatedCount: number
  unmatchedCount: number
  unmatched: Array<{ id: string; name: string; reason: string }>
}

export function refreshInvestmentPrices(): Promise<RefreshPricesResult> {
  return request('/api/investments/refresh-prices', { method: 'POST' })
}

export interface ImportInvestmentsResult {
  investments: Investment[]
  summary: InvestmentSummary
  importedCount: number
  updatedCount: number
  skippedCount: number
}

export function importGrowwMutualFundHoldings(file: File): Promise<ImportInvestmentsResult> {
  const formData = new FormData()
  formData.append('file', file)
  return request('/api/investments/import/groww-mf', { method: 'POST', body: formData })
}

export function importGrowwStockHoldings(file: File): Promise<ImportInvestmentsResult> {
  const formData = new FormData()
  formData.append('file', file)
  return request('/api/investments/import/groww-stocks', { method: 'POST', body: formData })
}

// Money is stored server-side as an integer count of the currency's minor unit
// (paise for INR). These convert to/from the whole-rupee value shown to users.
export const MAX_TRANSFER_AMOUNT_PAISE = 50000000
export const BUDGET_CATEGORIES = ['food', 'transport', 'shopping', 'bills'] as const
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number]

export function rupeesToPaise(value: string): number {
  const parsed = Number(value)
  return Math.round(parsed * 100)
}

export function formatMoney(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
  })
}
