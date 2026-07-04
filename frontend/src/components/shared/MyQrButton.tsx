import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface Props {
  username: string
  name: string
}

function QrIcon() {
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

function buildPayLink(username: string, name: string) {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('to', username)
  url.searchParams.set('name', name)
  return url.toString()
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function MyQrButton({ username, name }: Props) {
  const [open, setOpen] = useState(false)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setDataUrl(null)
    setError(null)
    QRCode.toDataURL(buildPayLink(username, name), { margin: 1, width: 220 })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not generate QR code')
      })
    return () => {
      cancelled = true
    }
  }, [open, username, name])

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen(true)}
        title="Show your pay QR code"
        aria-label="Show your pay QR code"
      >
        <QrIcon />
      </button>

      {open && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal-card account-qr-modal" role="dialog" aria-modal="true">
            <span className="transfer-section-kicker">Scan to pay</span>
            <h2>{name}</h2>
            <p className="muted">@{username}</p>

            <div className="account-qr-image-wrap">
              {dataUrl ? (
                <img src={dataUrl} alt={`QR code to pay ${name}`} className="account-qr-image" />
              ) : error ? (
                <p className="form-error">{error}</p>
              ) : (
                <p className="muted">Generating QR code…</p>
              )}
            </div>

            <p className="muted account-qr-hint">Scan with a phone camera to open the pay screen for this amount.</p>

            {dataUrl && (
              <button
                type="button"
                className="secondary-btn account-qr-download-btn"
                onClick={() => downloadDataUrl(dataUrl, `finflow-${username}-qr.png`)}
              >
                Download QR
              </button>
            )}

            <button type="button" className="link-btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}
