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
  idempotencyKey: string | null
  fromAccountId: string
  fromAccountName: string
  fromUsername: string
  toAccountId: string
  toAccountName: string
  toUsername: string
  category: string
  amount: number
  status: 'completed' | 'failed'
  failureReason: string | null
  createdAt: string
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

export interface ApiError {
  code: string
  message: string
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
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
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
    const err = new Error(error.message) as Error & { code: string; transaction?: Transaction }
    err.code = error.code
    err.transaction = body.transaction
    throw err
  }
  return body as T
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

export function searchUsers(query: string): Promise<UserSearchResult[]> {
  return request(`/api/users/search?q=${encodeURIComponent(query)}`)
}

export function fetchAccounts(): Promise<Account[]> {
  return request('/api/accounts')
}

export function fetchTransactions(accountId?: string): Promise<Transaction[]> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''
  return request(`/api/transactions${qs}`)
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

export function transfer(input: {
  fromAccountId: string
  toUsername: string
  amount: number
  idempotencyKey: string
  pin: string
  category: string
}): Promise<{ transaction: Transaction; replayed: boolean; accounts: Account[] }> {
  return request('/api/transactions/transfer', {
    method: 'POST',
    body: JSON.stringify(input),
  })
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
