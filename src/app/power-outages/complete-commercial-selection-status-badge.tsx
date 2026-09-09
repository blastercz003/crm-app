import type { CompletePowerOutageSidebarWorkspace } from '@/lib/power-outages/complete-types'
import type { CSSProperties } from 'react'

type CommercialSelectionProgress = CompletePowerOutageSidebarWorkspace['commercialSelection']['progress']
type OrbitalStatus = NonNullable<CommercialSelectionProgress>['status'] | 'loading' | 'unavailable'

const PRESENTATION: Record<OrbitalStatus, {
  label: string
  ring: string
  core: string
  satellite: string
  speed: string
}> = {
  loading: {
    label: 'NAČÍTÁM',
    ring: 'border-violet-400/45', core: 'bg-violet-400', satellite: 'bg-cyan-400', speed: '1.5s',
  },
  unavailable: {
    label: 'NEDOSTUPNÉ',
    ring: 'border-amber-400/50', core: 'bg-amber-400', satellite: 'bg-violet-400', speed: '7s',
  },
  inactive: {
    label: 'NEAKTIVNÍ',
    ring: 'border-slate-400/45', core: 'bg-slate-400', satellite: 'bg-slate-300', speed: '8s',
  },
  current: {
    label: 'AKTUÁLNÍ',
    ring: 'border-cyan-400/50', core: 'bg-emerald-400', satellite: 'bg-cyan-300', speed: '6s',
  },
  processing: {
    label: 'ZPRACOVÁNÍ',
    ring: 'border-violet-400/55', core: 'bg-violet-400', satellite: 'bg-cyan-300', speed: '2.4s',
  },
  attention: {
    label: 'POZORNOST',
    ring: 'border-amber-400/60', core: 'bg-amber-400', satellite: 'bg-fuchsia-400', speed: '1.8s',
  },
}

export function CommercialSelectionStatusBadge({ progress, loading = false }: {
  progress?: CommercialSelectionProgress
  loading?: boolean
}) {
  const status: OrbitalStatus = loading ? 'loading' : progress?.status ?? 'unavailable'
  const presentation = PRESENTATION[status]
  const title = progress
    ? `${progress.statusMessage} Zbývá ${progress.remainingCount.toLocaleString('cs-CZ')} položek.`
    : loading ? 'Načítám provozní stav obchodního výběru.' : 'Provozní stav obchodního výběru není dostupný.'

  return <span
    role="status"
    aria-label={`${presentation.label}. ${title}`}
    title={title}
    className="relative inline-flex h-10 w-10 shrink-0 items-start justify-end"
  >
    <span aria-hidden className="relative block h-8 w-8 shrink-0">
      <i className={`complete-commercial-orbital-core absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${presentation.core}`} />
      <i
        className={`complete-commercial-orbital-track absolute inset-0 rounded-full border ${presentation.ring}`}
        style={{ '--complete-commercial-orbit-speed': presentation.speed } as CSSProperties}
      >
        <i className={`absolute -right-[3px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full shadow-[0_0_8px_currentColor] ${presentation.satellite}`} />
      </i>
    </span>
  </span>
}
