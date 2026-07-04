import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import jsQR from 'jsqr'
import type { Account, RecurringFrequency, RecurringPayment, Transaction, UserSearchResult } from '../../api'
import {
  BUDGET_CATEGORIES,
  MAX_TRANSFER_AMOUNT_PAISE,
  rupeesToPaise,
  formatMoney,
  searchUsers,
  transfer,
  selfTransfer,
  cancelRecurringPayment,
  createRecurringPayment,
  fetchRecurringPayments,
} from '../../api'
import { PinModal } from '../shared/PinModal'
import { PayConfirmPopup } from './PayConfirmPopup'
import { ScanQrModal } from './ScanQrModal'
import { playSuccessTing } from '../../utils/sound'

function parseQrPayLink(data: string): { username: string; name: string } | null {
  try {
    const url = new URL(data)
    const username = url.searchParams.get('to')
    if (!username) return null
    return { username, name: url.searchParams.get('name') ?? username }
  } catch {
    return null
  }
}

function decodeQrFromImageFile(file: File): Promise<{ username: string; name: string } | null> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not read that image.'))
        return
      }
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      resolve(code ? parseQrPayLink(code.data) : null)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not read that image.'))
    }
    img.src = objectUrl
  })
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export interface SettlementPrefill {
  groupId: string
  settlementId: string
  groupName: string
  toUsername: string
  toName: string
  amountPaise: number
}

export interface QrPrefill {
  toUsername: string
  toName: string
  amountPaise: number
}

interface Props {
  accounts: Account[]
  transactions?: Transaction[]
  currentUsername?: string
  onTransferred: () => void
  settlementPrefill?: SettlementPrefill | null
  onSettlementPaid?: (context: { groupId: string; settlementId: string }, transactionId: string, amountPaise: number) => void
  onCancelSettlement?: () => void
  qrPrefill?: QrPrefill | null
  onQrPaymentDone?: () => void
  onCancelQrPayment?: () => void
  onAccountLocked?: (unlockAt: string) => void
  budgetingEnabled?: boolean
  budgetCategories?: string[]
}

interface PendingPersonTransfer {
  kind: 'person'
  fromAccountId: string
  fromAccountName: string
  toUsername: string
  toLabel: string
  category: string
  note?: string
  amountCents: number
  idempotencyKey: string
  settlementContext?: { groupId: string; settlementId: string } | null
  isQrPayment?: boolean
}

interface PendingOwnTransfer {
  kind: 'own'
  note?: string
  fromAccountId: string
  fromAccountName: string
  toAccountId: string
  toAccountName: string
  amountCents: number
  idempotencyKey: string
}

type PendingTransfer = PendingPersonTransfer | PendingOwnTransfer

interface PaymentPopup {
  stage: 'processing' | 'done'
  amountCents: number
  recipientName: string
  transactionId?: string
  note?: string
  category?: string
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function PayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 4h12M6 4c4 0 7 1.5 7 4.5S16 13 12 13H6l8 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 8.5h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function SavingsTransferIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 17L10 11L14 15L20 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 8H20V14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="17" width="18" height="4" rx="1" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function ScanQrIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M14 14h3v3h-3zM20 14v3M14 20h3M17.5 20.5h.01M20 17.5v.01"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RecurringIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12a8 8 0 0113.66-5.66L20 8M20 4v4h-4M20 12a8 8 0 01-13.66 5.66L4 16M4 20v-4h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function hasValidCurrencyPrecision(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim())
}

function frequencyLabel(frequency: RecurringFrequency) {
  if (frequency === 'once') return 'one-time'
  return frequency === 'daily' ? 'every day' : frequency === 'weekly' ? 'every week' : 'every month'
}

const WEEKDAYS = [
  { value: 1, label: 'Mon', full: 'Monday' },
  { value: 2, label: 'Tue', full: 'Tuesday' },
  { value: 3, label: 'Wed', full: 'Wednesday' },
  { value: 4, label: 'Thu', full: 'Thursday' },
  { value: 5, label: 'Fri', full: 'Friday' },
  { value: 6, label: 'Sat', full: 'Saturday' },
  { value: 0, label: 'Sun', full: 'Sunday' },
]

