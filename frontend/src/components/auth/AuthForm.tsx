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

function UserIcon() {
  return (
    <svg className="input-icon" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 20c1.3-3.6 4.2-5.4 7-5.4S17.7 16.4 19 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function AtIcon() {
  return (
    <svg className="input-icon" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M16 12v1.5a2.5 2.5 0 005 0V12a9 9 0 10-3.6 7.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg className="input-icon" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function EyeToggleIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      {open ? (
        <>
          <path
            d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
        </>
      ) : (
        <path
          d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 5.2A9.5 9.5 0 0112 5c6.5 0 10 7 10 7a15.8 15.8 0 01-3.4 4.3M6.5 6.5A15.8 15.8 0 002 12s3.5 7 10 7a9.5 9.5 0 003.3-.6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

export function AuthForm({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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

  const switchMode = (nextMode: 'login' | 'signup') => {
    if (nextMode === mode) return
    setMode(nextMode)
    setError(null)
    setUsernameStatus('idle')
    setUsernameMessage('')
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
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
    <div className="auth-card">
      <div className="auth-mode-tabs" role="tablist" aria-label="Login or sign up">
        <button
          type="button"
          className={`auth-mode-tab${mode === 'login' ? ' auth-mode-tab-active' : ''}`}
          onClick={() => switchMode('login')}
          aria-pressed={mode === 'login'}
        >
          Log in
        </button>
        <button
          type="button"
          className={`auth-mode-tab${mode === 'signup' ? ' auth-mode-tab-active' : ''}`}
          onClick={() => switchMode('signup')}
          aria-pressed={mode === 'signup'}
        >
          Sign up
        </button>
      </div>

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
              <div className="input-with-icon">
                <UserIcon />
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            </label>
            <label>
              Username
              <div className={`input-with-icon username-field username-${usernameStatus}`}>
                <UserIcon />
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
            <div className="input-with-icon">
              <AtIcon />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </label>
        ) : (
          <label>
            Email or username
            <div className="input-with-icon">
              <AtIcon />
              <input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            </div>
          </label>
        )}

        <label>
          Password
          <div className="input-with-icon">
            <LockIcon />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
            <button
              type="button"
              className="input-icon-trailing"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <EyeToggleIcon open={showPassword} />
            </button>
          </div>
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
            <div className="input-with-icon">
              <LockIcon />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
          </label>
        )}

        <button type="submit" className="primary-btn primary-btn-block" disabled={submitting || usernameBlocked}>
          {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>

        {error && <p className="form-error">{error}</p>}

        <p className="auth-switch">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button type="button" className="link-btn" onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </form>
    </div>
  )
}
