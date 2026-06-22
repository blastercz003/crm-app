'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import {
  deleteAssetRentalAction,
  deleteAssetRentalServiceAdvanceAction,
  upsertAssetRentalAction,
  upsertAssetRentalServiceAdvanceAction,
  type DeleteAssetRentalActionState,
  type DeleteAssetRentalServiceAdvanceActionState,
  type UpdateAssetRentalActionState,
  type UpsertAssetRentalServiceAdvanceActionState,
} from './actions'
import type { RentalServiceAdvanceHistoryRow } from '@/lib/majetek/rental-settlements'
import { MoneyInput } from '@/components/ui/money-input'

export type AssetRentalRow = {
  id: string
  asset_id: string
  tenant_name: string | null
  tenant_contact: string | null
  start_date: string | null
  end_date: string | null
  monthly_rent: string | number | null
  deposit_amount: string | number | null
  note: string | null
  created_at: string
  updated_at: string
}

type AssetRentalSectionProps = {
  assetId: string
  rentals: AssetRentalRow[]
  advanceHistoryByRentalId: Record<string, RentalServiceAdvanceHistoryRow[]>
}

type AssetRentalFormProps = {
  assetId: string
  rental: AssetRentalRow | null
  currentAdvance: RentalServiceAdvanceHistoryRow | null
  submitLabel: string
  onSuccess?: () => void
}

const createInitialState: UpdateAssetRentalActionState = {
  success: false,
  error: null,
}

const deleteInitialState: DeleteAssetRentalActionState = {
  success: false,
  error: null,
}

const advanceCreateInitialState: UpsertAssetRentalServiceAdvanceActionState = {
  success: false,
  error: null,
}

const advanceDeleteInitialState: DeleteAssetRentalServiceAdvanceActionState = {
  success: false,
  error: null,
}

const inputClassName =
  'clients-modal__input w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const textareaClassName =
  'clients-modal__textarea min-h-[120px] w-full resize-y rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const emptyStateClassName =
  'rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-6 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] backdrop-blur-[8px]'

function asDateInput(value: string | null) {
  if (!value) return ''
  return value.slice(0, 10)
}

function asMonthInput(value: string | null) {
  if (!value) return ''
  return value.slice(0, 7)
}

function formatDate(value: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value))
}

function formatCurrency(value: string | number | null) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return '—'

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(parsed)
}

function formatMonthLabel(value: string | null) {
  if (!value) return '—'

  const [year, month] = value.slice(0, 7).split('-')
  if (!year || !month) return value.slice(0, 7)

  return `${month}/${year}`
}

function getRentalStatus(rental: AssetRentalRow, now: Date) {
  const start = rental.start_date ? new Date(rental.start_date) : null
  const end = rental.end_date ? new Date(rental.end_date) : null

  if (start && Number.isNaN(start.getTime())) return 'Neurčeno'
  if (end && Number.isNaN(end.getTime())) return 'Neurčeno'

  if (start && start > now) return 'Budoucí'
  if (start && end && start <= now && end >= now) return 'Aktivní'
  if (start && !end && start <= now) return 'Aktivní'
  if (end && end < now) return 'Ukončený'

  return 'Neurčeno'
}

function getRentalTone(status: string) {
  if (status === 'Aktivní') {
    return 'border border-emerald-200/90 bg-[linear-gradient(155deg,rgba(236,253,245,0.92)_0%,rgba(220,252,231,0.84)_100%)] text-emerald-800'
  }

  if (status === 'Budoucí') {
    return 'border border-sky-200/90 bg-[linear-gradient(155deg,rgba(239,246,255,0.92)_0%,rgba(224,242,254,0.84)_100%)] text-sky-800'
  }

  if (status === 'Ukončený') {
    return 'border border-amber-200/90 bg-[linear-gradient(155deg,rgba(255,247,237,0.92)_0%,rgba(254,243,199,0.84)_100%)] text-amber-800'
  }

  return 'border border-slate-200/90 bg-[linear-gradient(155deg,rgba(248,250,252,0.92)_0%,rgba(241,245,249,0.84)_100%)] text-slate-700'
}

