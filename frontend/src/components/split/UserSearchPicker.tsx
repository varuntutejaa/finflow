import { useEffect, useRef, useState } from 'react'
import type { UserSearchResult } from '../../api'
import { searchUsers } from '../../api'

interface Props {
  placeholder?: string
  excludeUsernames?: string[]
  onSelect: (user: UserSearchResult) => void
}

export function UserSearchPicker({ placeholder = 'Search by username, name, or email...', excludeUsernames = [], onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<UserSearchResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (query.trim().length === 0) {
      setSuggestions([])
      return
    }
    const handle = setTimeout(() => {
      searchUsers(query.trim())
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
    }, 250)
    return () => clearTimeout(handle)
  }, [query])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const excludeSet = new Set(excludeUsernames.map((u) => u.toLowerCase()))
  const visibleSuggestions = suggestions.filter((user) => !excludeSet.has(user.username.toLowerCase()))

  const handleSelect = (user: UserSearchResult) => {
    onSelect(user)
    setQuery('')
    setSuggestions([])
    setShowSuggestions(false)
  }

  return (
    <div className="search-field" ref={boxRef}>
      <div className="input-with-icon">
        <svg className="input-icon" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
          <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value)
            setShowSuggestions(true)
          }}
          onFocus={() => setShowSuggestions(true)}
        />
      </div>
      {query.trim().length > 0 && visibleSuggestions.length === 0 && (
        <p className="transfer-search-hint">No matches yet. Try a username, full name, or email.</p>
      )}
      {showSuggestions && visibleSuggestions.length > 0 && (
        <ul className="suggestions-list">
          {visibleSuggestions.map((user) => (
            <li key={user.id}>
              <button type="button" onClick={() => handleSelect(user)}>
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
  )
}
