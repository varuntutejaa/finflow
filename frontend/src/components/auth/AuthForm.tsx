import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '../../api'
import { checkUsername, login, signup } from '../../api'

interface Props {
  onAuthenticated: (user: User, token: string, needsPinSetup: boolean) => void
}

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong'

function getPasswordStrength(password: string): { score: number; label: PasswordStrength; hint: string } {
  let score = 0

  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1

  if (score <= 2) {
    return { score: Math.max(score, 1), label: 'weak', hint: 'Use 8+ characters with a mix of letters, numbers, and symbols.' }
  }
  if (score === 3) {
    return { score, label: 'fair', hint: 'Add an uppercase letter, number, or symbol to strengthen it.' }
  }
  if (score === 4) {
    return { score, label: 'good', hint: 'Good password. A symbol or longer phrase makes it even better.' }
  }
  return { score, label: 'strong', hint: 'Strong password.' }
}

export function AuthForm({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle')
  const [usernameMessage, setUsernameMessage] = useState('')
  const passwordStrength = getPasswordStrength(password)

  // Debounced live availability check while typing a username during signup.
  useEffect(() => {
    if (mode !== 'signup') return
    const value = username.trim()
    const handle = setTimeout(() => {
      if (value.length === 0) {
        setUsernameStatus('idle')
        setUsernameMessage('')
        return
      }
      setUsernameStatus('checking')
      checkUsername(value)
        .then((result) => {
          setUsernameStatus(result.valid ? (result.available ? 'available' : 'taken') : 'invalid')
          setUsernameMessage(result.message)
        })
        .catch(() => {
          setUsernameStatus('idle')
          setUsernameMessage('')
        })
    }, 350)
    return () => clearTimeout(handle)
  }, [username, mode])

  const switchMode = () => {
    setMode(mode === 'login' ? 'signup' : 'login')
    setError(null)
    setUsernameStatus('idle')
    setUsernameMessage('')
    setPassword('')
    setConfirmPassword('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (mode === 'signup' && (usernameStatus === 'taken' || usernameStatus === 'invalid')) {
      setError('Please choose an available username.')
      return
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'login') {
        const result = await login({ identifier, password })
        onAuthenticated(result.user, result.token, false)
      } else {
        const result = await signup({ username, email, password, name })
        onAuthenticated(result.user, result.token, result.needsPinSetup)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  const usernameBlocked =
    mode === 'signup' && (usernameStatus === 'taken' || usernameStatus === 'invalid' || usernameStatus === 'checking')

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-form-head">
        <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
        <p className="muted">
          {mode === 'login' ? 'Log in to see your balances and history.' : 'Takes less than a minute.'}
        </p>
      </div>

      {mode === 'signup' && (
        <>
          <label>
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Username
            <div className={`username-field username-${usernameStatus}`}>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                pattern="[a-zA-Z0-9_]{3,20}"
                title="3-20 characters: letters, numbers, underscores"
                autoComplete="off"
                required
              />
              {usernameStatus === 'checking' && <span className="username-spinner" aria-hidden="true" />}
              {usernameStatus === 'available' && (
                <svg className="username-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {(usernameStatus === 'taken' || usernameStatus === 'invalid') && (
                <svg className="username-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              )}
            </div>
            {usernameStatus !== 'idle' && usernameMessage && (
              <span className={`username-hint username-hint-${usernameStatus}`}>{usernameMessage}</span>
            )}
          </label>
        </>
      )}

      {mode === 'signup' ? (
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
      ) : (
        <label>
          Email or username
          <input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        </label>
      )}

      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        {mode === 'signup' && password.length > 0 && (
          <span className="password-strength" aria-live="polite">
            <span className="password-strength-track">
              <span
                className={`password-strength-fill password-strength-${passwordStrength.label}`}
                style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
              />
            </span>
            <span className={`password-strength-copy password-strength-copy-${passwordStrength.label}`}>
              <strong>{passwordStrength.label}</strong> {passwordStrength.hint}
            </span>
          </span>
        )}
      </label>

      {mode === 'signup' && (
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
      )}

      <button type="submit" className="primary-btn primary-btn-block" disabled={submitting || usernameBlocked}>
        {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
      </button>

      {error && <p className="form-error">{error}</p>}

      <p className="auth-switch">
        {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
        <button type="button" className="link-btn" onClick={switchMode}>
          {mode === 'login' ? 'Sign up' : 'Log in'}
        </button>
      </p>
    </form>
  )
}