function getLatestRental(records: AssetRentalRow[]) {
  const now = new Date()

  const active = [...records].find((rental) => getRentalStatus(rental, now) === 'Aktivní')
  if (active) return active

  return [...records].sort((left, right) => {
    const leftStart = left.start_date ? new Date(left.start_date).getTime() : 0
    const rightStart = right.start_date ? new Date(right.start_date).getTime() : 0

    if (rightStart !== leftStart) {
      return rightStart - leftStart
    }

    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  })[0] ?? null
}

function RentalStat({
  title,
  value,
  note,
}: {
  title: string
  value: string
  note?: string
}) {
  return (
    <div className="assets-detail-page__rental-stat rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{title}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-gray-500">{note}</p> : null}
    </div>
  )
}

function RentalAccordionItem({
  assetId,
  rental,
  advanceHistory,
}: {
  assetId: string
  rental: AssetRentalRow
  advanceHistory: RentalServiceAdvanceHistoryRow[]
}) {
  const status = getRentalStatus(rental, new Date())
  const summary = [rental.tenant_contact].filter(Boolean).join(' • ')
  const currentAdvance = advanceHistory[0] ?? null
  const historicalAdvances = currentAdvance
    ? advanceHistory.filter((advance) => advance.id !== currentAdvance.id)
    : advanceHistory

  return (
    <details className="assets-detail-page__rental-item group rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{rental.tenant_name || 'Nezadáno'}</p>
          <p className="mt-1 truncate text-xs text-gray-500">{summary || 'Bez doplňujících údajů'}</p>
        </div>

        <div className="flex items-center gap-3 text-right">
          <div className="hidden sm:block">
            <p className="text-xs text-gray-500">Nájem</p>
            <p className="text-sm font-medium text-gray-900">{formatCurrency(rental.monthly_rent)}</p>
          </div>
          <div className="hidden lg:block">
            <p className="text-xs text-gray-500">Stav</p>
            <span className={`assets-detail-page__rental-status-pill inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${getRentalTone(status)}`}>
              {status}
            </span>
          </div>
          <span className="assets-detail-page__rental-chevron inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/75 bg-white/70 text-gray-500 transition group-open:rotate-180">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </summary>

      <div className="assets-detail-page__rental-panel border-t border-white/70 px-5 py-5">
        <AssetRentalForm
          key={`${rental.id}-${rental.updated_at}`}
          assetId={assetId}
          rental={rental}
          currentAdvance={currentAdvance}
          submitLabel="ULOŽIT ZMĚNY"
        />

        <section className="mt-5 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(241,245,249,0.86)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Historie záloh na služby</h4>
              <p className="text-xs text-gray-500">
                Aktualizace aktuální zálohy je nahoře v kartě. Tady zůstává starší historie pro kontrolu a úpravy.
              </p>
            </div>
            <p className="text-xs font-medium text-gray-500">
              {historicalAdvances.length} starších záznamů
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {historicalAdvances.length > 0 ? (
              historicalAdvances.map((advance) => (
                <RentalAdvanceAccordionItem
                  key={advance.id}
                  rentalId={rental.id}
                  advance={advance}
                />
              ))
            ) : (
              <div className={emptyStateClassName}>
                {currentAdvance ? 'Aktuální záloha je upravitelná nahoře v kartě.' : 'Zatím není uložená žádná záloha na služby.'}
              </div>
            )}
          </div>
        </section>

        <div className="mt-4 flex justify-end">
          <AssetRentalDeleteButton assetId={assetId} rentalId={rental.id} />
        </div>
      </div>
    </details>
  )
}

