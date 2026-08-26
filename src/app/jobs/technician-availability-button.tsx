'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ModalHeading } from '@/components/ui/modal-heading'
import { useModalMotionClose } from '@/components/ui/modal-motion'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import {
  getTechnicianAvailabilityDataAction,
  deleteTechnicianUnavailabilityAction,
  saveWeekendOnCallAction,
  saveTechnicianUnavailabilityAction,
  type TechnicianAvailabilityData,
  type TechnicianOption,
} from './technician-availability-actions'

type DayKey = 'friday' | 'saturday' | 'sunday'

const DAY_LABELS: Record<DayKey, string> = {
  friday: 'Pátek',
  saturday: 'Sobota',
  sunday: 'Neděle',
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatDayAndMonth(dateKey: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
  }).format(new Date(`${dateKey}T12:00:00Z`))
}

function formatWeekend(friday: string) {
  const sunday = addDays(friday, 2)
  const formatter = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  })
  return `${formatter.format(new Date(`${friday}T12:00:00Z`))} – ${formatter.format(
    new Date(`${sunday}T12:00:00Z`)
  )}`
}

function formatDateTimeRange(startsAt: string, endsAt: string) {
  const formatter = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${formatter.format(new Date(startsAt))} – ${formatter.format(new Date(endsAt))}`
}

function formatDateTimeInput(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}

function pragueDateTimeToIso(dateKey: string, time: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const getOffset = (timestamp: number) => {
    const parts = formatter.formatToParts(new Date(timestamp))
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? '0')
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute')) - timestamp
  }
  let timestamp = localAsUtc - getOffset(localAsUtc)
  timestamp = localAsUtc - getOffset(timestamp)
  return new Date(timestamp).toISOString()
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
      <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        d={direction === 'left' ? 'm14.5 5-7 7 7 7' : 'm9.5 5 7 7-7 7'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path d="m4 16.5V20h3.5L18 9.5 14.5 6 4 16.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m13.5 7 3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function TechniciansIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM17 4.2a3.5 3.5 0 0 1 0 6.6M21 20v-1.5a4 4 0 0 0-3-3.86" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function TechnicianAvailabilityButton({
  className = '',
  variant = 'button',
}: {
  className?: string
  variant?: 'button' | 'dashboard-icon'
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {variant === 'dashboard-icon' ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={`dashboard-section-link group relative flex min-h-[112px] min-w-0 flex-col items-center justify-center gap-2.5 overflow-visible rounded-2xl px-2 py-3 text-center text-[#0b1d2c] transition lg:w-[170px] ${className}`}
        >
          <span className="dashboard-section-link__icon relative inline-flex h-[74px] w-[74px] items-center justify-center rounded-[18px] border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.35),0_10px_22px_rgba(9,48,82,0.28)] backdrop-blur-xl transition-all duration-200 ease-out lg:h-[82px] lg:w-[82px] lg:group-hover:-translate-y-[2px]">
            <TechniciansIcon className="h-7 w-7" />
          </span>
          <span className="dashboard-section-link__label text-center text-[13px] font-semibold uppercase tracking-[0.01em] leading-tight lg:text-[15px]">
            POH A VOLNO
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={`technician-availability-trigger relative inline-flex items-center justify-center overflow-hidden rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_26px_rgba(9,48,82,0.32)] transition duration-200 ease-out before:pointer-events-none before:absolute before:left-3 before:right-3 before:top-0 before:h-px before:rounded-full before:bg-[#aad9f7]/45 before:content-[''] hover:-translate-y-[1px] hover:border-[#1f5f8e] hover:bg-[linear-gradient(160deg,rgba(56,125,177,0.95)_0%,rgba(37,109,163,0.96)_45%,rgba(22,86,138,0.98)_100%)] ${className}`}
        >
          TECHNICI
        </button>
      )}

      {isOpen ? <TechnicianAvailabilityModal onClose={() => setIsOpen(false)} /> : null}
    </>
  )
}

