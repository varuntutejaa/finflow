import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

interface Props {
  onScanned: (result: { username: string; name: string }) => void
  onCancel: () => void
}

export function ScanQrModal({ onScanned, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null
    let frame: number | null = null
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    function tick() {
      const video = videoRef.current
      if (video && ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)
        if (code) {
          const parsed = parsePayLink(code.data)
          if (parsed) {
            onScanned(parsed)
            return
          }
        }
      }
      frame = requestAnimationFrame(tick)
    }

    function parsePayLink(data: string): { username: string; name: string } | null {
      try {
        const url = new URL(data)
        const username = url.searchParams.get('to')
        if (!username) return null
        return { username, name: url.searchParams.get('name') ?? username }
      } catch {
        return null
      }
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((mediaStream) => {
        if (cancelled) {
          mediaStream.getTracks().forEach((t) => t.stop())
          return
        }
        stream = mediaStream
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream
          videoRef.current.play().catch(() => {})
        }
        frame = requestAnimationFrame(tick)
      })
      .catch(() => setError('Could not access the camera. Check permissions and try again.'))

    return () => {
      cancelled = true
      if (frame) cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onScanned])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card scan-qr-modal" role="dialog" aria-modal="true">
        <span className="transfer-section-kicker">Scan QR to pay</span>
        <h2>Point your camera at a FinFlow QR code</h2>

        <div className="scan-qr-video-wrap">
          {error ? (
            <p className="form-error">{error}</p>
          ) : (
            <video ref={videoRef} className="scan-qr-video" muted playsInline />
          )}
        </div>

        <button type="button" className="link-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
