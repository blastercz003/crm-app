'use client'

import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

export type MobileWorkspacePanel = 'tasks' | 'meetings' | 'offers' | 'jobs'

type CarouselTab = {
  value: MobileWorkspacePanel
  label: string
}

const PANEL_TARGETS: Record<string, MobileWorkspacePanel> = {
  'pracovni-ukoly': 'tasks',
  'pracovni-schuzky': 'meetings',
  'pracovni-nabidky': 'offers',
  'pracovni-zakazky': 'jobs',
}

export function MobileWorkspaceCarousel({
  tabs,
  initialPanel,
  children,
}: {
  tabs: readonly CarouselTab[]
  initialPanel: MobileWorkspacePanel
  children: ReactNode
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const panels = Children.toArray(children)
  const initialIndex = Math.max(0, tabs.findIndex((tab) => tab.value === initialPanel))
  const [activeIndex, setActiveIndex] = useState(initialIndex)

  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const track = trackRef.current
    const panel = track?.children.item(index) as HTMLElement | null
    if (!track || !panel) return

    track.scrollTo({ left: panel.offsetLeft, behavior })
    setActiveIndex(index)
  }, [])

  useLayoutEffect(() => {
    const track = trackRef.current
    const panel = track?.children.item(initialIndex) as HTMLElement | null
    if (track && panel) track.scrollLeft = panel.offsetLeft
  }, [initialIndex])

  useEffect(() => {
    function showPanel(event: Event) {
      const targetId = (event as CustomEvent<{ targetId?: string }>).detail?.targetId
      const panel = targetId ? PANEL_TARGETS[targetId] : undefined
      const index = panel ? tabs.findIndex((tab) => tab.value === panel) : -1
      if (index >= 0) scrollToIndex(index)
    }

    window.addEventListener('activities:show-workspace-panel', showPanel)
    return () => window.removeEventListener('activities:show-workspace-panel', showPanel)
  }, [scrollToIndex, tabs])

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current)
  }, [])

  function syncActivePanel() {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      const track = trackRef.current
      if (!track || window.matchMedia('(min-width: 640px)').matches) return

      const nearestIndex = [...track.children].reduce((nearest, panel, index) => {
        const nearestPanel = track.children.item(nearest) as HTMLElement | null
        const currentDistance = Math.abs((panel as HTMLElement).offsetLeft - track.scrollLeft)
        const nearestDistance = nearestPanel
          ? Math.abs(nearestPanel.offsetLeft - track.scrollLeft)
          : Number.POSITIVE_INFINITY
        return currentDistance < nearestDistance ? index : nearest
      }, 0)

      setActiveIndex(nearestIndex)
      scrollFrameRef.current = null
    })
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + direction + tabs.length) % tabs.length
    scrollToIndex(nextIndex)
    document.getElementById(`activities-mobile-tab-${tabs[nextIndex].value}`)?.focus()
  }

  return (
    <section className="min-w-0" aria-label="Pracovní panely">
      <nav
        className="mb-3 rounded-[20px] border border-zinc-200/80 bg-zinc-100/75 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] sm:hidden [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.68)] [html[data-theme='dark']_&]:shadow-[0_8px_18px_rgba(2,6,23,0.18)]"
        aria-label="Přepnout pracovní panel"
        role="tablist"
      >
        <div className="relative grid h-9 grid-cols-4">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-1/4 rounded-2xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_18px_rgba(41,128,185,0.2)] transition-transform duration-[420ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none [html[data-theme='dark']_&]:border-[rgba(92,167,219,0.32)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(45,97,142,0.98)_0%,rgba(28,76,118,0.96)_100%)] [html[data-theme='dark']_&]:shadow-[0_8px_18px_rgba(0,0,0,0.28)]"
            style={{ transform: `translateX(${activeIndex * 100}%)` }}
          />
          {tabs.map((tab, index) => {
            const active = index === activeIndex
            return (
              <button
                key={tab.value}
                id={`activities-mobile-tab-${tab.value}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`activities-mobile-panel-${tab.value}`}
                onClick={() => scrollToIndex(index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`relative z-10 flex min-w-0 items-center justify-center rounded-2xl px-1 text-center text-[9px] font-semibold uppercase tracking-[0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fc2e5] focus-visible:ring-offset-2 ${active ? 'text-white' : "text-zinc-500 [html[data-theme='dark']_&]:text-slate-400"}`}
              >
                <span className="min-w-0 truncate">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      <div
        ref={trackRef}
        onScroll={syncActivePanel}
        className="activities-mobile-workspace-carousel flex min-w-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-[26px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] sm:grid sm:snap-none sm:grid-cols-1 sm:gap-4 sm:overflow-visible sm:rounded-none sm:shadow-none [html[data-theme='dark']_&]:shadow-[0_18px_42px_rgba(2,6,23,0.3)] sm:[html[data-theme='dark']_&]:shadow-none lg:grid-cols-2 xl:grid-cols-12 xl:gap-5"
      >
        {panels.map((panel, index) => (
          <div
            key={tabs[index]?.value ?? index}
            id={tabs[index] ? `activities-mobile-panel-${tabs[index].value}` : undefined}
            role="tabpanel"
            aria-labelledby={tabs[index] ? `activities-mobile-tab-${tabs[index].value}` : undefined}
            className="w-full min-w-0 shrink-0 snap-start sm:contents"
          >
            {panel}
          </div>
        ))}
      </div>
    </section>
  )
}
