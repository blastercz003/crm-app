'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Archive, CircleCheckBig, Database, LoaderCircle, RefreshCw, SearchCheck, TriangleAlert, Zap } from 'lucide-react'

type SummaryTone = 'blue' | 'amber' | 'violet' | 'emerald' | 'slate'

export type PowerOutageSummaryCard = {
  label: string
  value: number | null
  tone: SummaryTone
  icon?: 'check' | 'review'
}

const ICONS = {
  blue: Database,
  amber: Zap,
  violet: SearchCheck,
  emerald: CircleCheckBig,
  slate: Archive,
  check: CircleCheckBig,
  review: TriangleAlert,
} as const

const COUNT_DURATION_MS = 4_500
const COUNT_STAGGER_MS = 120

function AnimatedNumber({ value, index }: { value: number; index: number }) {
  const [displayed, setDisplayed] = useState(0)
  const displayedRef = useRef(0)
  const hasAnimatedRef = useRef(false)

  useEffect(() => {
    let animationFrame = 0
    const target = Math.max(0, Math.round(value))
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion) {
      animationFrame = requestAnimationFrame(() => {
        displayedRef.current = target
        setDisplayed(target)
        hasAnimatedRef.current = true
      })
      return () => cancelAnimationFrame(animationFrame)
    }

    const start = hasAnimatedRef.current ? displayedRef.current : 0
    const delay = hasAnimatedRef.current ? 0 : index * COUNT_STAGGER_MS
    const startedAt = performance.now() + delay

    const step = (now: number) => {
      if (now < startedAt) {
        animationFrame = requestAnimationFrame(step)
        return
      }

      const progress = Math.min(1, (now - startedAt) / COUNT_DURATION_MS)
      const eased = progress * progress * (3 - 2 * progress)
      const next = Math.round(start + (target - start) * eased)
      if (next !== displayedRef.current) {
        displayedRef.current = next
        setDisplayed(next)
      }

      if (progress < 1) {
        animationFrame = requestAnimationFrame(step)
      } else {
        displayedRef.current = target
        setDisplayed(target)
        hasAnimatedRef.current = true
      }
    }

    animationFrame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(animationFrame)
  }, [index, value])

  return (
    <>
      <span aria-hidden="true">{displayed}</span>
      <span className="sr-only">{value}</span>
    </>
  )
}

export function PowerOutageSummaryStats({ cards, error, onRetry }: {
  cards: PowerOutageSummaryCard[]
  error?: string | null
  onRetry?: () => void
}) {
  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Souhrn plánovaných odstávek">
      {cards.map((card, index) => {
        const Icon = ICONS[card.icon ?? card.tone]
        return (
          <article
            key={card.label}
            data-tone={card.tone}
            className="activities-page__panel activities-workspace__kpi relative min-h-[92px] overflow-hidden rounded-[22px] border p-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)] sm:min-h-[88px] sm:p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="block min-h-6 text-[9px] font-semibold uppercase leading-3 tracking-[0.045em] text-[var(--text-secondary)] sm:min-h-0 sm:text-[10px] sm:tracking-[0.08em]">
                  {card.label}
                </span>
                <strong className="mt-1.5 flex h-7 items-center whitespace-nowrap text-[26px] font-semibold leading-none tracking-tight text-[var(--text-primary)] tabular-nums sm:text-[28px]">
                  {card.value !== null
                    ? <AnimatedNumber value={card.value} index={index} />
                    : error
                      ? <button type="button" onClick={onRetry} title={error} className="inline-flex h-7 items-center gap-1.5 rounded-lg text-[9px] font-bold uppercase tracking-[0.04em] text-red-600 transition hover:text-red-700 [html[data-theme=dark]_&]:text-red-300"><RefreshCw aria-hidden size={13} /> Znovu</button>
                      : <LoaderCircle aria-label="Načítám statistiku" size={18} className="animate-spin text-[var(--accent)]" />}
                </strong>
              </div>
              <span
                className="activities-page__summary-icon activities-page__summary-icon--animated flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                data-tone={card.tone}
                style={{
                  '--kpi-wake-delay': `${index * COUNT_STAGGER_MS}ms`,
                  '--kpi-finish-delay': `${COUNT_DURATION_MS + index * COUNT_STAGGER_MS}ms`,
                } as CSSProperties}
              >
                <Icon aria-hidden size={17} />
              </span>
            </div>
          </article>
        )
      })}
    </section>
  )
}
