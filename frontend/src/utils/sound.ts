let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  audioContext ??= new Ctor()
  return audioContext
}

// Two quick sine tones (a rising fifth) instead of a bundled audio file —
// keeps the "ting" self-contained with no asset to fetch or ship.
export function playSuccessTing() {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()

  const notes = [
    { freq: 1046.5, start: 0, duration: 0.16 }, // C6
    { freq: 1568.0, start: 0.07, duration: 0.22 }, // G6
  ]

  for (const { freq, start, duration } of notes) {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = freq
    oscillator.connect(gain)
    gain.connect(ctx.destination)

    const startTime = ctx.currentTime + start
    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(0.22, startTime + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

    oscillator.start(startTime)
    oscillator.stop(startTime + duration + 0.02)
  }
}
