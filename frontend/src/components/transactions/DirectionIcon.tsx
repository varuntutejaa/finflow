export function DirectionIcon({ outgoing }: { outgoing: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      {outgoing ? (
        <path
          d="M7 17L17 7M17 7H9M17 7V15"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M17 7L7 17M7 17H15M7 17V9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}
