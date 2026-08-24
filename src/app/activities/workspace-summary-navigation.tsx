'use client'

import { useEffect, useRef } from 'react'
import { Activity, AlertTriangle, CalendarDays, Wrench } from 'lucide-react'

type SummaryCard = {
  label: string
  value: string
  tone: 'blue' | 'amber' | 'violet' | 'emerald'
  targetId: string
  targetLabel: string
}

const ICONS = {
  blue: Activity,
  amber: AlertTriangle,
  violet: CalendarDays,
  emerald: Wrench,
} as const

export function WorkspaceSummaryNavigation({ cards }: { cards: SummaryCard[] }) {
  const highlightedTargetRef = useRef<HTMLElement | null>(null)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelScrollRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
      cancelScrollRef.current?.()
      highlightedTargetRef.current?.removeAttribute('data-scroll-highlight')
    }
  }, [])

  function scrollToTarget(target: HTMLElement, reduceMotion: boolean) {
    const startY = window.scrollY
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const targetY = Math.min(
      maxY,
      Math.max(0, target.getBoundingClientRect().top + startY - 20),
    )
    const distance = targetY - startY

    cancelScrollRef.current?.()

    if (reduceMotion || Math.abs(distance) < 2) {
      window.scrollTo({ top: targetY, behavior: 'auto' })
      return 0
    }

    const duration = Math.min(1350, Math.max(1050, Math.abs(distance) * 0.8))
    const startedAt = performance.now()
    const controller = new AbortController()
    let animationFrame = 0

    const stop = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame)
      controller.abort()
      if (cancelScrollRef.current === stop) cancelScrollRef.current = null
    }

    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2

      window.scrollTo({ top: startY + distance * eased, behavior: 'auto' })

      if (progress < 1) {
        animationFrame = requestAnimationFrame(step)
      } else {
        controller.abort()
        cancelScrollRef.current = null
      }
    }

    const cancelOnUserInput = () => stop()
    window.addEventListener('wheel', cancelOnUserInput, { passive: true, signal: controller.signal })
    window.addEventListener('touchstart', cancelOnUserInput, { passive: true, signal: controller.signal })
    window.addEventListener('pointerdown', cancelOnUserInput, { passive: true, signal: controller.signal })
    window.addEventListener('keydown', cancelOnUserInput, { signal: controller.signal })

    cancelScrollRef.current = stop
    animationFrame = requestAnimationFrame(step)
    return duration
  }

  function navigateTo(card: SummaryCard) {
    const target = document.getElementById(card.targetId)
    if (!target) return

    window.dispatchEvent(new CustomEvent('activities:show-workspace-panel', {
      detail: { targetId: card.targetId },
    }))

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
    highlightedTargetRef.current?.removeAttribute('data-scroll-highlight')

    const scrollDuration = scrollToTarget(target, reduceMotion)
    target.setAttribute('data-scroll-highlight', 'true')
    highlightedTargetRef.current = target

    highlightTimeoutRef.current = setTimeout(() => {
      target.removeAttribute('data-scroll-highlight')
      if (highlightedTargetRef.current === target) highlightedTargetRef.current = null
      highlightTimeoutRef.current = null
    }, reduceMotion ? 500 : scrollDuration + 550)
  }

  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Rychlá navigace v pracovní ploše">
      {cards.map((card) => {
        const Icon = ICONS[card.tone]
        return (
          <button
            key={card.label}
            type="button"
            onClick={() => navigateTo(card)}
            aria-label={`${card.label}: ${card.value}. Přejít na ${card.targetLabel}.`}
            data-workspace-card="kpis"
            data-tone={card.tone}
            className="activities-page__panel activities-workspace__kpi activities-workspace__kpi-button relative min-h-[92px] overflow-hidden rounded-[22px] border p-[14px] text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)] sm:min-h-[88px] sm:p-4"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block min-h-6 text-[9px] font-semibold uppercase leading-3 tracking-[0.045em] text-[var(--text-secondary)] sm:min-h-0 sm:text-[10px] sm:tracking-[0.08em]">{card.label}</span>
                <span className="activities-workspace__kpi-value mt-1.5 block whitespace-nowrap text-[26px] font-semibold leading-none tracking-tight text-[var(--text-primary)] sm:text-[28px]">{card.value}</span>
              </span>
              <span className="activities-page__summary-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" data-tone={card.tone}><Icon aria-hidden size={17} /></span>
            </span>
          </button>
        )
      })}
    </section>
  )
}
