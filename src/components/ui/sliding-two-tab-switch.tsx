'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

export type SlidingTabOption<T extends string> = {
  value: T
  label: string
}

const SLIDE_DURATION_MS = 480

function useSlidingTabValue<T extends string>(
  value: T,
  onValueChange: (value: T) => void
) {
  const [visualValue, setVisualValue] = useState(value)
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const committedValueRef = useRef(value)

  useEffect(() => {
    if (value === committedValueRef.current) return

    committedValueRef.current = value
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }

    const frameId = window.requestAnimationFrame(() => {
      setVisualValue(value)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [value])

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current)
      }
    }
  }, [])

  function selectTab(nextValue: T) {
    if (nextValue === visualValue) return

    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current)
    }

    setVisualValue(nextValue)

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onValueChange(nextValue)
      transitionTimerRef.current = null
      return
    }

    transitionTimerRef.current = setTimeout(() => {
      onValueChange(nextValue)
      transitionTimerRef.current = null
    }, SLIDE_DURATION_MS)
  }

  return { visualValue, selectTab }
}

export function SlidingTwoTabSwitch<T extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  className = '',
}: {
  value: T
  options: readonly [SlidingTabOption<T>, SlidingTabOption<T>]
  onValueChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  const { visualValue, selectTab } = useSlidingTabValue(value, onValueChange)
  const activeIndex = options.findIndex((option) => option.value === visualValue)

  return (
    <nav className={className} aria-label={ariaLabel}>
      <div className="relative h-10">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-2 gap-2">
          {options.map((option) => (
            <span
              key={option.value}
              className="flex items-center justify-center px-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-600 sm:text-[11px] [html[data-theme='dark']_&]:text-slate-400"
            >
              {option.label}
            </span>
          ))}
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-10 rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_20px_rgba(41,128,185,0.22)] transition-transform duration-[480ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none [html[data-theme='dark']_&]:border-[rgba(92,167,219,0.32)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(45,97,142,0.98)_0%,rgba(28,76,118,0.96)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_20px_rgba(9,48,82,0.22)]"
          style={{
            width: 'calc((100% - 0.5rem) / 2)',
            transform:
              activeIndex === 1 ? 'translateX(calc(100% + 0.5rem))' : 'translateX(0)',
          }}
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[11] grid grid-cols-2 gap-2 transition-[clip-path] duration-[480ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
          style={{
            clipPath:
              activeIndex === 1
                ? 'inset(0 0 0 calc(50% + 0.25rem) round 0.75rem)'
                : 'inset(0 calc(50% + 0.25rem) 0 0 round 0.75rem)',
          }}
        >
          {options.map((option) => (
            <span
              key={option.value}
              className="flex items-center justify-center px-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-white sm:text-[11px]"
            >
              {option.label}
            </span>
          ))}
        </div>

        <div className="absolute inset-0 z-20 grid grid-cols-2 gap-2">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => selectTab(option.value)}
              onMouseDown={(event) => event.preventDefault()}
              aria-pressed={visualValue === option.value}
              className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fc2e5] focus-visible:ring-offset-2"
            >
              <span className="sr-only">{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}

export function SlidingFourTabSwitch<T extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  className = '',
}: {
  value: T
  options: readonly [
    SlidingTabOption<T>,
    SlidingTabOption<T>,
    SlidingTabOption<T>,
    SlidingTabOption<T>,
  ]
  onValueChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  const { visualValue, selectTab } = useSlidingTabValue(value, onValueChange)
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === visualValue)
  )
  const mobileColumn = activeIndex % 2
  const mobileRow = Math.floor(activeIndex / 2)
  const mobileHorizontalInset = mobileColumn === 0 ? '0' : 'calc(50% + 0.125rem)'
  const mobileOppositeHorizontalInset =
    mobileColumn === 0 ? 'calc(50% + 0.125rem)' : '0'
  const mobileVerticalInset = mobileRow === 0 ? '0' : '2.5rem'
  const mobileOppositeVerticalInset = mobileRow === 0 ? '2.5rem' : '0'
  const desktopLeftInset =
    activeIndex === 0 ? '0' : `calc(${activeIndex * 25}% + ${activeIndex * 0.0625}rem)`
  const desktopRightSteps = 3 - activeIndex
  const desktopRightInset =
    desktopRightSteps === 0
      ? '0'
      : `calc(${desktopRightSteps * 25}% + ${desktopRightSteps * 0.0625}rem)`
  const switchStyle = {
    '--sliding-four-mobile-left': mobileHorizontalInset,
    '--sliding-four-mobile-top': mobileVerticalInset,
    '--sliding-four-mobile-clip': `inset(${mobileVerticalInset} ${mobileOppositeHorizontalInset} ${mobileOppositeVerticalInset} ${mobileHorizontalInset} round 0.75rem)`,
    '--sliding-four-desktop-left': desktopLeftInset,
    '--sliding-four-desktop-clip': `inset(0 ${desktopRightInset} 0 ${desktopLeftInset} round 0.75rem)`,
  } as CSSProperties

  return (
    <nav className={className} aria-label={ariaLabel} style={switchStyle}>
      <div className="relative h-[4.75rem] sm:h-9">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 grid grid-cols-2 gap-1 sm:grid-cols-4"
        >
          {options.map((option) => (
            <span
              key={option.value}
              className="flex h-9 items-center justify-center px-2 text-center text-[10px] font-semibold tracking-[0.09em] text-zinc-500 sm:text-[11px] [html[data-theme='dark']_&]:text-slate-400"
            >
              {option.label}
            </span>
          ))}
        </div>

        <div
          aria-hidden="true"
          className="sliding-four-tab-switch__indicator pointer-events-none absolute z-10 h-9 rounded-2xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_20px_rgba(41,128,185,0.22)] motion-reduce:transition-none [html[data-theme='dark']_&]:border-[rgba(92,167,219,0.32)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(45,97,142,0.98)_0%,rgba(28,76,118,0.96)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_20px_rgba(9,48,82,0.22)]"
        />

        <div
          aria-hidden="true"
          className="sliding-four-tab-switch__active-labels pointer-events-none absolute inset-0 z-[11] grid grid-cols-2 gap-1 motion-reduce:transition-none sm:grid-cols-4"
        >
          {options.map((option) => (
            <span
              key={option.value}
              className="flex h-9 items-center justify-center px-2 text-center text-[10px] font-semibold tracking-[0.09em] text-white sm:text-[11px]"
            >
              {option.label}
            </span>
          ))}
        </div>

        <div className="absolute inset-0 z-20 grid grid-cols-2 gap-1 sm:grid-cols-4">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => selectTab(option.value)}
              onMouseDown={(event) => event.preventDefault()}
              aria-pressed={visualValue === option.value}
              className="h-9 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fc2e5] focus-visible:ring-offset-2"
            >
              <span className="sr-only">{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}

