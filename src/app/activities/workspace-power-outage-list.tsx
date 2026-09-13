'use client'

import { Building2, CalendarDays, MessageSquareText } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CompletePowerOutageCommunicationPopup,
} from '@/app/power-outages/complete-power-outage-records'
import type { CompleteCommunicationWorkflowStatus } from '@/lib/power-outages/complete-types'
import type { ActivityWorkspacePowerOutage } from '@/lib/activities/workspace-types'

const PRAGUE_TIME_ZONE = 'Europe/Prague'

const STATUS_PRESENTATION: Record<ActivityWorkspacePowerOutage['communicationStatus'], {
  label: string
  className: string
}> = {
  not_contacted: {
    label: 'NEOSLOVENO',
    className: 'border-slate-400/30 bg-slate-400/10 text-[var(--text-secondary)]',
  },
  contacted: {
    label: 'OSLOVENO',
    className: 'border-sky-400/35 bg-sky-400/10 text-sky-600 [html[data-theme=dark]_&]:text-sky-300',
  },
  unreachable: {
    label: 'NEZASTIŽENO',
    className: 'border-amber-400/35 bg-amber-400/10 text-amber-600 [html[data-theme=dark]_&]:text-amber-300',
  },
  interested: {
    label: 'PROJEVEN ZÁJEM',
    className: 'border-violet-400/35 bg-violet-400/10 text-violet-600 [html[data-theme=dark]_&]:text-violet-300',
  },
  offer_sent: {
    label: 'NABÍDKA ODESLÁNA',
    className: 'border-cyan-400/35 bg-cyan-400/10 text-cyan-600 [html[data-theme=dark]_&]:text-cyan-300',
  },
}

function addressLabel(item: ActivityWorkspacePowerOutage) {
  if (item.displayAddress?.trim()) return item.displayAddress.trim()
  const number = [item.houseNumber, item.orientationNumber].filter(Boolean).join('/')
  return [item.street && `${item.street}${number ? ` ${number}` : ''}`, item.townPart]
    .filter(Boolean)
    .join(', ') || item.rawAddress
}

function formatPeriod(startsAt: string, endsAt: string) {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Termín neuveden'

  const day = new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    timeZone: PRAGUE_TIME_ZONE,
  })
  const time = new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PRAGUE_TIME_ZONE,
  })
  const startDay = day.format(start)
  const endDay = day.format(end)
  return startDay === endDay
    ? `${startDay} ${time.format(start)}–${time.format(end)}`
    : `${startDay} ${time.format(start)} – ${endDay} ${time.format(end)}`
}

export function WorkspacePowerOutageList({
  items: initialItems,
}: {
  items: ActivityWorkspacePowerOutage[]
}) {
  const [selected, setSelected] = useState<ActivityWorkspacePowerOutage | null>(null)
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set())
  const [statusOverrides, setStatusOverrides] = useState<Record<string, ActivityWorkspacePowerOutage['communicationStatus']>>({})
  const items = initialItems
    .filter((item) => !removedIds.has(item.candidateId))
    .map((item) => statusOverrides[item.candidateId]
      ? { ...item, communicationStatus: statusOverrides[item.candidateId] }
      : item)

  function handleChanged(status: CompleteCommunicationWorkflowStatus, assignmentExists: boolean) {
    if (!selected) return
    if (!assignmentExists || status === 'job_won' || status === 'closed_no_job') {
      setRemovedIds((current) => new Set(current).add(selected.candidateId))
      return
    }

    setStatusOverrides((current) => ({ ...current, [selected.candidateId]: status }))
  }

  return (
    <>
      {items.length ? <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const status = STATUS_PRESENTATION[item.communicationStatus]
          return (
            <button
              key={item.candidateId}
              type="button"
              onClick={() => setSelected(item)}
              aria-label={`Otevřít správu komunikace pro firmu ${item.companyName}`}
              className="activities-workspace__row grid h-[68px] min-h-[68px] min-w-0 grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2 text-left transition hover:-translate-y-px hover:border-sky-400/35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-[var(--accent)]">
                <Building2 aria-hidden size={15} />
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-[11px] font-semibold text-[var(--text-primary)]">{item.companyName}</strong>
                <span className="mt-0.5 block truncate text-[9px] text-[var(--text-secondary)]">{[item.municipality, addressLabel(item)].filter(Boolean).join(' · ')}</span>
                <span className="mt-1 flex min-w-0 items-center gap-1 text-[8px] font-semibold tabular-nums text-[var(--text-secondary)]">
                  <CalendarDays aria-hidden size={10} className="shrink-0 text-[var(--accent)]" />
                  <span className="truncate">{formatPeriod(item.startsAt, item.endsAt)}</span>
                </span>
              </span>
              <span className="flex h-full min-w-0 flex-col items-end justify-between py-0.5">
                <span className={`max-w-[108px] truncate rounded-full border px-2 py-1 text-[6.5px] font-bold ${status.className}`}>{status.label}</span>
                <MessageSquareText aria-hidden size={14} className="text-[var(--accent)]" />
              </span>
            </button>
          )
        })}
      </div> : <div className="activities-workspace__empty-state flex min-h-28 items-center justify-center rounded-2xl border px-4 text-center text-sm text-[var(--text-secondary)]">Nemáte žádnou aktuální ani budoucí přidělenou odstávku k řešení.</div>}

      {selected && typeof document !== 'undefined' ? createPortal(
        <CompletePowerOutageCommunicationPopup
          item={selected}
          onClose={() => setSelected(null)}
          onChanged={(assignment, status) => handleChanged(status, Boolean(assignment))}
        />,
        document.body,
      ) : null}
    </>
  )
}