function TechnicianAvailabilityModal({ onClose: closeImmediately }: { onClose: () => void }) {
  const onClose = useModalMotionClose(closeImmediately)
  const [data, setData] = useState<TechnicianAvailabilityData | null>(null)
  const [selectedFriday, setSelectedFriday] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingDate, setEditingDate] = useState<string | null>(null)
  const [editingUnavailabilityId, setEditingUnavailabilityId] = useState<string | 'new' | null>(null)
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'unavailability'; id: string; technicianName: string; timeRange: string }
    | { kind: 'on-call'; weekendDate: string; technicianName: string; timeRange: string }
    | null
  >(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useBodyScrollLock(true)

  const loadData = async (friday?: string | null) => {
    const isInitialLoad = !data
    if (isInitialLoad) setIsLoading(true)
    else setIsRefreshing(true)
    const result = await getTechnicianAvailabilityDataAction(friday)
    if (!result.success) {
      setError(result.error)
      if (isInitialLoad) setIsLoading(false)
      else setIsRefreshing(false)
      return
    }
    setData(result.data)
    setSelectedFriday(result.data.selectedFriday)
    setError(null)
    if (isInitialLoad) setIsLoading(false)
    else setIsRefreshing(false)
  }

  useEffect(() => {
    void loadData(selectedFriday)
    // The selected value is intentionally the modal's single source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFriday])

  const entriesByDate = useMemo(() => {
    const grouped = new Map<string, string[]>()
    if (!data) return grouped
    for (const entry of data.weekendOnCall) {
      if (entry.isHistorical && !data.selectedWeekendDates.includes(entry.weekend_date)) continue
      const values = grouped.get(entry.weekend_date) ?? []
      values.push(entry.technician_id)
      grouped.set(entry.weekend_date, values)
    }
    return grouped
  }, [data])

  const technicianNameById = useMemo(
    () => new Map((data?.technicians ?? []).map((technician) => [technician.id, technician.name])),
    [data]
  )

  async function saveDay(date: string, technicianIds: string[]) {
    const result = await saveWeekendOnCallAction({ weekendDate: date, technicianIds })
    if (!result.success) {
      setError(result.error)
      return false
    }

    if (data && date === data.selectedWeekendDates[0] && technicianIds.length > 0) {
      const datesToCopy = data.selectedWeekendDates.slice(1).filter((day) => (entriesByDate.get(day) ?? []).length === 0)
      for (const day of datesToCopy) {
        const copied = await saveWeekendOnCallAction({ weekendDate: day, technicianIds })
        if (!copied.success) {
          setError(copied.error)
          return false
        }
      }
    }

    setEditingDate(null)
    await loadData(data?.selectedFriday ?? selectedFriday)
    return true
  }

  async function saveUnavailability(input: {
    id?: string | null
    technicianId: string
    startsAt: string
    endsAt: string
  }) {
    const result = await saveTechnicianUnavailabilityAction(input)
    if (!result.success) {
      setError(result.error)
      return false
    }
    setEditingUnavailabilityId(null)
    await loadData(data?.selectedFriday ?? selectedFriday)
    return true
  }

  async function deleteUnavailability(id: string) {
    const result = await deleteTechnicianUnavailabilityAction(id)
    if (!result.success) {
      setError(result.error)
      return false
    }
    await loadData(data?.selectedFriday ?? selectedFriday)
    return true
  }

  async function deleteWeekendOnCall(weekendDate: string) {
    const result = await saveWeekendOnCallAction({ weekendDate, technicianIds: [] })
    if (!result.success) {
      setError(result.error)
      return false
    }
    await loadData(data?.selectedFriday ?? selectedFriday)
    return true
  }

  const selectedWeekendUnavailability = data
    ? data.unavailability
        .filter((entry) => !entry.isHistorical)
        .filter((entry) => entry.starts_at <= pragueDateTimeToIso(data.selectedWeekendDates[2], '23:59') && entry.ends_at >= pragueDateTimeToIso(data.selectedWeekendDates[0], '00:00'))
        .sort((left, right) => left.starts_at.localeCompare(right.starts_at))
    : []
  const otherActiveUnavailability = data
    ? data.unavailability
        .filter((entry) => !entry.isHistorical)
        .filter((entry) => entry.starts_at > pragueDateTimeToIso(data.selectedWeekendDates[2], '23:59') || entry.ends_at < pragueDateTimeToIso(data.selectedWeekendDates[0], '00:00'))
        .sort((left, right) => left.starts_at.localeCompare(right.starts_at))
    : []
  const unavailabilityHistory = data
    ? data.unavailability
        .filter((entry) => entry.isHistorical)
        .sort((left, right) => right.ends_at.localeCompare(left.ends_at))
    : []
  const canCreateOwnUnavailability = Boolean(data?.canManage || data?.isTechnician)
  const canEditUnavailability = (entry: { technician_id: string; isHistorical: boolean }) =>
    (!entry.isHistorical || Boolean(data?.isAdmin)) &&
    (Boolean(data?.canManage) || entry.technician_id === data?.currentUserId)

  const modalContent = (
    <div data-modal-motion-root className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-[2px] sm:p-6" role="dialog" aria-modal="true" aria-labelledby="technician-availability-title">
      <div data-modal-motion-surface className="jobs-page__modal-shell technician-availability-modal flex h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(244,248,252,0.95)_52%,rgba(233,242,249,0.92)_100%)] shadow-[0_28px_70px_rgba(15,23,42,0.28)] sm:h-[min(760px,calc(100dvh-3rem))]">
        <header className="jobs-page__modal-header flex items-start justify-between gap-4 border-b border-white/80 px-5 py-5 sm:px-7 sm:py-6">
          <ModalHeading section="ZAKÁZKY" title="POHOTOVOST A DOSTUPNOST" id="technician-availability-title" />
          <button type="button" onClick={onClose} aria-label="Zavřít" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/85 bg-white/85 text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_7px_16px_rgba(15,23,42,0.08)] transition hover:-translate-y-[1px] hover:text-slate-900">
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {isLoading || !data ? (
            <div className="technician-availability-loading rounded-2xl border border-white/80 bg-white/70 px-5 py-10 text-center text-sm text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">Načítám pohotovosti techniků…</div>
          ) : (
            <div className={`grid gap-5 transition-opacity duration-150 lg:h-full lg:min-h-0 lg:grid-cols-2 ${isRefreshing ? 'pointer-events-none opacity-60' : ''}`}>
              <section className="technician-availability-panel rounded-[24px] border border-white/85 bg-white/72 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_12px_28px_rgba(15,23,42,0.07)] sm:p-5 lg:flex lg:min-h-0 lg:flex-col">
                <div className="min-h-0 lg:flex lg:flex-col">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4a84ae]">Pohotovosti techniků</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">Víkendová služba</h3>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {isRefreshing ? <span aria-label="Načítám" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#6da7cd] border-t-transparent" /> : <span className="inline-block h-3 w-3" aria-hidden="true" />}
                    <div className="technician-availability-weekend-picker inline-flex items-center gap-1 rounded-xl border border-[#c8ddec] bg-[#edf6fc]/85 p-1 text-xs font-semibold text-[#316f9e]">
                      <button type="button" disabled={isRefreshing} onClick={() => setSelectedFriday(addDays(data.selectedFriday, -7))} className="inline-flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-white disabled:cursor-wait disabled:opacity-45" aria-label="Předchozí víkend"><ArrowIcon direction="left" /></button>
                      <span className="inline-flex min-w-[142px] items-center justify-center px-1 text-center">{formatWeekend(data.selectedFriday)}</span>
                      <button type="button" disabled={isRefreshing} onClick={() => setSelectedFriday(addDays(data.selectedFriday, 7))} className="inline-flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-white disabled:cursor-wait disabled:opacity-45" aria-label="Další víkend"><ArrowIcon direction="right" /></button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                  {data.selectedWeekendDates.map((date, index) => {
                    const dayKey = (['friday', 'saturday', 'sunday'] as DayKey[])[index]
                    const technicianIds = entriesByDate.get(date) ?? []
                    const canEdit = data.canManage && (!isWeekendOnCallHistoricalClient(date) || data.isAdmin)
                    return (
                      <div key={date} className="technician-availability-day-card rounded-2xl border border-[#d2e3f0] bg-[linear-gradient(155deg,rgba(249,252,254,0.95)_0%,rgba(239,247,252,0.86)_100%)] px-3.5 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="grid min-w-0 flex-1 grid-cols-[105px_minmax(0,1fr)] items-center gap-x-1">
                            <p className="text-sm font-semibold text-slate-900">{DAY_LABELS[dayKey]} {formatDayAndMonth(date)}</p>
                            <p className={`truncate text-sm ${technicianIds.length > 0 ? 'font-semibold text-[#236f9f]' : 'text-slate-600'}`}>{technicianIds.length > 0 ? technicianIds.map((id) => technicianNameById.get(id) ?? 'Technik').join(', ') : 'Neurčeno.'}</p>
                          </div>
                          {canEdit ? <button type="button" onClick={() => setEditingDate(date)} className="technician-availability-icon-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#bcd7ea] bg-white/85 text-[#3d7eab] transition hover:-translate-y-[1px] hover:bg-[#eff8fd]" aria-label={`Upravit pohotovost pro ${DAY_LABELS[dayKey]}`}><PencilIcon /></button> : null}
                        </div>
                        {editingDate === date ? <DayEditor technicians={data.technicians} selectedIds={technicianIds} onCancel={() => setEditingDate(null)} onSave={(ids) => saveDay(date, ids)} /> : null}
                      </div>
                    )
                  })}
                </div>

                </div>
              </section>

              <section className="technician-availability-panel rounded-[24px] border border-white/85 bg-white/72 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_12px_28px_rgba(15,23,42,0.07)] sm:p-5 lg:grid lg:min-h-0 lg:grid-rows-[2fr_1fr]">
                <div className="min-h-0 lg:flex lg:flex-col">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4a84ae]">Dostupnost techniků</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">Nedostupnost</h3>
                  </div>
                  {canCreateOwnUnavailability ? <button type="button" onClick={() => setEditingUnavailabilityId('new')} className="technician-availability-primary-button rounded-xl border border-[#2f78aa] bg-[#377fb4] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_7px_16px_rgba(15,86,129,0.2)] transition hover:-translate-y-[1px] hover:bg-[#2e73a6]">Přidat volno</button> : null}
                </div>
                {data.isTechnician && !data.canManage ? <p className="mt-1 text-sm text-slate-500">Můžeš nahlásit pouze vlastní nedostupnost.</p> : null}

                {editingUnavailabilityId === 'new' ? <UnavailabilityEditor technicians={data.technicians} currentUserId={data.currentUserId} canManage={data.canManage} onCancel={() => setEditingUnavailabilityId(null)} onSave={saveUnavailability} /> : null}

                <div className="mt-4 space-y-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                  {selectedWeekendUnavailability.length === 0 ? <div className="technician-availability-empty rounded-2xl border border-dashed border-[#c8ddec] bg-[#f4f9fc]/75 px-4 py-6 text-center text-sm text-slate-500">Není evidována žádná aktuální nedostupnost.</div> : selectedWeekendUnavailability.map((entry) => {
                    const canEdit = canEditUnavailability(entry)
                    const technicianName = technicianNameById.get(entry.technician_id) ?? 'Technik'
                    return <div key={entry.id} className="technician-availability-unavailability-card rounded-2xl border border-[#d2e3f0] bg-[linear-gradient(155deg,rgba(249,252,254,0.95)_0%,rgba(239,247,252,0.86)_100%)] px-3.5 py-3">
                      {editingUnavailabilityId === entry.id ? <UnavailabilityEditor entry={entry} technicians={data.technicians} currentUserId={data.currentUserId} canManage={data.canManage} onCancel={() => setEditingUnavailabilityId(null)} onSave={saveUnavailability} /> : <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{technicianName}</p><p className="mt-1 text-sm text-slate-600">{formatDateTimeRange(entry.starts_at, entry.ends_at)}</p></div>{canEdit ? <div className="flex gap-1.5"><button type="button" onClick={() => setEditingUnavailabilityId(entry.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[#bcd7ea] bg-white/85 text-[#3d7eab] transition hover:-translate-y-[1px] hover:bg-[#eff8fd]" aria-label={`Upravit nedostupnost: ${technicianName}`}><PencilIcon /></button><button type="button" onClick={() => setPendingDelete({ kind: 'unavailability', id: entry.id, technicianName, timeRange: formatDateTimeRange(entry.starts_at, entry.ends_at) })} className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-red-200 bg-white/85 text-red-500 transition hover:-translate-y-[1px] hover:bg-red-50" aria-label={`Smazat nedostupnost: ${technicianName}`}>×</button></div> : null}</div>}
                    </div>
                  })}
                </div>

                {otherActiveUnavailability.length > 0 ? <div className="mt-4 border-t border-[#d5e4ef] pt-4"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Další plánovaná nedostupnost</p><div className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1">{otherActiveUnavailability.map((entry) => {
                  const canEdit = canEditUnavailability(entry)
                  const technicianName = technicianNameById.get(entry.technician_id) ?? 'Technik'
                  return <div key={entry.id} className="technician-availability-unavailability-card flex items-start justify-between gap-3 rounded-xl border border-[#d9e7f0] bg-white/65 px-3 py-2.5 text-sm text-slate-600">{editingUnavailabilityId === entry.id ? <UnavailabilityEditor entry={entry} technicians={data.technicians} currentUserId={data.currentUserId} canManage={data.canManage} onCancel={() => setEditingUnavailabilityId(null)} onSave={saveUnavailability} /> : <><div><p className="font-medium text-slate-700">{technicianName}</p><p className="mt-0.5 text-xs text-slate-500">{formatDateTimeRange(entry.starts_at, entry.ends_at)}</p></div>{canEdit ? <div className="flex gap-1.5"><button type="button" onClick={() => setEditingUnavailabilityId(entry.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#c7ddea] bg-white/85 text-[#3d7eab] transition hover:text-[#236f9f]" aria-label={`Upravit nedostupnost: ${technicianName}`}><PencilIcon /></button><button type="button" onClick={() => setPendingDelete({ kind: 'unavailability', id: entry.id, technicianName, timeRange: formatDateTimeRange(entry.starts_at, entry.ends_at) })} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-200 bg-white/85 text-red-500 transition hover:bg-red-50" aria-label={`Smazat nedostupnost: ${technicianName}`}>×</button></div> : null}</>}</div>
                })}</div></div> : null}
                </div>

                <div className="mt-5 border-t border-[#d5e4ef] pt-4 lg:mt-0 lg:flex lg:min-h-0 lg:flex-col">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Historie nedostupnosti</p>
                  <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:min-h-0 lg:flex-1">
                    {unavailabilityHistory.length === 0 ? <p className="technician-availability-empty rounded-xl border border-dashed border-slate-200 px-3 py-3 text-sm text-slate-400">Zatím žádná historie.</p> : unavailabilityHistory.map((entry) => {
                      const technicianName = technicianNameById.get(entry.technician_id) ?? 'Technik'
                      return <div key={entry.id} className="technician-availability-history-record rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-400">{editingUnavailabilityId === entry.id ? <UnavailabilityEditor entry={entry} technicians={data.technicians} currentUserId={data.currentUserId} canManage={data.canManage} onCancel={() => setEditingUnavailabilityId(null)} onSave={saveUnavailability} /> : <div className="flex items-start justify-between gap-3"><div><p>{technicianName}</p><p className="mt-0.5 text-xs">{formatDateTimeRange(entry.starts_at, entry.ends_at)}</p></div>{data.isAdmin ? <div className="flex gap-1"><button type="button" onClick={() => setEditingUnavailabilityId(entry.id)} className="technician-availability-icon-button inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white/75 text-slate-400 transition hover:text-[#3d7eab]" aria-label={`Upravit historii nedostupnosti: ${technicianName}`}><PencilIcon /></button><button type="button" onClick={() => setPendingDelete({ kind: 'unavailability', id: entry.id, technicianName, timeRange: formatDateTimeRange(entry.starts_at, entry.ends_at) })} className="technician-availability-icon-button inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white/75 text-slate-400 transition hover:text-red-500" aria-label={`Smazat historii nedostupnosti: ${technicianName}`}>×</button></div> : null}</div>}</div>
                    })}
                  </div>
                </div>
              </section>
            </div>
          )}
          {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div> : null}
        </div>
        {pendingDelete ? <DeleteUnavailabilityConfirmation
          title={pendingDelete.kind === 'on-call' ? 'Smazat pohotovost' : 'Smazat nedostupnost'}
          technicianName={pendingDelete.technicianName}
          timeRange={pendingDelete.timeRange}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            const success = pendingDelete.kind === 'on-call'
              ? await deleteWeekendOnCall(pendingDelete.weekendDate)
              : await deleteUnavailability(pendingDelete.id)
            if (success) setPendingDelete(null)
            return success
          }}
        /> : null}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modalContent, document.body)
}

function isWeekendOnCallHistoricalClient(dateKey: string) {
  const monday = addDays(dateKey, 3)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  const nowDate = `${part('year')}-${part('month')}-${part('day')}`
  const nowMinutes = Number(part('hour')) * 60 + Number(part('minute'))
  return nowDate > monday || (nowDate === monday && nowMinutes >= 6 * 60)
}

function DayEditor({ technicians, selectedIds, onCancel, onSave }: { technicians: TechnicianOption[]; selectedIds: string[]; onCancel: () => void; onSave: (ids: string[]) => Promise<boolean> }) {
  const [selected, setSelected] = useState(selectedIds)
  const [query, setQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const selectedSet = new Set(selected)
  const matches = technicians.filter((technician) => !selectedSet.has(technician.id) && technician.name.toLocaleLowerCase('cs-CZ').includes(query.toLocaleLowerCase('cs-CZ')))

  async function save() {
    setIsSaving(true)
    const success = await onSave(selected)
    if (!success) setIsSaving(false)
  }

  return (
    <div className="technician-availability-day-editor mt-2 border-t border-[#d8e7f1] pt-2">
      <div className="flex flex-wrap gap-1">{selected.map((id) => { const technician = technicians.find((item) => item.id === id); return <button key={id} type="button" onClick={() => setSelected((current) => current.filter((item) => item !== id))} className="rounded-lg border border-[#9fc7e2] bg-[#eaf5fc] px-2 py-0.5 text-xs font-medium text-[#276f9f] transition hover:bg-[#dceef9]">{technician?.name ?? 'Technik'} ×</button> })}</div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Přidat technika" className="mt-1.5 h-8 w-full rounded-xl border border-[#c8ddec] bg-white/90 px-2.5 text-sm text-slate-900 outline-none transition focus:border-[#82b4d7] focus:ring-2 focus:ring-[#d8ecf9]" />
      {query.trim() && matches.length > 0 ? <div className="mt-1 max-h-20 overflow-y-auto rounded-xl border border-[#d6e5ef] bg-white p-1">{matches.map((technician) => <button key={technician.id} type="button" onClick={() => { setSelected((current) => [...current, technician.id]); setQuery('') }} className="block w-full rounded-lg px-2 py-1 text-left text-sm text-slate-700 transition hover:bg-[#eef7fc]">{technician.name}</button>)}</div> : null}
      <div className="mt-2 flex justify-end gap-1.5"><button type="button" onClick={onCancel} disabled={isSaving} className="rounded-xl border border-[#cbdce9] bg-white/85 px-2.5 py-1.5 text-[11px] font-semibold uppercase text-slate-600 transition hover:-translate-y-[1px]">Zrušit</button><button type="button" onClick={() => void save()} disabled={isSaving} className="technician-availability-primary-button rounded-xl border border-[#2f78aa] bg-[#377fb4] px-2.5 py-1.5 text-[11px] font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] transition hover:-translate-y-[1px] hover:bg-[#2e73a6] disabled:cursor-not-allowed disabled:opacity-65">{isSaving ? 'Ukládám…' : 'Uložit'}</button></div>
    </div>
  )
}

function UnavailabilityEditor({
  entry,
  technicians,
  currentUserId,
  canManage,
  onCancel,
  onSave,
}: {
  entry?: { id: string; technician_id: string; starts_at: string; ends_at: string }
  technicians: TechnicianOption[]
  currentUserId: string
  canManage: boolean
  onCancel: () => void
  onSave: (input: { id?: string | null; technicianId: string; startsAt: string; endsAt: string }) => Promise<boolean>
}) {
  const [technicianId, setTechnicianId] = useState(entry?.technician_id ?? currentUserId)
  const [technicianQuery, setTechnicianQuery] = useState(
    technicians.find((technician) => technician.id === (entry?.technician_id ?? currentUserId))?.name ?? ''
  )
  const [startsAt, setStartsAt] = useState(entry ? formatDateTimeInput(entry.starts_at) : '')
  const [endsAt, setEndsAt] = useState(entry ? formatDateTimeInput(entry.ends_at) : '')
  const [isSaving, setIsSaving] = useState(false)
  const selectedTechnician = technicians.find((technician) => technician.id === technicianId)

  function updateTechnicianQuery(value: string) {
    setTechnicianQuery(value)
    const normalized = value.trim().toLocaleLowerCase('cs-CZ')
    const matches = normalized.length >= 3
      ? technicians.filter((technician) => technician.name.toLocaleLowerCase('cs-CZ').includes(normalized))
      : []

    if (matches.length === 1) {
      setTechnicianId(matches[0].id)
      setTechnicianQuery(matches[0].name)
      return
    }

    setTechnicianId('')
  }

  async function save() {
    setIsSaving(true)
    const success = await onSave({
      id: entry?.id ?? null,
      technicianId,
      startsAt,
      endsAt: endsAt || startsAt,
    })
    if (!success) setIsSaving(false)
  }

  return (
    <div className="technician-availability-editor mt-3 rounded-2xl border border-[#bcd8eb] bg-[#eef7fc]/85 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 sm:col-span-2">
          Technik
          {canManage ? <input value={technicianQuery} onChange={(event) => updateTechnicianQuery(event.target.value)} placeholder="Začni psát jméno technika" className="mt-1.5 h-8 w-full rounded-xl border border-[#c8ddec] bg-white/90 px-2.5 text-sm font-normal normal-case tracking-normal text-slate-900 outline-none transition focus:border-[#82b4d7] focus:ring-2 focus:ring-[#d8ecf9]" /> : <div className="mt-1.5 flex h-8 items-center rounded-xl border border-[#c8ddec] bg-white/70 px-2.5 text-sm font-normal normal-case tracking-normal text-slate-700">{selectedTechnician?.name ?? 'Můj profil'}</div>}
        </label>
        <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
          Od
          <input type="datetime-local" value={startsAt} onChange={(event) => { setStartsAt(event.target.value); if (!endsAt) setEndsAt(event.target.value) }} className="mt-1.5 h-8 w-full rounded-xl border border-[#c8ddec] bg-white/90 px-2 text-sm font-normal normal-case tracking-normal text-slate-900 outline-none transition focus:border-[#82b4d7] focus:ring-2 focus:ring-[#d8ecf9]" />
        </label>
        <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
          Do
          <input type="datetime-local" min={startsAt || undefined} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className="mt-1.5 h-8 w-full rounded-xl border border-[#c8ddec] bg-white/90 px-2 text-sm font-normal normal-case tracking-normal text-slate-900 outline-none transition focus:border-[#82b4d7] focus:ring-2 focus:ring-[#d8ecf9]" />
        </label>
      </div>
      <div className="mt-2 flex justify-end gap-1.5"><button type="button" onClick={onCancel} disabled={isSaving} className="rounded-xl border border-[#cbdce9] bg-white/85 px-2.5 py-1.5 text-[11px] font-semibold uppercase text-slate-600 transition hover:-translate-y-[1px]">Zrušit</button><button type="button" onClick={() => void save()} disabled={isSaving || !technicianId || !startsAt || !endsAt} className="technician-availability-primary-button rounded-xl border border-[#2f78aa] bg-[#377fb4] px-2.5 py-1.5 text-[11px] font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] transition hover:-translate-y-[1px] hover:bg-[#2e73a6] disabled:cursor-not-allowed disabled:opacity-65">{isSaving ? 'Ukládám…' : 'Uložit'}</button></div>
    </div>
  )
}

function DeleteUnavailabilityConfirmation({
  title,
  technicianName,
  timeRange,
  onCancel,
  onConfirm,
}: {
  title: string
  technicianName: string
  timeRange: string
  onCancel: () => void
  onConfirm: () => Promise<boolean>
}) {
  const [isDeleting, setIsDeleting] = useState(false)

  async function confirm() {
    setIsDeleting(true)
    const success = await onConfirm()
    if (!success) setIsDeleting(false)
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[1px]">
      <div className="technician-availability-confirm w-full max-w-sm rounded-[24px] border border-white/85 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(244,248,252,0.96)_100%)] p-5 text-center shadow-[0_22px_50px_rgba(15,23,42,0.25)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-red-500">{title}</p>
        <h3 className="mt-2 text-lg font-semibold text-slate-900">Opravdu chceš záznam smazat?</h3>
        <p className="mt-2 text-sm text-slate-600"><span className="font-medium">{technicianName}</span><br />{timeRange}</p>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button type="button" onClick={onCancel} disabled={isDeleting} className="rounded-xl border border-[#cbdce9] bg-white/85 px-3 py-2.5 text-xs font-semibold uppercase text-slate-600 transition hover:-translate-y-[1px]">Zrušit</button>
          <button type="button" onClick={() => void confirm()} disabled={isDeleting} className="rounded-xl border border-red-500 bg-red-500 px-3 py-2.5 text-xs font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] transition hover:-translate-y-[1px] hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-65">{isDeleting ? 'Mažu…' : 'Smazat'}</button>
        </div>
      </div>
    </div>
  )
}