function ordinal(n: number) {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function formatTimeLabel(time: string) {
  const [hh, mm] = time.split(':').map(Number)
  const period = hh >= 12 ? 'PM' : 'AM'
  const hour12 = hh % 12 === 0 ? 12 : hh % 12
  return `${hour12}:${mm.toString().padStart(2, '0')} ${period}`
}

function defaultRecurringDate() {
  const date = new Date()
  date.setMinutes(date.getMinutes() + 1, 0, 0)
  return date
}

function timeInputValue(date: Date) {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date
    .getDate()
    .toString()
    .padStart(2, '0')}`
}

// Default the one-time picker to an hour from now so it's always valid
// (schedule-once requires a future date/time) without the user having to
// change anything for the common "later today" case.
function defaultOnceDate() {
  const date = new Date()
  date.setHours(date.getHours() + 1, 0, 0, 0)
  return date
}

function combineDateAndTime(dateValue: string, timeValue: string): Date {
  const [year, month, day] = dateValue.split('-').map(Number)
  const [hh, mm] = timeValue.split(':').map(Number)
  return new Date(year, month - 1, day, hh, mm, 0, 0)
}

// Resolves the frequency-specific schedule (weekday for weekly, day-of-month
// for monthly) plus a time of day into the concrete first run's local
// datetime, rolling forward to the next valid occurrence if it's already passed.
function computeRecurringStartAt(
  frequency: RecurringFrequency,
  time: string,
  weekday: number,
  monthDay: number
): Date {
  const [hh, mm] = time.split(':').map(Number)
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0)

  if (frequency === 'daily') {
    if (target <= now) target.setDate(target.getDate() + 1)
    return target
  }

  if (frequency === 'weekly') {
    let diff = (weekday - target.getDay() + 7) % 7
    if (diff === 0 && target <= now) diff = 7
    target.setDate(target.getDate() + diff)
    return target
  }

  // monthly
  const day = Math.min(monthDay, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate())
  target.setDate(day)
  if (target <= now) {
    target.setMonth(target.getMonth() + 1)
    target.setDate(Math.min(monthDay, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()))
  }
  return target
}

const RECIPIENT_SEARCH_HINTS = [
  'Search by username...',
  'Try @varuntuteja',
  'Search by full name...',
  'Search by email...',
  'Who are you paying?',
]

export function TransferForm({
  accounts,
  transactions = [],
  currentUsername,
  onTransferred,
  settlementPrefill = null,
  onSettlementPaid,
  onCancelSettlement,
  qrPrefill = null,
  onQrPaymentDone,
  onCancelQrPayment,
  onAccountLocked,
  budgetingEnabled = false,
  budgetCategories,
}: Props) {
  const categoryOptions = (budgetCategories && budgetCategories.length > 0 ? budgetCategories : (BUDGET_CATEGORIES as readonly string[])).filter(
    (c) => c !== 'other'
  )
  const [mode, setMode] = useState<'person' | 'own' | 'recurring'>('person')
  const [toQuery, setToQuery] = useState('')
  const [toUsername, setToUsername] = useState('')
  const [selectedRecipient, setSelectedRecipient] = useState<UserSearchResult | null>(null)
  const [suggestions, setSuggestions] = useState<UserSearchResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [amount, setAmount] = useState('')
  const [ownFromAccountId, setOwnFromAccountId] = useState('')
  const [ownToAccountId, setOwnToAccountId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [paymentPopup, setPaymentPopup] = useState<PaymentPopup | null>(null)
  const [pending, setPending] = useState<PendingTransfer | null>(null)
  const [payConfirmed, setPayConfirmed] = useState(false)
  const [scanningQr, setScanningQr] = useState(false)
  const [decodingQrImage, setDecodingQrImage] = useState(false)
  const [qrImageError, setQrImageError] = useState<string | null>(null)
  const [qrDragOver, setQrDragOver] = useState(false)
  const [searchHintIndex, setSearchHintIndex] = useState(0)

  const [recurToQuery, setRecurToQuery] = useState('')
  const [recurToUsername, setRecurToUsername] = useState('')
  const [recurSelectedRecipient, setRecurSelectedRecipient] = useState<UserSearchResult | null>(null)
  const [recurSuggestions, setRecurSuggestions] = useState<UserSearchResult[]>([])
  const [recurAmount, setRecurAmount] = useState('')
  const [recurCategory, setRecurCategory] = useState<string>('other')
  const [recurScheduleType, setRecurScheduleType] = useState<'once' | 'regular'>('regular')
  const [recurFrequency, setRecurFrequency] = useState<RecurringFrequency>('monthly')
  const [recurTime, setRecurTime] = useState(() => timeInputValue(defaultRecurringDate()))
  const [recurWeekday, setRecurWeekday] = useState(() => defaultRecurringDate().getDay())
  const [recurMonthDay, setRecurMonthDay] = useState(() => defaultRecurringDate().getDate())
  const [recurOnceDate, setRecurOnceDate] = useState(() => dateInputValue(defaultOnceDate()))
  const [recurOnceTime, setRecurOnceTime] = useState(() => timeInputValue(defaultOnceDate()))
  const [recurError, setRecurError] = useState<string | null>(null)
  const [recurPending, setRecurPending] = useState<{
    toUsername: string
    toLabel: string
    amountCents: number
    category: string
    frequency: RecurringFrequency
    startAt: string
  } | null>(null)
  const [recurringPayments, setRecurringPayments] = useState<RecurringPayment[]>([])
  const [recurringLoading, setRecurringLoading] = useState(false)
  const [recurringListError, setRecurringListError] = useState<string | null>(null)
  const [recurringCancellingId, setRecurringCancellingId] = useState<string | null>(null)

  const searchBoxRef = useRef<HTMLDivElement>(null)
  const qrFileInputRef = useRef<HTMLInputElement>(null)
  const quickAmounts = ['500', '1,000', '2,500', '5,000']
  const defaultAccount = accounts[0] ?? null

  const frequentContacts = useMemo(() => {
    if (!currentUsername) return []
    const counts = new Map<string, { username: string; name: string; count: number }>()
    for (const tx of transactions) {
      if (tx.fromUsername !== currentUsername || tx.fromUsername === tx.toUsername) continue
      const existing = counts.get(tx.toUsername)
      if (existing) {
        existing.count += 1
      } else {
        counts.set(tx.toUsername, { username: tx.toUsername, name: tx.toName, count: 1 })
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  }, [transactions, currentUsername])

  useEffect(() => {
    if (settlementPrefill) {
      setMode('person')
      setToUsername(settlementPrefill.toUsername)
      setToQuery(`${settlementPrefill.toName} (@${settlementPrefill.toUsername})`)
      setSelectedRecipient({
        id: settlementPrefill.toUsername,
        username: settlementPrefill.toUsername,
        name: settlementPrefill.toName,
        email: '',
        isSelf: false,
      })
      setAmount(String(settlementPrefill.amountPaise / 100))
      setError(null)
    } else if (qrPrefill) {
      setMode('person')
      setToUsername(qrPrefill.toUsername)
      setToQuery(`${qrPrefill.toName} (@${qrPrefill.toUsername})`)
      setSelectedRecipient({
        id: qrPrefill.toUsername,
        username: qrPrefill.toUsername,
        name: qrPrefill.toName,
        email: '',
        isSelf: false,
      })
      setAmount(String(qrPrefill.amountPaise / 100))
      setError(null)
    } else {
      setToUsername('')
      setToQuery('')
      setSelectedRecipient(null)
      setAmount('')
    }
  }, [settlementPrefill, qrPrefill])

  useEffect(() => {
    if (accounts.length === 0) return
    setOwnFromAccountId((current) => (accounts.some((a) => a.id === current) ? current : accounts[0].id))
  }, [accounts])

  useEffect(() => {
    if (accounts.length === 0) return
    setOwnToAccountId((current) => {
      if (accounts.some((a) => a.id === current) && current !== ownFromAccountId) return current
      return accounts.find((a) => a.id !== ownFromAccountId)?.id ?? ''
    })
  }, [accounts, ownFromAccountId])

  useEffect(() => {
    if (toUsername || toQuery.trim().length === 0) {
      queueMicrotask(() => setSuggestions([]))
      return
    }
    const handle = setTimeout(() => {
      searchUsers(toQuery.trim())
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
    }, 250)
    return () => clearTimeout(handle)
  }, [toQuery, toUsername])

  useEffect(() => {
    if (toQuery.trim().length > 0) return
    const handle = setInterval(() => {
      setSearchHintIndex((i) => (i + 1) % RECIPIENT_SEARCH_HINTS.length)
    }, 4200)
    return () => clearInterval(handle)
  }, [toQuery])

  useEffect(() => {
    if (recurToUsername || recurToQuery.trim().length === 0) {
      setRecurSuggestions([])
      return
    }
    const handle = setTimeout(() => {
      searchUsers(recurToQuery.trim())
        .then(setRecurSuggestions)
        .catch(() => setRecurSuggestions([]))
    }, 250)
    return () => clearTimeout(handle)
  }, [recurToQuery, recurToUsername])

  const loadRecurringPayments = () => {
    setRecurringLoading(true)
    setRecurringListError(null)
    fetchRecurringPayments()
      .then(setRecurringPayments)
      .catch((err) => setRecurringListError(err instanceof Error ? err.message : 'Could not load recurring payments'))
      .finally(() => setRecurringLoading(false))
  }

  useEffect(() => {
    if (mode !== 'recurring') return
    loadRecurringPayments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const startPersonPayFlow = (username: string, label: string, isQrPayment = false) => {
    const fromAccount = defaultAccount
    if (!fromAccount) {
      setError('No source account is available right now.')
      return
    }
    setPending({
      kind: 'person',
      fromAccountId: fromAccount.id,
      fromAccountName: fromAccount.accountName,
      toUsername: username,
      toLabel: label,
      category: 'other',
      amountCents: 0,
      idempotencyKey: crypto.randomUUID(),
      settlementContext: null,
      isQrPayment,
    })
  }

  const selectRecipient = (user: UserSearchResult, isQrPayment = false) => {
    setToUsername(user.username)
    setToQuery(`${user.name} (@${user.username})`)
    setSelectedRecipient(user)
    setShowSuggestions(false)
    // Picking a recipient (search, frequent contact, or QR scan) jumps
    // straight to the pay popup — no separate "Pay" click needed. The amount
    // is entered inside that popup alongside the note and budget category.
    if (mode === 'person' && !settlementPrefill && !qrPrefill) {
      startPersonPayFlow(user.username, `${user.name} (@${user.username})`, isQrPayment)
    }
  }

  const handleQrScanned = ({ username, name }: { username: string; name: string }) => {
    setScanningQr(false)
    selectRecipient({ id: username, username, name, email: '', isSelf: false }, true)
  }

  const selectFrequentContact = (contact: { username: string; name: string }) => {
    selectRecipient({ id: contact.username, username: contact.username, name: contact.name, email: '', isSelf: false })
  }

  const handleQrImageFile = async (file: File) => {
    setQrImageError(null)
    setDecodingQrImage(true)
    try {
      const result = await decodeQrFromImageFile(file)
      if (!result) {
        setQrImageError("Couldn't find a FinFlow QR code in that image.")
        return
      }
      handleQrScanned(result)
    } catch (err) {
      setQrImageError(err instanceof Error ? err.message : 'Could not read that image.')
    } finally {
      setDecodingQrImage(false)
    }
  }

  const handleQrDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setQrDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleQrImageFile(file)
  }

  const applyQuickAmount = (value: string) => {
    setAmount(value.replace(/,/g, ''))
    setError(null)
  }

  const selectRecurRecipient = (user: UserSearchResult) => {
    setRecurToUsername(user.username)
    setRecurToQuery(`${user.name} (@${user.username})`)
    setRecurSelectedRecipient(user)
    setRecurSuggestions([])
  }

  const resetRecurringForm = () => {
    const defaultDate = defaultRecurringDate()
    const defaultOnce = defaultOnceDate()
    setRecurToQuery('')
    setRecurToUsername('')
    setRecurSelectedRecipient(null)
    setRecurAmount('')
    setRecurCategory('other')
    setRecurScheduleType('regular')
    setRecurFrequency('monthly')
    setRecurTime(timeInputValue(defaultDate))
    setRecurWeekday(defaultDate.getDay())
    setRecurMonthDay(defaultDate.getDate())
    setRecurOnceDate(dateInputValue(defaultOnce))
    setRecurOnceTime(timeInputValue(defaultOnce))
    setRecurError(null)
  }

  const confirmRecurringWithPin = async (pin: string) => {
    if (!recurPending) return
    const fromAccount = defaultAccount
    if (!fromAccount) {
      setRecurError('No source account is available right now.')
      return
    }
    await createRecurringPayment({
      fromAccountId: fromAccount.id,
      toUsername: recurPending.toUsername,
      amount: recurPending.amountCents,
      category: recurPending.category,
      frequency: recurPending.frequency,
      startAt: recurPending.startAt,
      pin,
    })
    setRecurPending(null)
    resetRecurringForm()
    loadRecurringPayments()
  }

  const handleCancelRecurring = async (id: string) => {
    setRecurringCancellingId(id)
    try {
      await cancelRecurringPayment(id)
      setRecurringPayments((current) => current.filter((p) => p.id !== id))
    } catch (err) {
      setRecurringListError(err instanceof Error ? err.message : 'Could not cancel this recurring payment')
    } finally {
      setRecurringCancellingId(null)
    }
  }

  const switchMode = (nextMode: 'person' | 'own' | 'recurring') => {
    if (paymentPopup || pending || recurPending) return
    if (nextMode === 'recurring' && mode !== 'recurring') {
      const defaultDate = defaultRecurringDate()
      const defaultOnce = defaultOnceDate()
      setRecurTime(timeInputValue(defaultDate))
      setRecurWeekday(defaultDate.getDay())
      setRecurMonthDay(defaultDate.getDate())
      setRecurOnceDate(dateInputValue(defaultOnce))
      setRecurOnceTime(timeInputValue(defaultOnce))
    }
    setMode(nextMode)
    setError(null)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (paymentPopup || pending || recurPending) return
    setError(null)

    if (mode === 'recurring') {
      setRecurError(null)
      const fromAccount = defaultAccount
      if (!fromAccount) {
        setRecurError('No source account is available right now.')
        return
      }
      if (!recurToUsername) {
        setRecurError('Search for a recipient and select them from the list.')
        return
      }
      if (!hasValidCurrencyPrecision(recurAmount)) {
        setRecurError('Enter an amount with at most 2 decimal places.')
        return
      }
      const cents = rupeesToPaise(recurAmount)
      if (!Number.isInteger(cents) || cents <= 0) {
        setRecurError('Enter a valid amount greater than ₹0.00.')
        return
      }
      if (cents > MAX_TRANSFER_AMOUNT_PAISE) {
        setRecurError(`A single payment can be at most ${formatMoney(MAX_TRANSFER_AMOUNT_PAISE)}.`)
        return
      }
      let startAt: Date
      let frequency: RecurringFrequency
      if (recurScheduleType === 'once') {
        startAt = combineDateAndTime(recurOnceDate, recurOnceTime)
        if (startAt.getTime() <= Date.now()) {
          setRecurError('Pick a date and time in the future for a one-time schedule.')
          return
        }
        frequency = 'once'
      } else {
        startAt = computeRecurringStartAt(recurFrequency, recurTime, recurWeekday, recurMonthDay)
        frequency = recurFrequency
      }
      setRecurPending({
        toUsername: recurToUsername,
        toLabel: recurSelectedRecipient?.name ?? recurToQuery,
        amountCents: cents,
        category: recurCategory,
        frequency,
        startAt: startAt.toISOString(),
      })
      return
    }

    if (mode === 'own') {
      if (!hasValidCurrencyPrecision(amount)) {
        setError('Enter an amount with at most 2 decimal places.')
        return
      }
      const cents = rupeesToPaise(amount)
      if (!Number.isInteger(cents) || cents <= 0) {
        setError('Enter a valid amount greater than ₹0.00.')
        return
      }
      if (cents > MAX_TRANSFER_AMOUNT_PAISE) {
        setError(`A single transfer can be at most ${formatMoney(MAX_TRANSFER_AMOUNT_PAISE)}.`)
        return
      }

      const fromAccount = accounts.find((a) => a.id === ownFromAccountId)
      const toAccount = accounts.find((a) => a.id === ownToAccountId)
      if (!fromAccount || !toAccount) {
        setError('Choose both a source and destination account.')
        return
      }
      if (fromAccount.id === toAccount.id) {
        setError('Choose two different accounts to transfer between.')
        return
      }

      setPending({
        kind: 'own',
        fromAccountId: fromAccount.id,
        fromAccountName: fromAccount.accountName,
        toAccountId: toAccount.id,
        toAccountName: toAccount.accountName,
        amountCents: cents,
        idempotencyKey: crypto.randomUUID(),
      })
      return
    }

    const fromAccount = defaultAccount
    if (!fromAccount) {
      setError('No source account is available right now.')
      return
    }
    if (!toUsername) {
      setError('Search for a recipient and select them from the list.')
      return
    }
    if (!settlementPrefill && !qrPrefill) {
      // Plain person-to-person payments collect the amount inside the pay
      // popup itself, alongside the note and budget category — the amount
      // starts unresolved (0) and PayConfirmPopup fills it in before moving
      // to the confirm step.
      startPersonPayFlow(toUsername, toQuery)
      return
    }

    if (!hasValidCurrencyPrecision(amount)) {
      setError('Enter an amount with at most 2 decimal places.')
      return
    }
    const cents = rupeesToPaise(amount)
    if (!Number.isInteger(cents) || cents <= 0) {
      setError('Enter a valid amount greater than ₹0.00.')
      return
    }
    if (cents > MAX_TRANSFER_AMOUNT_PAISE) {
      setError(`A single transfer can be at most ${formatMoney(MAX_TRANSFER_AMOUNT_PAISE)}.`)
      return
    }

    setPending({
      kind: 'person',
      fromAccountId: fromAccount.id,
      fromAccountName: fromAccount.accountName,
      toUsername,
      toLabel: toQuery,
      category: settlementPrefill ? 'settlement' : 'other',
      amountCents: cents,
      idempotencyKey: crypto.randomUUID(),
      settlementContext: settlementPrefill
        ? { groupId: settlementPrefill.groupId, settlementId: settlementPrefill.settlementId }
        : null,
      isQrPayment: Boolean(qrPrefill),
    })
  }

  const pendingRecipientName = pending
    ? pending.kind === 'own'
      ? pending.toAccountName
      : selectedRecipient?.isSelf
        ? 'You'
        : selectedRecipient?.name ?? pending.toUsername
    : ''
  const pendingRecipientSubtitle = pending
    ? pending.kind === 'own'
      ? 'Your account'
      : selectedRecipient && !selectedRecipient.isSelf
        ? `@${selectedRecipient.username}`
        : undefined
    : undefined

  const confirmWithPin = async (pin: string) => {
    if (!pending) return
    const transferRequest = pending
    const recipientName = pendingRecipientName

    setPaymentPopup({
      stage: 'processing',
      amountCents: transferRequest.amountCents,
      recipientName,
      note: transferRequest.note,
      category: transferRequest.kind === 'person' ? transferRequest.category : undefined,
    })

    try {
      const { transaction } =
        transferRequest.kind === 'own'
          ? await selfTransfer({
              fromAccountId: transferRequest.fromAccountId,
              toAccountId: transferRequest.toAccountId,
              amount: transferRequest.amountCents,
              idempotencyKey: transferRequest.idempotencyKey,
              pin,
              note: transferRequest.note,
            })
          : await transfer({
              fromAccountId: transferRequest.fromAccountId,
              toUsername: transferRequest.toUsername,
              amount: transferRequest.amountCents,
              idempotencyKey: transferRequest.idempotencyKey,
              pin,
              category: transferRequest.category,
              note: transferRequest.note,
              isQrPayment: transferRequest.isQrPayment,
            })
      setPending(null)
      setPayConfirmed(false)

      await wait(3000)
      playSuccessTing()
      setPaymentPopup({
        stage: 'done',
        amountCents: transferRequest.amountCents,
        recipientName,
        note: transferRequest.note,
        category: transferRequest.kind === 'person' ? transferRequest.category : undefined,
        transactionId: transaction.id.slice(0, 8),
      })

      setAmount('')
      setToQuery('')
      setToUsername('')
      setSelectedRecipient(null)
      if (transferRequest.kind === 'person' && transferRequest.settlementContext) {
        onSettlementPaid?.(transferRequest.settlementContext, transaction.id, transferRequest.amountCents)
      } else if (transferRequest.kind === 'person' && qrPrefill) {
        onQrPaymentDone?.()
      }
      onTransferred()

      await wait(3500)
      setPaymentPopup(null)
    } catch (err) {
      setPaymentPopup(null)
      // Keep `pending`/`payConfirmed` as-is on failure so the PinModal stays
      // open and shows the error (wrong PIN, or a 24h lockout) instead of
      // bouncing back to the amount-confirm popup.
      // A failed attempt (e.g. insufficient funds) still persists as an audit
      // row server-side, so refresh local state to pick it up even on failure.
      onTransferred()
      throw err
    }
  }

  const cancelPending = () => {
    setPending(null)
    setPayConfirmed(false)
  }

  return (
    <section className="panel transfer-panel">
      {paymentPopup && (
        <div className="modal-backdrop payment-status-backdrop">
          <div
            className={`modal-card payment-status-popup payment-status-popup-${paymentPopup.stage}`}
            role="status"
            aria-live="polite"
          >
            <div className="payment-status-icon" aria-hidden="true">
              {paymentPopup.stage === 'processing' ? (
                <span className="payment-spinner" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 12.5l4.2 4.2L19 7"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <div className="payment-status-copy">
              <strong>{paymentPopup.stage === 'processing' ? 'Processing payment' : 'Payment successful'}</strong>
              <span>
                {formatMoney(paymentPopup.amountCents)} {paymentPopup.stage === 'processing' ? 'is being sent to' : 'sent to'}{' '}
                {paymentPopup.recipientName}
              </span>
              {paymentPopup.stage === 'done' && paymentPopup.category && (
                <span className="payment-status-meta">Category: {paymentPopup.category}</span>
              )}
              {paymentPopup.stage === 'done' && paymentPopup.note && (
                <span className="payment-status-meta">Note: {paymentPopup.note}</span>
              )}
              {paymentPopup.transactionId && (
                <span className="payment-status-meta">Txn #{paymentPopup.transactionId}</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div
        className={`transfer-card-grid${
          !settlementPrefill && !qrPrefill && (mode === 'person' || mode === 'recurring') ? '' : ' transfer-card-grid-single'
        }`}
      >
        <div className="transfer-card-main">
          <div className="transfer-panel-head">
            <div>
              <h2>{settlementPrefill ? 'Settle Up' : qrPrefill ? 'Pay via QR' : 'Send Money'}</h2>
              <p className="muted">
                {settlementPrefill
                  ? `Paying your share for ${settlementPrefill.groupName}.`
                  : qrPrefill
                    ? `Paying ${qrPrefill.toName} from a scanned QR code.`
                    : 'Route a verified payout with live confirmation and one-step UPI authorization.'}
              </p>
            </div>
          </div>

          {settlementPrefill && (
            <div className="settlement-summary-card">
              <strong>{settlementPrefill.groupName}</strong>
              <div className="settlement-summary-row">
                <span>Paying</span>
                <span>{settlementPrefill.toName}</span>
              </div>
              <div className="settlement-summary-row">
                <span>Amount</span>
                <span>{formatMoney(settlementPrefill.amountPaise)}</span>
              </div>
              <button type="button" className="link-btn" onClick={onCancelSettlement}>
                Cancel and send a regular payment instead
              </button>
            </div>
          )}

          {qrPrefill && (
            <div className="settlement-summary-card">
              <strong>Scanned QR code</strong>
              <div className="settlement-summary-row">
                <span>Paying</span>
                <span>{qrPrefill.toName}</span>
              </div>
              <div className="settlement-summary-row">
                <span>Amount</span>
                <span>{formatMoney(qrPrefill.amountPaise)}</span>
              </div>
              <button type="button" className="link-btn" onClick={onCancelQrPayment}>
                Cancel and send a regular payment instead
              </button>
            </div>
          )}

          {!settlementPrefill && !qrPrefill && (
            <div className="transfer-mode-tabs" role="tablist" aria-label="Transfer type">
              <button
                type="button"
                className={`transfer-mode-tab${mode === 'person' ? ' transfer-mode-tab-active' : ''}`}
                onClick={() => switchMode('person')}
                aria-pressed={mode === 'person'}
              >
                <PayIcon />
                Send to someone
              </button>
              <button
                type="button"
                className={`transfer-mode-tab${mode === 'own' ? ' transfer-mode-tab-active' : ''}`}
                onClick={() => switchMode('own')}
                aria-pressed={mode === 'own'}
                disabled={accounts.length < 2}
                title={accounts.length < 2 ? 'You need at least two accounts to move money between them' : undefined}
              >
                <SavingsTransferIcon />
                Between my accounts
              </button>
              <button
                type="button"
                className={`transfer-mode-tab${mode === 'recurring' ? ' transfer-mode-tab-active' : ''}`}
                onClick={() => switchMode('recurring')}
                aria-pressed={mode === 'recurring'}
              >
                <RecurringIcon />
                Recurring
              </button>
            </div>
          )}

          <form className="transfer-form" onSubmit={handleSubmit}>
            {settlementPrefill || qrPrefill ? null : mode === 'person' ? (
              <>
                <div className="search-field" ref={searchBoxRef}>
                  <label className="gateway-label">
                    <span className="transfer-section-head">
                      <span className="transfer-section-kicker">Recipient</span>
                      <span className="transfer-section-meta">Search by username, name, or email</span>
                    </span>
                    <div className="input-with-icon">
                      <svg className="input-icon" viewBox="0 0 24 24" fill="none">
                        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                      <input
                        type="text"
                        value={toQuery}
                        autoComplete="off"
                        onChange={(e) => {
                          setToQuery(e.target.value)
                          setToUsername('')
                          setSelectedRecipient(null)
                          setShowSuggestions(true)
                        }}
                        onFocus={() => setShowSuggestions(true)}
                      />
                      {toQuery.trim().length === 0 && (
                        <span key={searchHintIndex} className="search-hint-cycle" aria-hidden="true">
                          {RECIPIENT_SEARCH_HINTS[searchHintIndex]}
                        </span>
                      )}
                    </div>
                  </label>
                  {!selectedRecipient && toQuery.trim().length > 0 && suggestions.length === 0 && (
                    <p className="transfer-search-hint">No matches yet. Try a username, full name, or email.</p>
                  )}
                  {showSuggestions && suggestions.length > 0 && (
                    <ul className="suggestions-list">
                      {suggestions.map((user) => (
                        <li key={user.id}>
                          <button type="button" onClick={() => selectRecipient(user)}>
                            <span className="suggestion-main">
                              <span className="suggestion-name-row">
                                <span className="suggestion-name">{user.isSelf ? 'You' : user.name}</span>
                                <span className="suggestion-username">@{user.username}</span>
                              </span>
                              <span className="suggestion-email">{user.email}</span>
                            </span>
                            <span className="suggestion-meta">{user.isSelf ? 'Your account' : 'FinFlow user'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {!selectedRecipient && toQuery.trim().length === 0 && frequentContacts.length > 0 && (
                  <div className="frequent-contacts">
                    <span className="transfer-section-kicker">Frequently paid</span>
                    <div className="frequent-contacts-list">
                      {frequentContacts.map((contact) => (
                        <button
                          key={contact.username}
                          type="button"
                          className="frequent-contact-chip"
                          onClick={() => selectFrequentContact(contact)}
                        >
                          <span className="frequent-contact-avatar">{contact.name.slice(0, 1).toUpperCase()}</span>
                          <span className="frequent-contact-name">{contact.name}</span>
                          <span className="frequent-contact-username">@{contact.username}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedRecipient && (
                  <button
                    type="button"
                    className="recipient-card recipient-card-clickable"
                    aria-live="polite"
                    onClick={() => startPersonPayFlow(toUsername, toQuery)}
                  >
                    <span className="recipient-card-avatar">{selectedRecipient.name.slice(0, 1).toUpperCase()}</span>
                    <span className="recipient-card-copy">
                      <strong>{selectedRecipient.isSelf ? 'You' : selectedRecipient.name}</strong>
                      <span>@{selectedRecipient.username}</span>
                      <span>{selectedRecipient.email}</span>
                    </span>
                    <span className="recipient-card-status">
                      <span className="recipient-card-chip">Tap to pay</span>
                    </span>
                  </button>
                )}
              </>
            ) : mode === 'recurring' ? (
              <>
                <div className="search-field">
                  <label className="gateway-label">
                    <span className="transfer-section-head">
                      <span className="transfer-section-kicker">Recipient</span>
                      <span className="transfer-section-meta">Who gets paid on this schedule</span>
                    </span>
                    <div className="input-with-icon">
                      <svg className="input-icon" viewBox="0 0 24 24" fill="none">
                        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Search by username, name, or email..."
                        value={recurToQuery}
                        autoComplete="off"
                        onChange={(e) => {
                          setRecurToQuery(e.target.value)
                          setRecurToUsername('')
                          setRecurSelectedRecipient(null)
                        }}
                      />
                    </div>
                  </label>
                  {recurSuggestions.length > 0 && (
                    <ul className="suggestions-list">
                      {recurSuggestions.map((user) => (
                        <li key={user.id}>
                          <button type="button" onClick={() => selectRecurRecipient(user)}>
                            <span className="suggestion-main">
                              <span className="suggestion-name-row">
                                <span className="suggestion-name">{user.isSelf ? 'You' : user.name}</span>
                                <span className="suggestion-username">@{user.username}</span>
                              </span>
                              <span className="suggestion-email">{user.email}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="transfer-section">
                  <label className="gateway-label">
                    <span className="transfer-section-head">
                      <span className="transfer-section-kicker">Amount</span>
                      <span className="transfer-section-meta">Charged on the schedule set below</span>
                    </span>
                    <div className="input-with-icon">
                      <span className="input-icon input-icon-text">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={recurAmount}
                        onChange={(e) => setRecurAmount(e.target.value)}
                      />
                    </div>
                  </label>

                  <div className="transfer-mode-tabs recurring-schedule-type-tabs">
                    <button
                      type="button"
                      className={`transfer-mode-tab${recurScheduleType === 'regular' ? ' transfer-mode-tab-active' : ''}`}
                      onClick={() => setRecurScheduleType('regular')}
                      aria-pressed={recurScheduleType === 'regular'}
                    >
                      Regular schedule
                    </button>
                    <button
                      type="button"
                      className={`transfer-mode-tab${recurScheduleType === 'once' ? ' transfer-mode-tab-active' : ''}`}
                      onClick={() => setRecurScheduleType('once')}
                      aria-pressed={recurScheduleType === 'once'}
                    >
                      Schedule once
                    </button>
                  </div>

                  {recurScheduleType === 'once' ? (
                    <>
                      <div className="fields-row">
                        <label className="gateway-label">
                          <span className="transfer-section-head">
                            <span className="transfer-section-kicker">Category</span>
                          </span>
                          <select
                            className="gateway-select"
                            value={recurCategory}
                            onChange={(e) => setRecurCategory(e.target.value)}
                          >
                            <option value="other">Settle later</option>
                            {categoryOptions.map((item) => (
                              <option key={item} value={item}>
                                {item.charAt(0).toUpperCase() + item.slice(1)}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="gateway-label">
                          <span className="transfer-section-head">
                            <span className="transfer-section-kicker">Date</span>
                          </span>
                          <input
                            type="date"
                            className="gateway-select"
                            value={recurOnceDate}
                            min={dateInputValue(new Date())}
                            onChange={(e) => setRecurOnceDate(e.target.value)}
                          />
                        </label>

                        <label className="gateway-label">
                          <span className="transfer-section-head">
                            <span className="transfer-section-kicker">Time</span>
                          </span>
                          <input
                            type="time"
                            className="gateway-select"
                            value={recurOnceTime}
                            onChange={(e) => setRecurOnceTime(e.target.value)}
                          />
                        </label>
                      </div>

                      <p className="transfer-section-meta recurring-schedule-summary">
                        Debits once on {new Date(`${recurOnceDate}T00:00:00`).toLocaleDateString()} at{' '}
                        {formatTimeLabel(recurOnceTime)}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="fields-row">
                        <label className="gateway-label">
                          <span className="transfer-section-head">
                            <span className="transfer-section-kicker">Category</span>
                          </span>
                          <select
                            className="gateway-select"
                            value={recurCategory}
                            onChange={(e) => setRecurCategory(e.target.value)}
                          >
                            <option value="other">Settle later</option>
                            {categoryOptions.map((item) => (
                              <option key={item} value={item}>
                                {item.charAt(0).toUpperCase() + item.slice(1)}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="gateway-label">
                          <span className="transfer-section-head">
                            <span className="transfer-section-kicker">Frequency</span>
                          </span>
                          <select
                            className="gateway-select"
                            value={recurFrequency}
                            onChange={(e) => setRecurFrequency(e.target.value as RecurringFrequency)}
                          >
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                          </select>
                        </label>

                        <label className="gateway-label">
                          <span className="transfer-section-head">
                            <span className="transfer-section-kicker">Time</span>
                          </span>
                          <input
                            type="time"
                            className="gateway-select"
                            value={recurTime}
                            onChange={(e) => setRecurTime(e.target.value)}
                          />
                        </label>

                        {recurFrequency === 'monthly' && (
                          <label className="gateway-label">
                            <span className="transfer-section-head">
                              <span className="transfer-section-kicker">Day of month</span>
                            </span>
                            <select
                              className="gateway-select"
                              value={recurMonthDay}
                              onChange={(e) => setRecurMonthDay(Number(e.target.value))}
                            >
                              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                                <option key={d} value={d}>
                                  {ordinal(d)}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>

                      {recurFrequency === 'weekly' && (
                        <div className="recurring-weekday-picker">
                          <span className="transfer-section-kicker">Day of week</span>
                          <div className="recurring-weekday-options">
                            {WEEKDAYS.map((d) => (
                              <button
                                key={d.value}
                                type="button"
                                className={`recurring-weekday-chip${recurWeekday === d.value ? ' recurring-weekday-chip-active' : ''}`}
                                onClick={() => setRecurWeekday(d.value)}
                              >
                                {d.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <p className="transfer-section-meta recurring-schedule-summary">
                        {recurFrequency === 'daily' && `Debits every day at ${formatTimeLabel(recurTime)}`}
                        {recurFrequency === 'weekly' &&
                          `Debits every ${WEEKDAYS.find((d) => d.value === recurWeekday)?.full} at ${formatTimeLabel(recurTime)}`}
                        {recurFrequency === 'monthly' &&
                          `Debits every ${ordinal(recurMonthDay)} of the month at ${formatTimeLabel(recurTime)}`}
                      </p>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="transfer-section">
                <div className="fields-row">
                  <label className="gateway-label">
                    <span className="transfer-section-head">
                      <span className="transfer-section-kicker">From account</span>
                      <span className="transfer-section-meta">Where the money leaves</span>
                    </span>
                    <select
                      className="gateway-select"
                      value={ownFromAccountId}
                      onChange={(e) => setOwnFromAccountId(e.target.value)}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.accountName} ({formatMoney(a.balance)})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="gateway-label">
                    <span className="transfer-section-head">
                      <span className="transfer-section-kicker">To account</span>
                      <span className="transfer-section-meta">Where the money lands</span>
                    </span>
                    <select
                      className="gateway-select"
                      value={ownToAccountId}
                      onChange={(e) => setOwnToAccountId(e.target.value)}
                    >
                      {accounts
                        .filter((a) => a.id !== ownFromAccountId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.accountName} ({formatMoney(a.balance)})
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </div>
            )}

            {!settlementPrefill && !qrPrefill && mode === 'own' && (
              <div className="transfer-section">
                <label className="gateway-label">
                  <span className="transfer-section-head">
                    <span className="transfer-section-kicker">Payout amount</span>
                    <span className="transfer-section-meta">Up to {formatMoney(MAX_TRANSFER_AMOUNT_PAISE)} per transfer</span>
                  </span>
                  <div className="input-with-icon">
                    <span className="input-icon input-icon-text">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                </label>

                <div className="amount-presets" aria-label="Quick amounts">
                  {quickAmounts.map((value) => (
                    <button key={value} type="button" className="amount-preset" onClick={() => applyQuickAmount(value)}>
                      ₹{value}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(mode === 'own' || mode === 'recurring' || settlementPrefill || qrPrefill) && (
              <button
                type="submit"
                className="primary-btn primary-btn-block"
                disabled={Boolean(paymentPopup || pending || recurPending)}
              >
                {paymentPopup || pending || recurPending
                  ? 'Processing...'
                  : settlementPrefill
                    ? 'Pay settlement'
                    : qrPrefill
                      ? 'Pay via QR'
                      : mode === 'recurring'
                        ? recurScheduleType === 'once'
                          ? 'Schedule payment'
                          : 'Set up recurring payment'
                        : 'Move money'}
              </button>
            )}

            {error && <p className="form-error">{error}</p>}
            {mode === 'recurring' && recurError && <p className="form-error">{recurError}</p>}
          </form>
        </div>

        {!settlementPrefill && !qrPrefill && mode === 'person' && (
          <div className="transfer-card-side">
            <div className="scan-qr-panel">
              <span className="scan-qr-panel-icon">
                <ScanQrIcon />
              </span>
              <h3>Scan QR to pay</h3>
              <p className="muted">Point your camera at a FinFlow QR code to fill in the recipient instantly.</p>
              <button type="button" className="scan-qr-trigger" onClick={() => setScanningQr(true)}>
                <ScanQrIcon />
                Scan QR code
              </button>

              <span className="qr-drop-divider">or</span>

              <div
                className={`qr-drop-zone${qrDragOver ? ' qr-drop-zone-active' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setQrDragOver(true)
                }}
                onDragLeave={() => setQrDragOver(false)}
                onDrop={handleQrDrop}
                onClick={() => qrFileInputRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                <UploadIcon />
                <span>{decodingQrImage ? 'Reading QR code…' : 'Drop a QR image, or click to browse'}</span>
                <input
                  ref={qrFileInputRef}
                  type="file"
                  accept="image/*"
                  className="qr-file-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleQrImageFile(file)
                    e.target.value = ''
                  }}
                />
              </div>

              {qrImageError && <p className="form-error">{qrImageError}</p>}
            </div>
          </div>
        )}

        {!settlementPrefill && !qrPrefill && mode === 'recurring' && (
          <div className="transfer-card-side">
            <div className="recurring-list-panel">
              <span className="transfer-section-kicker">Active mandates</span>
              {recurringLoading ? (
                <p className="muted">Loading…</p>
              ) : recurringListError ? (
                <p className="form-error">{recurringListError}</p>
              ) : recurringPayments.length === 0 ? (
                <p className="muted">No recurring payments set up yet.</p>
              ) : (
                <ul className="recurring-list">
                  {recurringPayments.map((p) => (
                    <li key={p.id} className={`recurring-row${p.active ? '' : ' recurring-row-inactive'}`}>
                      <span className="recurring-row-main">
                        <strong>{p.toName}</strong>
                        <span className="muted">
                          @{p.toUsername} · {frequencyLabel(p.frequency)}
                        </span>
                        {p.active && (
                          <span className="muted">
                            Debits: {new Date(p.nextRunAt).toLocaleDateString()} at{' '}
                            {new Date(p.nextRunAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        )}
                      </span>
                      <span className="recurring-row-end">
                        <span className="recurring-row-amount">{formatMoney(p.amount)}</span>
                        {p.active ? (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => handleCancelRecurring(p.id)}
                            disabled={recurringCancellingId === p.id}
                          >
                            {recurringCancellingId === p.id ? 'Cancelling…' : 'Cancel'}
                          </button>
                        ) : p.frequency === 'once' && p.lastStatus === 'completed' ? (
                          <span className="status-badge status-completed">completed</span>
                        ) : (
                          <span className="status-badge status-failed">cancelled</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {pending && !payConfirmed && (
        <PayConfirmPopup
          amountCents={pending.amountCents}
          amountEditable={pending.kind === 'person' && pending.amountCents === 0}
          recipientName={pendingRecipientName}
          recipientSubtitle={pendingRecipientSubtitle}
          budgetingEnabled={budgetingEnabled && pending.kind === 'person'}
          categories={budgetCategories}
          onConfirm={({ note, category, amountCents }) => {
            setPending((current) => {
              if (!current) return current
              if (current.kind === 'person') {
                return { ...current, note, amountCents, category: budgetingEnabled ? category : current.category }
              }
              return { ...current, note, amountCents }
            })
            setPayConfirmed(true)
          }}
          onCancel={cancelPending}
        />
      )}

      {pending && payConfirmed && (
        <PinModal
          title="Enter UPI PIN"
          subtitle={
            pending.kind === 'own'
              ? `Move ${formatMoney(pending.amountCents)} from ${pending.fromAccountName} to ${pending.toAccountName}`
              : `Send ${formatMoney(pending.amountCents)} from ${pending.fromAccountName} to ${pending.toLabel}`
          }
          onConfirm={confirmWithPin}
          onCancel={cancelPending}
          onAccountLocked={onAccountLocked}
        />
      )}

      {scanningQr && <ScanQrModal onScanned={handleQrScanned} onCancel={() => setScanningQr(false)} />}

      {recurPending && (
        <PinModal
          title="Enter UPI PIN"
          subtitle={`Authorize ${formatMoney(recurPending.amountCents)} ${frequencyLabel(recurPending.frequency)} to ${recurPending.toLabel}`}
          confirmLabel="Authorize"
          onConfirm={confirmRecurringWithPin}
          onCancel={() => setRecurPending(null)}
          onAccountLocked={onAccountLocked}
        />
      )}
    </section>
  )
}
