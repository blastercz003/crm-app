'use client'

import { useCallback, useEffect, useState } from 'react'
import { requestModalMotionClose } from '@/components/ui/modal-motion'
import type {
  OperationalProtocolDraftInput,
  OperationalProtocolListItem,
} from '@/lib/operational-protocols/types'
import {
  deleteOperationalProtocolAction,
  getOperationalProtocolDetailAction,
  getOperationalProtocolPdfUrlAction,
  listOperationalProtocolsAction,
} from './operational-protocol-actions'

const PAGE_SIZE = 30
const PRAGUE_TIME_ZONE = 'Europe/Prague'
const INPUT_CLASS =
  "block h-10 w-full min-w-0 max-w-full rounded-2xl border border-zinc-200 bg-white/92 px-3 text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_7px_18px_rgba(15,23,42,0.07)] outline-none transition placeholder:text-zinc-400 focus:border-[#8dbfe0] focus:ring-2 focus:ring-[#b9d8ef]/75 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.17)] [html[data-theme='dark']_&]:bg-[rgba(10,20,35,0.9)] [html[data-theme='dark']_&]:text-slate-100 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_8px_20px_rgba(0,0,0,0.2)] [html[data-theme='dark']_&]:placeholder:text-slate-600 [html[data-theme='dark']_&:focus]:border-[rgba(82,166,224,0.5)] [html[data-theme='dark']_&:focus]:ring-[rgba(51,126,178,0.24)]"