function RentalAdvanceAccordionItem({
  rentalId,
  advance,
}: {
  rentalId: string
  advance: RentalServiceAdvanceHistoryRow
}) {
  return (
    <details className="group rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(241,245,249,0.82)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{formatMonthLabel(advance.effective_from)}</p>
          <p className="mt-1 truncate text-xs text-gray-500">
            {formatCurrency(advance.monthly_advance)}
            {advance.note ? ` • ${advance.note}` : ''}
          </p>
        </div>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/75 bg-white/70 text-gray-500 transition group-open:rotate-180">
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>

      <div className="border-t border-white/70 px-4 py-4">
        <RentalAdvanceForm
          key={`${advance.id}-${advance.updated_at ?? advance.created_at ?? advance.id}`}
          rentalId={rentalId}
          advance={advance}
          submitLabel="ULOŽIT ZMĚNY"
        />
        <div className="mt-3 flex justify-end">
          <RentalAdvanceDeleteButton rentalId={rentalId} advanceId={advance.id} />
        </div>
      </div>
    </details>
  )
}

function RentalAdvanceDeleteButton({
  rentalId,
  advanceId,
}: {
  rentalId: string
  advanceId: string
}) {
  const router = useRouter()
  const [isConfirming, setIsConfirming] = useState(false)
  const [state, formAction] = useActionState(deleteAssetRentalServiceAdvanceAction, advanceDeleteInitialState)

  useEffect(() => {
    if (!state.success) return

    router.refresh()
  }, [router, state.success])

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="rental_id" value={rentalId} />
      <input type="hidden" name="advance_id" value={advanceId} />

      {isConfirming ? (
        <>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition duration-200 hover:-translate-y-[1px] hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
          >
            Smazat
          </button>
          <button
            type="button"
            onClick={() => setIsConfirming(false)}
            className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition duration-200 hover:-translate-y-[1px] hover:text-gray-900"
          >
            Zrušit
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setIsConfirming(true)}
          className="inline-flex items-center justify-center rounded-2xl border border-white/75 bg-white/80 px-3 py-2 text-xs font-medium text-red-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-red-700"
          aria-label="Smazat zálohu"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
    </form>
  )
}