export function SlidingSingleRowTabSwitch<T extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  className = '',
}: {
  value: T
  options: readonly SlidingTabOption<T>[]
  onValueChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  const { visualValue, selectTab } = useSlidingTabValue(value, onValueChange)
  const optionCount = Math.max(1, options.length)
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === visualValue)
  )
  const remainingSteps = optionCount - activeIndex - 1
  const indicatorWidth = `calc(${100 / optionCount}% - ${
    ((optionCount - 1) * 0.25) / optionCount
  }rem)`
  const indicatorLeft =
    activeIndex === 0
      ? '0'
      : `calc(${(activeIndex * 100) / optionCount}% + ${
          (activeIndex * 0.25) / optionCount
        }rem)`
  const indicatorRight =
    remainingSteps === 0
      ? '0'
      : `calc(${(remainingSteps * 100) / optionCount}% + ${
          (remainingSteps * 0.25) / optionCount
        }rem)`
  const gridStyle = {
    gridTemplateColumns: `repeat(${optionCount}, minmax(0, 1fr))`,
  }

  return (
    <nav className={className} aria-label={ariaLabel}>
      <div className="relative h-9">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 grid gap-1"
          style={gridStyle}
        >
          {options.map((option) => (
            <span
              key={option.value}
              className="flex h-9 min-w-0 items-center justify-center truncate px-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.04em] text-zinc-500 sm:px-2 sm:text-[11px] sm:tracking-[0.09em] [html[data-theme='dark']_&]:text-slate-400"
            >
              {option.label}
            </span>
          ))}
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-10 rounded-2xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_20px_rgba(41,128,185,0.22)] transition-[left] duration-[480ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none [html[data-theme='dark']_&]:border-[rgba(92,167,219,0.32)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(45,97,142,0.98)_0%,rgba(28,76,118,0.96)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_20px_rgba(9,48,82,0.22)]"
          style={{ width: indicatorWidth, left: indicatorLeft }}
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[11] grid gap-1 transition-[clip-path] duration-[480ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
          style={{
            ...gridStyle,
            clipPath: `inset(0 ${indicatorRight} 0 ${indicatorLeft} round 1rem)`,
          }}
        >
          {options.map((option) => (
            <span
              key={option.value}
              className="flex h-9 min-w-0 items-center justify-center truncate px-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.04em] text-white sm:px-2 sm:text-[11px] sm:tracking-[0.09em]"
            >
              {option.label}
            </span>
          ))}
        </div>

        <div className="absolute inset-0 z-20 grid gap-1" style={gridStyle}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => selectTab(option.value)}
              onMouseDown={(event) => event.preventDefault()}
              aria-pressed={visualValue === option.value}
              className="h-9 min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fc2e5] focus-visible:ring-offset-2"
            >
              <span className="sr-only">{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}

export function SlidingResponsiveTabSwitch<T extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  className = '',
}: {
  value: T
  options: readonly SlidingTabOption<T>[]
  onValueChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  const { visualValue, selectTab } = useSlidingTabValue(value, onValueChange)
  const optionCount = Math.max(1, options.length)
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === visualValue))
  const mobileRows = Math.ceil(optionCount / 2)
  const mobileColumn = activeIndex % 2
  const mobileRow = Math.floor(activeIndex / 2)
  const mobileLeft = mobileColumn === 0 ? '0' : 'calc(50% + 0.125rem)'
  const mobileRight = mobileColumn === 0 ? 'calc(50% + 0.125rem)' : '0'
  const mobileTop = `${mobileRow * 2.5}rem`
  const mobileBottom = `calc(100% - ${mobileRow * 2.5 + 2.25}rem)`
  const desktopLeft =
    activeIndex === 0
      ? '0'
      : `calc(${(activeIndex * 100) / optionCount}% + ${(activeIndex * 0.25) / optionCount}rem)`
  const desktopRightSteps = optionCount - activeIndex - 1
  const desktopRight =
    desktopRightSteps === 0
      ? '0'
      : `calc(${(desktopRightSteps * 100) / optionCount}% + ${(desktopRightSteps * 0.25) / optionCount}rem)`
  const switchStyle = {
    '--sliding-responsive-tab-count': optionCount,
    '--sliding-responsive-mobile-rows': mobileRows,
    '--sliding-responsive-mobile-left': mobileLeft,
    '--sliding-responsive-mobile-top': mobileTop,
    '--sliding-responsive-mobile-clip': `inset(${mobileTop} ${mobileRight} ${mobileBottom} ${mobileLeft} round 1rem)`,
    '--sliding-responsive-desktop-left': desktopLeft,
    '--sliding-responsive-desktop-clip': `inset(0 ${desktopRight} 0 ${desktopLeft} round 1rem)`,
  } as CSSProperties

  return (
    <nav className={className} aria-label={ariaLabel} style={switchStyle}>
      <div className="sliding-responsive-tab-switch__body relative">
        <div aria-hidden="true" className="sliding-responsive-tab-switch__grid pointer-events-none absolute inset-0 grid gap-1">
          {options.map((option) => (
            <span
              key={option.value}
              className="flex h-9 min-w-0 items-center justify-center truncate px-2 text-center text-[10px] font-semibold uppercase tracking-[0.07em] text-zinc-500 sm:text-[11px] sm:tracking-[0.09em] [html[data-theme='dark']_&]:text-slate-400"
            >
              {option.label}
            </span>
          ))}
        </div>

        <div
          aria-hidden="true"
          className="sliding-responsive-tab-switch__indicator pointer-events-none absolute z-10 h-9 rounded-2xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_20px_rgba(41,128,185,0.22)] motion-reduce:transition-none [html[data-theme='dark']_&]:border-[rgba(92,167,219,0.32)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(45,97,142,0.98)_0%,rgba(28,76,118,0.96)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_20px_rgba(9,48,82,0.22)]"
        />

        <div
          aria-hidden="true"
          className="sliding-responsive-tab-switch__active-labels pointer-events-none absolute inset-0 z-[11] grid gap-1 motion-reduce:transition-none"
        >
          {options.map((option) => (
            <span
              key={option.value}
              className="flex h-9 min-w-0 items-center justify-center truncate px-2 text-center text-[10px] font-semibold uppercase tracking-[0.07em] text-white sm:text-[11px] sm:tracking-[0.09em]"
            >
              {option.label}
            </span>
          ))}
        </div>

        <div className="sliding-responsive-tab-switch__grid absolute inset-0 z-20 grid gap-1">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => selectTab(option.value)}
              onMouseDown={(event) => event.preventDefault()}
              aria-pressed={visualValue === option.value}
              className="h-9 min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fc2e5] focus-visible:ring-offset-2"
            >
              <span className="sr-only">{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}
