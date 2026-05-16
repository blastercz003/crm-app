export type SnakeSoundEvent =
  | 'countdownTick'
  | 'countdownGo'
  | 'turn'
  | 'food'
  | 'bonusFood'
  | 'obstacleRise'
  | 'gameOver'

type ToneConfig = {
  frequency: number
  durationMs: number
  gain: number
  type?: OscillatorType
  delayMs?: number
}

function playTone(context: AudioContext, tone: ToneConfig) {
  const oscillator = context.createOscillator()
  const gainNode = context.createGain()
  const now = context.currentTime
  const start = now + (tone.delayMs ?? 0) / 1000
  const end = start + tone.durationMs / 1000

  oscillator.type = tone.type ?? 'sine'
  oscillator.frequency.setValueAtTime(tone.frequency, start)
  gainNode.gain.setValueAtTime(0.0001, start)
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, tone.gain), start + 0.01)
  gainNode.gain.exponentialRampToValueAtTime(0.0001, end)

  oscillator.connect(gainNode)
  gainNode.connect(context.destination)
  oscillator.start(start)
  oscillator.stop(end + 0.02)
}

function getPattern(event: SnakeSoundEvent): ToneConfig[] {
  switch (event) {
    case 'countdownTick':
      return [{ frequency: 640, durationMs: 70, gain: 0.04, type: 'square' }]
    case 'countdownGo':
      return [
        { frequency: 880, durationMs: 90, gain: 0.05, type: 'square' },
        { frequency: 1320, durationMs: 120, gain: 0.05, type: 'triangle', delayMs: 70 },
      ]
    case 'turn':
      return [{ frequency: 420, durationMs: 40, gain: 0.022, type: 'triangle' }]
    case 'food':
      return [
        { frequency: 760, durationMs: 70, gain: 0.04, type: 'triangle' },
        { frequency: 980, durationMs: 90, gain: 0.04, type: 'triangle', delayMs: 50 },
      ]
    case 'bonusFood':
      return [
        { frequency: 900, durationMs: 80, gain: 0.05, type: 'sawtooth' },
        { frequency: 1200, durationMs: 90, gain: 0.05, type: 'triangle', delayMs: 50 },
        { frequency: 1600, durationMs: 100, gain: 0.045, type: 'sine', delayMs: 100 },
      ]
    case 'obstacleRise':
      return [
        { frequency: 420, durationMs: 90, gain: 0.04, type: 'square' },
        { frequency: 300, durationMs: 120, gain: 0.04, type: 'square', delayMs: 70 },
      ]
    case 'gameOver':
      return [
        { frequency: 360, durationMs: 130, gain: 0.05, type: 'sawtooth' },
        { frequency: 220, durationMs: 180, gain: 0.045, type: 'triangle', delayMs: 90 },
      ]
    default:
      return []
  }
}

export function createSnakeSoundEngine() {
  let context: AudioContext | null = null
  let enabled = true

  const ensureContext = () => {
    if (typeof window === 'undefined') return null
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return null
    if (!context) context = new AudioContextCtor()
    if (context.state === 'suspended') {
      void context.resume()
    }
    return context
  }

  return {
    setEnabled(value: boolean) {
      enabled = value
    },
    unlock() {
      ensureContext()
    },
    play(event: SnakeSoundEvent) {
      if (!enabled) return
      const audioContext = ensureContext()
      if (!audioContext) return
      const pattern = getPattern(event)
      for (const tone of pattern) playTone(audioContext, tone)
    },
  }
}
