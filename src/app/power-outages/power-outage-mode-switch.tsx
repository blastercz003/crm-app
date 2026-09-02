'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { NAVIGATION_OVERLAY_START_EVENT } from '@/components/navigation/navigation-overlay'
import { SlidingTwoTabSwitch } from '@/components/ui/sliding-two-tab-switch'

export type PowerOutageMode = 'markets' | 'complete'

const MODE_OPTIONS = [
  { value: 'markets', label: 'Markety' },
  { value: 'complete', label: 'Kompletní' },
] as const

export function PowerOutageModeSwitch({ mode }: { mode: PowerOutageMode }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  const changeMode = (nextMode: PowerOutageMode) => {
    if (nextMode === mode) return

    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.set('mode', nextMode)
    window.dispatchEvent(new Event(NAVIGATION_OVERLAY_START_EVENT))
    router.push(`${pathname}?${nextParams.toString()}`, { scroll: false })
  }

  return (
    <section className="activities-page__panel rounded-[22px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(248,250,252,0.9)_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]">
      <SlidingTwoTabSwitch
        value={mode}
        options={MODE_OPTIONS}
        onValueChange={changeMode}
        ariaLabel="Režim monitoringu odstávek"
      />
    </section>
  )
}
