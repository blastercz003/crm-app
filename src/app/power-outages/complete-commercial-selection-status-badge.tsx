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

function preciseProcessingMessage(progress: NonNullable<CommercialSelectionProgress>) {
  const evaluating = progress.evaluationPendingCount > 0
  const enriching = progress.enrichmentPendingCount > 0
  const scoring = progress.scoringPendingCount > 0
  if (evaluating && enriching) return 'Probíhá vyhodnocení nových a aktualizovaných kandidátů i doplňování profilů ARES/RES.'
  if (evaluating) return 'Probíhá vyhodnocení nových a aktualizovaných kandidátních záznamů.'
  if (enriching && scoring) return 'Probíhá doplňování profilů ARES/RES i navazující přepočet skóre.'
  if (enriching) return 'Probíhá doplňování firemních profilů ARES/RES.'
  if (scoring) return 'Probíhá přepočet obchodního skóre.'
  return progress.statusMessage
}

export function CommercialSelectionStatusBadge({ progress, loading = false }: {
  progress?: CommercialSelectionProgress
  loading?: boolean
}) {
  const status: OrbitalStatus = loading ? 'loading' : progress?.status ?? 'unavailable'
  const presentation = PRESENTATION[status]
  const queueSummary = progress ? [
    progress.evaluationPendingCount > 0
      ? `Vyhodnocení nových a aktualizovaných kandidátních záznamů: ${progress.evaluationPendingCount.toLocaleString('cs-CZ')}.`
      : null,
    progress.enrichmentPendingCount > 0
      ? `Doplnění profilů ARES/RES: ${progress.enrichmentPendingCount.toLocaleString('cs-CZ')}.`
      : null,
    progress.scoringPendingCount > 0
      ? `Výpočet skóre: ${progress.scoringPendingCount.toLocaleString('cs-CZ')}.`
      : null,
  ].filter((item): item is string => Boolean(item)).join(' ') : ''
  const statusMessage = progress?.status === 'processing'
    ? preciseProcessingMessage(progress)
    : progress?.statusMessage
  const title = progress
    ? `${statusMessage}${queueSummary ? ` ${queueSummary}` : ''}`
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
