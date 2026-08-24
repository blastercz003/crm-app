'use client'

import {
  Children,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react'

export function ManualActivityCarousel({
  initialSection = 'planned',
  children,
}: {
  initialSection?: 'planned' | 'logged'
  children: ReactNode
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const sections = Children.toArray(children)
  const initialIndex = initialSection === 'logged' ? 1 : 0

  useLayoutEffect(() => {
    const track = trackRef.current
    const section = track?.children.item(initialIndex) as HTMLElement | null
    if (track && section && !window.matchMedia('(min-width: 640px)').matches) {
      track.scrollLeft = section.offsetLeft
    }
  }, [initialIndex])

  return (
    <div className="mt-4 min-w-0">
      <p className="mb-3 text-[10px] text-[var(--text-secondary)] sm:hidden">
        Přejetím do strany zobrazíte další část.
      </p>
      <div
        ref={trackRef}
        className="activities-manual-carousel flex min-w-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain sm:grid sm:snap-none sm:grid-cols-1 sm:gap-5 sm:overflow-visible lg:grid-cols-2"
        aria-label="Pracovní agenda"
      >
        {sections.map((section, index) => (
          <div
            key={index === 0 ? 'planned' : 'logged'}
            className="min-h-[632px] w-full min-w-0 shrink-0 snap-start snap-always sm:w-auto sm:shrink"
          >
            {section}
          </div>
        ))}
      </div>
    </div>
  )
}