function RentalAdvanceForm({
  rentalId,
  advance,
  submitLabel,
  onSuccess,
}: {
  rentalId: string
  advance: RentalServiceAdvanceHistoryRow | null
  submitLabel: string
  onSuccess?: () => void
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement | null>(null)
  const [state, formAction] = useActionState(upsertAssetRentalServiceAdvanceAction, advanceCreateInitialState)
  const isEdit = Boolean(advance?.id)

  useEffect(() => {
    if (!state.success) return

    router.refresh()

    if (!isEdit) {
      formRef.current?.reset()
    }
    onSuccess?.()
  }, [isEdit, onSuccess, router, state.success])

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="rental_id" value={rentalId} />
      {advance?.id ? <input type="hidden" name="advance_id" value={advance.id} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={`advance-from-${rentalId}-${advance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Platí od *
          </label>
          <input
            id={`advance-from-${rentalId}-${advance?.id ?? 'new'}`}
            name="effective_from"
            type="month"
            required
            placeholder="YYYY-MM"
            defaultValue={asMonthInput(advance?.effective_from ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`advance-amount-${rentalId}-${advance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Záloha na služby *
          </label>
          <MoneyInput
            id={`advance-amount-${rentalId}-${advance?.id ?? 'new'}`}
            name="monthly_advance"
            required
            defaultValue={advance?.monthly_advance ?? null}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label htmlFor={`advance-note-${rentalId}-${advance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Poznámka
          </label>
          <input
            id={`advance-note-${rentalId}-${advance?.id ?? 'new'}`}
            name="note"
            type="text"
            defaultValue={advance?.note ?? ''}
            placeholder="Volitelná poznámka"
            className={inputClassName}
          />
        </div>
      </div>

      {state.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      {state.success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Záloha byla uložena.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-wait disabled:opacity-60"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

function AssetRentalDeleteButton({
  assetId,
  rentalId,
}: {
  assetId: string
  rentalId: string
}) {
  const router = useRouter()
  const [isConfirming, setIsConfirming] = useState(false)
  const [state, formAction] = useActionState(deleteAssetRentalAction, deleteInitialState)

  useEffect(() => {
    if (!state.success) return

    router.refresh()
  }, [router, state.success])

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="rental_id" value={rentalId} />

      {isConfirming ? (
        <>
          <button
            type="submit"
            className="assets-detail-page__rental-delete assets-detail-page__rental-delete--confirm inline-flex items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition duration-200 hover:-translate-y-[1px] hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
          >
            Smazat
          </button>
          <button
            type="button"
            onClick={() => setIsConfirming(false)}
            className="assets-detail-page__rental-delete inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition duration-200 hover:-translate-y-[1px] hover:text-gray-900"
          >
            Zrušit
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setIsConfirming(true)}
          className="assets-detail-page__rental-delete inline-flex items-center justify-center rounded-2xl border border-white/75 bg-white/80 px-3 py-2 text-xs font-medium text-red-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-red-700"
          aria-label="Smazat pronájem"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
    </form>
  )
}

function AssetRentalForm({
  assetId,
  rental,
  currentAdvance,
  submitLabel,
  onSuccess,
}: AssetRentalFormProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement | null>(null)
  const [state, formAction] = useActionState(upsertAssetRentalAction, createInitialState)
  const isEdit = Boolean(rental?.id)

  useEffect(() => {
    if (!state.success) return

    router.refresh()

    if (!isEdit) {
      formRef.current?.reset()
    }
    onSuccess?.()
  }, [isEdit, onSuccess, router, state.success])

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <input type="hidden" name="asset_id" value={assetId} />
      {rental?.id ? <input type="hidden" name="rental_id" value={rental.id} /> : null}
      {currentAdvance?.id ? <input type="hidden" name="service_advance_id" value={currentAdvance.id} /> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={`tenant-${assetId}-${rental?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Nájemce *
          </label>
          <input
            id={`tenant-${assetId}-${rental?.id ?? 'new'}`}
            name="tenant_name"
            type="text"
            required
            defaultValue={rental?.tenant_name ?? ''}
            placeholder="např. Jan Novák"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`contact-${assetId}-${rental?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Kontakt
          </label>
          <input
            id={`contact-${assetId}-${rental?.id ?? 'new'}`}
            name="tenant_contact"
            type="text"
            defaultValue={rental?.tenant_contact ?? ''}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`start-${assetId}-${rental?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Datum začátku *
          </label>
          <input
            id={`start-${assetId}-${rental?.id ?? 'new'}`}
            name="start_date"
            type="date"
            required
            defaultValue={asDateInput(rental?.start_date ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`end-${assetId}-${rental?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Datum konce
          </label>
          <input
            id={`end-${assetId}-${rental?.id ?? 'new'}`}
            name="end_date"
            type="date"
            defaultValue={asDateInput(rental?.end_date ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`rent-${assetId}-${rental?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Měsíční nájem
          </label>
          <MoneyInput
            id={`rent-${assetId}-${rental?.id ?? 'new'}`}
            name="monthly_rent"
            defaultValue={rental?.monthly_rent ?? null}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`deposit-${assetId}-${rental?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Kauce
          </label>
          <MoneyInput
            id={`deposit-${assetId}-${rental?.id ?? 'new'}`}
            name="deposit_amount"
            defaultValue={rental?.deposit_amount ?? null}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label htmlFor={`note-${assetId}-${rental?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Poznámka
          </label>
          <textarea
            id={`note-${assetId}-${rental?.id ?? 'new'}`}
            name="note"
            defaultValue={rental?.note ?? ''}
            placeholder="Volitelná poznámka k pronájmu."
            className={textareaClassName}
          />
        </div>
      </div>

      <section className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Záloha na služby</h4>
            <p className="text-xs text-gray-500">
              Volitelně rovnou nastav aktuální zálohu. Pokud ji ještě neznáš, můžeš ji doplnit později.
            </p>
          </div>
          <p className="text-xs font-medium text-gray-500">
            {currentAdvance ? `Aktuální: ${formatMonthLabel(currentAdvance.effective_from)}` : 'Bez aktuální zálohy'}
          </p>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor={`service-advance-from-${assetId}-${rental?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
              Platí od
            </label>
            <input
              id={`service-advance-from-${assetId}-${rental?.id ?? 'new'}`}
              name="service_advance_effective_from"
              type="month"
              placeholder="YYYY-MM"
              defaultValue={asMonthInput(currentAdvance?.effective_from ?? null)}
              className={inputClassName}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor={`service-advance-amount-${assetId}-${rental?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
              Záloha na služby
            </label>
            <MoneyInput
              id={`service-advance-amount-${assetId}-${rental?.id ?? 'new'}`}
              name="service_advance_monthly_advance"
              defaultValue={currentAdvance?.monthly_advance ?? null}
              placeholder="Volitelné"
              className={inputClassName}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label htmlFor={`service-advance-note-${assetId}-${rental?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
              Poznámka k záloze
            </label>
            <input
              id={`service-advance-note-${assetId}-${rental?.id ?? 'new'}`}
              name="service_advance_note"
              type="text"
              defaultValue={currentAdvance?.note ?? ''}
              placeholder="Volitelná poznámka"
              className={inputClassName}
            />
          </div>
        </div>
      </section>

      {state.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      {state.success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Pronájem byl uložen.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-wait disabled:opacity-60"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

export function AssetRentalSection({ assetId, rentals, advanceHistoryByRentalId }: AssetRentalSectionProps) {
  const [isCreating, setIsCreating] = useState(false)
  const latestRental = useMemo(() => getLatestRental(rentals), [rentals])
  const now = new Date()

  return (
    <div className="space-y-5">
      <section className="assets-detail-page__rental-shell rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_48%,rgba(241,245,249,0.9)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_36px_rgba(15,23,42,0.1)] sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight text-gray-900">Uložené pronájmy</h3>
            <p className="text-sm text-zinc-500">Historie nájemních vztahů a přehled aktuálního obsazení.</p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <button
              type="button"
              onClick={() => setIsCreating((current) => !current)}
              className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px]"
            >
              {isCreating ? 'Skrýt nový pronájem' : '+ Nový pronájem'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <RentalStat title="Aktuální stav" value={latestRental ? getRentalStatus(latestRental, now) : 'Volné'} />
          <RentalStat title="Nájemce" value={latestRental?.tenant_name || '—'} />
          <RentalStat title="Nájem" value={latestRental ? formatCurrency(latestRental.monthly_rent) : '—'} />
          <RentalStat
            title="Kauce"
            value={latestRental ? formatCurrency(latestRental.deposit_amount) : '—'}
            note={latestRental?.end_date ? `Konec: ${formatDate(latestRental.end_date)}` : undefined}
          />
        </div>

        <div className="mt-5 space-y-3">
          {rentals.length > 0 ? (
            rentals.map((rental) => (
              <RentalAccordionItem
                key={rental.id}
                assetId={assetId}
                rental={rental}
                advanceHistory={advanceHistoryByRentalId[rental.id] ?? []}
              />
            ))
          ) : (
            <div className="assets-detail-page__rental-empty-state rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-6 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] backdrop-blur-[8px]">
              Zatím zde není žádný pronájem.
            </div>
          )}
        </div>

        {isCreating ? (
          <div className="assets-detail-page__rental-create-panel mt-5 border-t border-white/70 pt-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-gray-900">Nový pronájem</h3>
                <p className="text-sm text-zinc-500">Přidej nový nájemní vztah.</p>
              </div>
            </div>
            <AssetRentalForm
              key="new-rental"
              assetId={assetId}
              rental={null}
              currentAdvance={null}
              submitLabel="ULOŽIT PRONÁJEM"
              onSuccess={() => setIsCreating(false)}
            />
          </div>
        ) : null}
      </section>
    </div>
  )
}
