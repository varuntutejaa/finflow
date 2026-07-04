import { useRef } from 'react'
import type { KeyboardEvent, ClipboardEvent } from 'react'

interface Props {
  length?: number
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  id?: string
  masked?: boolean
}

export function PinInput({ length = 4, value, onChange, autoFocus, id, masked = true }: Props) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const digits = Array.from({ length }, (_, i) => value[i] ?? '')

  const setDigit = (index: number, digit: string) => {
    const next = digits.slice()
    next[index] = digit
    onChange(next.join(''))
  }

  const handleChange = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1)
    setDigit(index, digit)
    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (pasted) {
      e.preventDefault()
      onChange(pasted.padEnd(length, '').slice(0, length))
      inputRefs.current[Math.min(pasted.length, length - 1)]?.focus()
    }
  }

  return (
    <div className="pin-input" role="group">
      {digits.map((digit, index) => (
        <input
          key={index}
          id={index === 0 ? id : undefined}
          ref={(el) => {
            inputRefs.current[index] = el
          }}
          type={masked ? 'password' : 'text'}
          inputMode="numeric"
          maxLength={1}
          value={digit}
          autoFocus={autoFocus && index === 0}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className="pin-box"
        />
      ))}
    </div>
  )
}
