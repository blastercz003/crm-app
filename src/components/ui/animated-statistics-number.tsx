'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

const DEFAULT_ANIMATION_DURATION_MS = 2250
const AnimatedStatisticsProgressContext = createContext(1)

export function AnimatedStatisticsProvider({
  animate = true,
  durationMs = DEFAULT_ANIMATION_DURATION_MS,
  onComplete,
  children,
}: {
  animate?: boolean
  durationMs?: number
  onComplete?: () => void
  children: ReactNode
}) {
  const [progress, setProgress] = useState(animate ? 0 : 1)

  useEffect(() => {
    if (!animate) return

    let animationFrame = 0
    let startedAt: number | null = null
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches

    const step = (now: number) => {
      if (startedAt === null) startedAt = now
      const rawProgress = reduceMotion
        ? 1
        : Math.min(1, (now - startedAt) / durationMs)
      const easedProgress = rawProgress * rawProgress * (3 - 2 * rawProgress)

      setProgress(easedProgress)

      if (rawProgress < 1) {
        animationFrame = requestAnimationFrame(step)
      } else {
        onComplete?.()
      }
    }

    animationFrame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(animationFrame)
  }, [animate, durationMs, onComplete])

  return (
    <AnimatedStatisticsProgressContext.Provider value={progress}>
      {children}
    </AnimatedStatisticsProgressContext.Provider>
  )
}

export function useAnimatedStatisticsProgress() {
  return useContext(AnimatedStatisticsProgressContext)
}

export function AnimatedStatisticsNumber({
  value,
  formatter,
}: {
  value: number
  formatter: (value: number) => string
}) {
  const progress = useAnimatedStatisticsProgress()
  const finalValue = formatter(value)

  return (
    <>
      <span aria-hidden="true" className="tabular-nums">
        {formatter(value * progress)}
      </span>
      <span className="sr-only">{finalValue}</span>
    </>
  )
}