function formatRealizationDateTime(value: string) {
  const date = new Date(value)
  const datePart = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
  }).format(date)
  const timePart = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  return `${datePart} ${timePart}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatRange(startAt: string, endAt: string) {
  return `${formatRealizationDateTime(startAt)} – ${formatRealizationDateTime(endAt)}`
}

function toDateTimeInput(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export function OperationalProtocolArchive({
  onCopy,
}: {
  onCopy: (draft: OperationalProtocolDraftInput) => void
}) {
  const [items, setItems] = useState<OperationalProtocolListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [queryInput, setQueryInput] = useState('')
  const [dateFromInput, setDateFromInput] = useState('')
  const [dateToInput, setDateToInput] = useState('')
  const [filters, setFilters] = useState({ query: '', dateFrom: '', dateTo: '' })
  const [isLoading, setIsLoading] = useState(true)
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [message, setMessage] = useState<
    { kind: 'error' | 'success'; text: string } | null
  >(null)
  const [deleteTarget, setDeleteTarget] = useState<OperationalProtocolListItem | null>(null)

  const loadProtocols = useCallback(async () => {
    setIsLoading(true)
    setMessage(null)
    const result = await listOperationalProtocolsAction({
      query: filters.query,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      page,
      pageSize: PAGE_SIZE,
    })

    if (!result.success) {
      setItems([])
      setTotal(0)
      setMessage({ kind: 'error', text: result.error })
      setIsLoading(false)
      return
    }

    setItems(result.data.items)
    setTotal(result.data.total)
    setIsLoading(false)
  }, [filters, page])

  useEffect(() => {
    void loadProtocols()
  }, [loadProtocols])

  function applyFilters() {
    setPage(1)
    setFilters({
      query: queryInput.trim(),
      dateFrom: dateFromInput,
      dateTo: dateToInput,
    })
  }

  function resetFilters() {
    setQueryInput('')
    setDateFromInput('')
    setDateToInput('')
    setPage(1)
    setFilters({ query: '', dateFrom: '', dateTo: '' })
  }

  async function downloadProtocol(item: OperationalProtocolListItem) {
    const actionKey = `download:${item.id}`
    setActiveAction(actionKey)
    setMessage(null)
    try {
      const result = await getOperationalProtocolPdfUrlAction(item.id, true)
      if (!result.success) {
        setMessage({ kind: 'error', text: result.error })
        return
      }

      const link = document.createElement('a')
      link.href = result.data.signedUrl
      link.download = item.pdfFileName
      link.rel = 'noreferrer'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      setMessage({
        kind: 'error',
        text: 'PDF se nepodařilo stáhnout. Zkus akci opakovat.',
      })
    } finally {
      setActiveAction(null)
    }
  }

  async function copyProtocol(item: OperationalProtocolListItem) {
    const actionKey = `copy:${item.id}`
    setActiveAction(actionKey)
    setMessage(null)
    try {
      const result = await getOperationalProtocolDetailAction(item.id)
      if (!result.success) {
        setMessage({ kind: 'error', text: result.error })
        return
      }

      const protocol = result.data
      onCopy({
        copiedFromProtocolId: protocol.id,
        jobNumber: '',
        jobTitle: protocol.jobTitle,
        realizationStartAt: toDateTimeInput(protocol.realizationStartAt),
        realizationEndAt: toDateTimeInput(protocol.realizationEndAt),
        handoverPlace: protocol.handoverPlace,
        sourceClientId: protocol.sourceClientId,
        clientName: protocol.clientName,
        clientAddress: protocol.clientAddress ?? '',
        clientIco: protocol.clientIco ?? '',
        clientContactPerson: protocol.clientContactPerson ?? '',
        clientContactPhone: protocol.clientContactPhone ?? '',
        subtenantChoice: protocol.subtenantChoice,
        subtenantName: protocol.subtenantName ?? '',
        subtenantNote: protocol.subtenantNote ?? '',
        realizationAt: toDateTimeInput(protocol.realizationAt),
        realizationCompletedAt: toDateTimeInput(protocol.realizationCompletedAt),
        technicianName: protocol.technicianName,
        devices:
          protocol.devices.length > 0
            ? protocol.devices.map((device) => ({
                deviceName: device.deviceName,
                mthStart: device.mthStart ?? '',
                mthEnd: device.mthEnd ?? '',
                fuelStartPercent:
                  device.fuelStartPercent === null ? '' : String(device.fuelStartPercent),
                fuelEndPercent:
                  device.fuelEndPercent === null ? '' : String(device.fuelEndPercent),
              }))
            : [
                {
                  deviceName: '',
                  mthStart: '',
                  mthEnd: '',
                  fuelStartPercent: '',
                  fuelEndPercent: '',
                },
              ],
        accessories:
          protocol.accessories.length > 0
            ? protocol.accessories.map((accessory) => ({ itemName: accessory.itemName }))
            : [{ itemName: '' }],
      })
    } catch {
      setMessage({
        kind: 'error',
        text: 'Kopii protokolu se nepodařilo připravit.',
      })
    } finally {
      setActiveAction(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return

    const target = deleteTarget
    setActiveAction(`delete:${target.id}`)
    setMessage(null)
    try {
      const result = await deleteOperationalProtocolAction(target.id)
      if (!result.success) {
        setMessage({ kind: 'error', text: result.error })
        return
      }

      setDeleteTarget(null)
      if (items.length === 1 && page > 1) {
        setPage((current) => current - 1)
      } else {
        await loadProtocols()
      }
      setMessage({
        kind: 'success',
        text: result.warning ?? 'Protokol byl odstraněn.',
      })
    } catch {
      setMessage({
        kind: 'error',
        text: 'Protokol se nepodařilo odstranit. Zkus akci opakovat.',
      })
    } finally {
      setActiveAction(null)
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-3.5">
      <section className="rounded-[24px] border border-white/80 bg-white/72 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] sm:p-4 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px_auto]">
          <label className="min-w-0">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
              Hledat
            </span>
            <input
              type="search"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilters()
              }}
              placeholder="Číslo, název zakázky nebo firma"
              className={INPUT_CLASS}
            />
          </label>

          <label className="min-w-0">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
              Realizace od
            </span>
            <div className="min-w-0 overflow-hidden rounded-2xl">
              <input
                type="date"
                value={dateFromInput}
                onChange={(event) => setDateFromInput(event.target.value)}
                className={`${INPUT_CLASS} filter-date-input`}
              />
            </div>
          </label>

          <label className="min-w-0">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
              Realizace do
            </span>
            <div className="min-w-0 overflow-hidden rounded-2xl">
              <input
                type="date"
                value={dateToInput}
                onChange={(event) => setDateToInput(event.target.value)}
                className={`${INPUT_CLASS} filter-date-input`}
              />
            </div>
          </label>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="h-10 flex-1 rounded-2xl bg-zinc-900 px-4 text-[10px] font-semibold tracking-[0.06em] text-white shadow-md transition hover:-translate-y-[1px] [html[data-theme='dark']_&]:bg-[#3b8dc5]"
            >
              POUŽÍT
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="h-10 rounded-2xl border border-zinc-200 bg-white/85 px-3 text-[10px] font-semibold tracking-[0.06em] text-zinc-600 transition hover:-translate-y-[1px] hover:text-zinc-950 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.9)] [html[data-theme='dark']_&]:text-slate-300"
            >
              RESET
            </button>
          </div>
        </div>
      </section>

      <div className="flex min-h-6 items-center justify-between gap-3 px-1" aria-live="polite">
        <p
          className={`text-xs ${
            message?.kind === 'error'
              ? "text-rose-600 [html[data-theme='dark']_&]:text-rose-300"
              : "text-emerald-700 [html[data-theme='dark']_&]:text-emerald-300"
          }`}
        >
          {message?.text ?? ''}
        </p>
        <p className="shrink-0 text-[11px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
          {total} {total === 1 ? 'protokol' : total >= 2 && total <= 4 ? 'protokoly' : 'protokolů'}
        </p>
      </div>

      <section className="overflow-hidden rounded-[24px] border border-white/80 bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
        {isLoading ? (
          <div className="flex min-h-[300px] items-center justify-center gap-3 text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#72add3] border-t-transparent" />
            Načítám uložené protokoly…
          </div>
        ) : items.length === 0 ? (
          <div className="flex min-h-[300px] items-center justify-center px-6 text-center text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
            Žádné uložené protokoly neodpovídají zvoleným filtrům.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200/80 [html[data-theme='dark']_&]:divide-[rgba(148,163,184,0.12)]">
            {items.map((item) => (
              <article
                key={item.id}
                className="grid min-w-0 gap-3 p-3.5 transition hover:bg-white/55 sm:p-4 lg:grid-cols-[minmax(190px,1.15fr)_minmax(170px,1fr)_150px_145px_auto] lg:items-center [html[data-theme='dark']_&]:hover:bg-[rgba(24,39,61,0.38)]"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {item.jobNumber ? (
                      <span className="shrink-0 rounded-lg bg-[#e8f3fa] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-[#2877a9] [html[data-theme='dark']_&]:bg-[rgba(37,91,132,0.42)] [html[data-theme='dark']_&]:text-[#9ed8f7]">
                        {item.jobNumber}
                      </span>
                    ) : null}
                    <h3 className="truncate text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
                      {item.jobTitle}
                    </h3>
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                    {item.clientName}
                  </p>
                </div>

                <div className="min-w-0 text-xs text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
                  <p className="font-medium">{formatRange(item.realizationStartAt, item.realizationEndAt)}</p>
                  <p className="mt-1 truncate text-[11px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
                    {item.handoverPlace}
                  </p>
                </div>

                <div className="text-xs text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
                  <p className="font-medium">{item.technicianName}</p>
                  <p className="mt-1 text-[11px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
                    {item.deviceCount} zař. · {item.accessoryCount} přísl.
                  </p>
                </div>

                <div className="text-[11px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                  <p>{formatDateTime(item.createdAt)}</p>
                  <p className="mt-1 truncate">{item.createdByName || 'Administrátor'}</p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                  <ArchiveActionButton
                    label="TISK"
                    onClick={() =>
                      window.open(
                        `/faktury/provozni-protokoly/${item.id}/tisk`,
                        '_blank',
                        'noopener,noreferrer'
                      )
                    }
                  />
                  <ArchiveActionButton
                    label="PDF"
                    loading={activeAction === `download:${item.id}`}
                    onClick={() => void downloadProtocol(item)}
                  />
                  <ArchiveActionButton
                    label="KOPIE"
                    loading={activeAction === `copy:${item.id}`}
                    onClick={() => void copyProtocol(item)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setMessage(null)
                      setDeleteTarget(item)
                    }}
                    aria-label={`Smazat protokol ${item.jobNumber || item.jobTitle}`}
                    title="Smazat protokol"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-base text-rose-600 transition hover:-translate-y-[1px] hover:bg-rose-100 [html[data-theme='dark']_&]:border-rose-400/20 [html[data-theme='dark']_&]:bg-rose-950/28 [html[data-theme='dark']_&]:text-rose-300"
                  >
                    ×
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {pageCount > 1 ? (
        <nav className="flex items-center justify-center gap-3" aria-label="Stránkování protokolů">
          <button
            type="button"
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="h-9 rounded-xl border border-zinc-200 bg-white/85 px-4 text-[10px] font-semibold text-zinc-600 transition hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-40 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.17)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.86)] [html[data-theme='dark']_&]:text-slate-300"
          >
            PŘEDCHOZÍ
          </button>
          <span className="text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount || isLoading}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            className="h-9 rounded-xl border border-zinc-200 bg-white/85 px-4 text-[10px] font-semibold text-zinc-600 transition hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-40 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.17)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.86)] [html[data-theme='dark']_&]:text-slate-300"
          >
            DALŠÍ
          </button>
        </nav>
      ) : null}

      {deleteTarget ? (
        <div
          data-modal-motion-root
          data-modal-motion-profile="confirmation"
          className="fixed inset-0 z-[180] flex items-center justify-center bg-zinc-950/38 p-4 backdrop-blur-[4px]"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-operational-protocol-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !activeAction) requestModalMotionClose(() => setDeleteTarget(null), 'confirmation')
          }}
        >
          <div className="w-full max-w-[500px] rounded-[28px] border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.99)_0%,rgba(244,248,252,0.98)_100%)] p-5 shadow-[0_30px_74px_rgba(15,23,42,0.34)] sm:p-6 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(15,25,42,0.99)_0%,rgba(8,16,29,0.99)_100%)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-rose-600 [html[data-theme='dark']_&]:text-rose-300">
              ODSTRANĚNÍ PROTOKOLU
            </p>
            <h2
              id="delete-operational-protocol-title"
              className="mt-2 text-xl font-semibold tracking-tight text-zinc-950 [html[data-theme='dark']_&]:text-slate-50"
            >
              Opravdu smazat uložený protokol?
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
              {deleteTarget.jobNumber ? `${deleteTarget.jobNumber} · ` : ''}
              {deleteTarget.jobTitle}. Smaže se záznam i finální PDF a akci nelze vrátit.
            </p>
            {message?.kind === 'error' ? (
              <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 [html[data-theme='dark']_&]:border-rose-400/20 [html[data-theme='dark']_&]:bg-rose-950/30 [html[data-theme='dark']_&]:text-rose-300">
                {message.text}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(activeAction)}
                className="h-11 rounded-2xl border border-zinc-200 bg-white/85 px-5 text-xs font-semibold text-zinc-700 transition hover:-translate-y-[1px] disabled:opacity-50 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.9)] [html[data-theme='dark']_&]:text-slate-200"
              >
                ZRUŠIT
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={Boolean(activeAction)}
                className="inline-flex h-11 min-w-[150px] items-center justify-center gap-2 rounded-2xl border border-rose-600 bg-rose-600 px-5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(225,29,72,0.2)] transition hover:-translate-y-[1px] hover:bg-rose-700 disabled:cursor-wait disabled:translate-y-0 disabled:opacity-65"
              >
                {activeAction === `delete:${deleteTarget.id}` ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/45 border-t-white" />
                ) : null}
                SMAZAT
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ArchiveActionButton({
  label,
  loading = false,
  onClick,
}: {
  label: string
  loading?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex h-9 min-w-[58px] items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white/88 px-2.5 text-[9px] font-semibold tracking-[0.04em] text-zinc-600 transition hover:-translate-y-[1px] hover:text-zinc-950 disabled:cursor-wait disabled:translate-y-0 disabled:opacity-60 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.17)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.86)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&:hover]:text-white"
    >
      {loading ? (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {label}
    </button>
  )
}
