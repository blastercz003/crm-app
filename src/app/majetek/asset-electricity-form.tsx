'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import {
  deleteAssetElectricityAction,
  upsertAssetElectricityAction,
  type DeleteAssetElectricityActionState,
  type UpdateAssetElectricityActionState,
} from './actions'
import { MoneyInput } from '@/components/ui/money-input'

export type AssetElectricityRow = {
  id: string
  asset_id: string
  billing_year: number
  provider_name: string | null
  ean: string | null
  meter_number: string | null
  period_start: string | null
  period_end: string | null
  consumption_kwh: string | number | null
  total_amount: string | number | null
  advance_payments: string | number | null
  balance_amount: string | number | null
  billed_on: string | null
  due_date: string | null
  paid_on: string | null
  note: string | null
  created_at: string
  updated_at: string
}

type AssetElectricitySectionProps = {
  assetId: string
  electricityRecords: AssetElectricityRow[]
}

type AssetElectricityFormProps = {
  assetId: string
  electricity: AssetElectricityRow | null
  submitLabel: string
  onSuccess?: () => void
}

const createInitialState: UpdateAssetElectricityActionState = {
  success: false,
  error: null,
}

const deleteInitialState: DeleteAssetElectricityActionState = {
  success: false,
  error: null,
}

const inputClassName =
  'clients-modal__input w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const textareaClassName =
  'clients-modal__textarea min-h-[120px] w-full resize-y rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

function asDateInput(value: string | null) {
  if (!value) return ''
  return value.slice(0, 10)
}

function asNumberInput(value: string | number | null) {
  if (value === null || value === undefined || value === '') return ''
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? String(parsed) : ''
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

function formatSignedBalance(value: string | number | null) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return '—'

  if (parsed > 0) {
    return `Nedoplatek ${formatCurrency(parsed)}`
  }

  if (parsed < 0) {
    return `Přeplatek ${formatCurrency(Math.abs(parsed))}`
  }

  return 'Vyrovnáno'
}

function ElectricityStat({
  title,
  value,
  note,
}: {
  title: string
  value: string
  note?: string
}) {
  return (
    <div className="assets-detail-page__electricity-stat rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{title}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-gray-500">{note}</p> : null}
    </div>
  )
}

function getLatestElectricityRecord(records: AssetElectricityRow[]) {
  return [...records].sort((left, right) => {
    if (right.billing_year !== left.billing_year) {
      return right.billing_year - left.billing_year
    }

    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  })[0] ?? null
}

function ElectricityAccordionItem({
  assetId,
  electricity,
}: {
  assetId: string
  electricity: AssetElectricityRow
}) {
  const subtitle = [electricity.provider_name, electricity.ean, electricity.meter_number]
    .filter(Boolean)
    .join(' • ')

  return (
    <details className="assets-detail-page__electricity-item group rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{electricity.billing_year}</p>
          <p className="mt-1 truncate text-xs text-gray-500">{subtitle || 'Bez doplňujících údajů'}</p>
        </div>

        <div className="flex items-center gap-3 text-right">
          <div className="hidden sm:block">
            <p className="text-xs text-gray-500">Cena</p>
            <p className="text-sm font-medium text-gray-900">{formatCurrency(electricity.total_amount)}</p>
          </div>
          <div className="hidden lg:block">
            <p className="text-xs text-gray-500">Vyúčtování</p>
            <p className="text-sm font-medium text-gray-900">{formatSignedBalance(electricity.balance_amount)}</p>
          </div>
          <span className="assets-detail-page__electricity-chevron inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/75 bg-white/70 text-gray-500 transition group-open:rotate-180">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </summary>

      <div className="assets-detail-page__electricity-panel border-t border-white/70 px-5 py-5">
        <AssetElectricityForm
          key={`${electricity.id}-${electricity.updated_at}`}
          assetId={assetId}
          electricity={electricity}
          submitLabel="ULOŽIT ZMĚNY"
        />
        <div className="mt-4 flex justify-end">
          <AssetElectricityDeleteButton assetId={assetId} electricityId={electricity.id} />
        </div>
      </div>
    </details>
  )
}

function AssetElectricityDeleteButton({
  assetId,
  electricityId,
}: {
  assetId: string
  electricityId: string
}) {
  const router = useRouter()
  const [isConfirming, setIsConfirming] = useState(false)
  const [state, formAction] = useActionState(deleteAssetElectricityAction, deleteInitialState)

  useEffect(() => {
    if (!state.success) return

    router.refresh()
  }, [router, state.success])

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="electricity_id" value={electricityId} />

      {isConfirming ? (
        <>
          <button
            type="submit"
            className="assets-detail-page__electricity-delete assets-detail-page__electricity-delete--confirm inline-flex items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition duration-200 hover:-translate-y-[1px] hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
          >
            Smazat
          </button>
          <button
            type="button"
            onClick={() => setIsConfirming(false)}
            className="assets-detail-page__electricity-delete inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition duration-200 hover:-translate-y-[1px] hover:text-gray-900"
          >
            Zrušit
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setIsConfirming(true)}
          className="assets-detail-page__electricity-delete inline-flex items-center justify-center rounded-2xl border border-white/75 bg-white/80 px-3 py-2 text-xs font-medium text-red-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-red-700"
          aria-label="Smazat vyúčtování"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
    </form>
  )
}

function AssetElectricityForm({
  assetId,
  electricity,
  submitLabel,
  onSuccess,
}: AssetElectricityFormProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement | null>(null)
  const [state, formAction] = useActionState(upsertAssetElectricityAction, createInitialState)
  const isEdit = Boolean(electricity?.id)

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
      {electricity?.id ? <input type="hidden" name="electricity_id" value={electricity.id} /> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={`billing-year-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Rok vyúčtování *
          </label>
          <input
            id={`billing-year-${assetId}-${electricity?.id ?? 'new'}`}
            name="billing_year"
            type="number"
            required
            defaultValue={asNumberInput(electricity?.billing_year ?? null)}
            placeholder="Např. 2026"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`provider-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Dodavatel
          </label>
          <input
            id={`provider-${assetId}-${electricity?.id ?? 'new'}`}
            name="provider_name"
            type="text"
            defaultValue={electricity?.provider_name ?? ''}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`ean-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            EAN / odběrné místo
          </label>
          <input
            id={`ean-${assetId}-${electricity?.id ?? 'new'}`}
            name="ean"
            type="text"
            defaultValue={electricity?.ean ?? ''}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`meter-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Číslo elektroměru
          </label>
          <input
            id={`meter-${assetId}-${electricity?.id ?? 'new'}`}
            name="meter_number"
            type="text"
            defaultValue={electricity?.meter_number ?? ''}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`period-start-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Období od
          </label>
          <input
            id={`period-start-${assetId}-${electricity?.id ?? 'new'}`}
            name="period_start"
            type="date"
            defaultValue={asDateInput(electricity?.period_start ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`period-end-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Období do
          </label>
          <input
            id={`period-end-${assetId}-${electricity?.id ?? 'new'}`}
            name="period_end"
            type="date"
            defaultValue={asDateInput(electricity?.period_end ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`consumption-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Spotřeba kWh
          </label>
          <input
            id={`consumption-${assetId}-${electricity?.id ?? 'new'}`}
            name="consumption_kwh"
            type="text"
            inputMode="decimal"
            defaultValue={asNumberInput(electricity?.consumption_kwh ?? null)}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`total-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Celková částka
          </label>
          <MoneyInput
            id={`total-${assetId}-${electricity?.id ?? 'new'}`}
            name="total_amount"
            defaultValue={electricity?.total_amount ?? null}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`advance-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Zaplacené zálohy
          </label>
          <MoneyInput
            id={`advance-${assetId}-${electricity?.id ?? 'new'}`}
            name="advance_payments"
            defaultValue={electricity?.advance_payments ?? null}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`balance-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Vyrovnání
          </label>
          <MoneyInput
            id={`balance-${assetId}-${electricity?.id ?? 'new'}`}
            name="balance_amount"
            defaultValue={electricity?.balance_amount ?? null}
            placeholder="Např. -1.200,- Kč"
            allowNegative
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`billed-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Datum doručení
          </label>
          <input
            id={`billed-${assetId}-${electricity?.id ?? 'new'}`}
            name="billed_on"
            type="date"
            defaultValue={asDateInput(electricity?.billed_on ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`due-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Datum splatnosti
          </label>
          <input
            id={`due-${assetId}-${electricity?.id ?? 'new'}`}
            name="due_date"
            type="date"
            defaultValue={asDateInput(electricity?.due_date ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`paid-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Datum úhrady
          </label>
          <input
            id={`paid-${assetId}-${electricity?.id ?? 'new'}`}
            name="paid_on"
            type="date"
            defaultValue={asDateInput(electricity?.paid_on ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label htmlFor={`note-${assetId}-${electricity?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Poznámka
          </label>
          <textarea
            id={`note-${assetId}-${electricity?.id ?? 'new'}`}
            name="note"
            defaultValue={electricity?.note ?? ''}
            placeholder="Volitelná poznámka k vyúčtování."
            className={textareaClassName}
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
          Vyúčtování bylo uloženo.
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

export function AssetElectricitySection({ assetId, electricityRecords }: AssetElectricitySectionProps) {
  const [isCreating, setIsCreating] = useState(false)
  const latestRecord = useMemo(() => getLatestElectricityRecord(electricityRecords), [electricityRecords])

  return (
    <div className="space-y-5">
      <section className="assets-detail-page__electricity-shell rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_48%,rgba(241,245,249,0.9)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_36px_rgba(15,23,42,0.1)] sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-gray-900">Uložená vyúčtování elektřiny</h3>
            <p className="text-sm text-zinc-500">Každý rok eviduj samostatně, aby šlo snadno dohledat historii i náklady.</p>
          </div>
          <p className="text-sm font-medium text-zinc-500">{electricityRecords.length} záznamů</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ElectricityStat title="Poslední rok" value={latestRecord ? String(latestRecord.billing_year) : '—'} />
          <ElectricityStat title="Poslední částka" value={latestRecord ? formatCurrency(latestRecord.total_amount) : '—'} />
          <ElectricityStat title="Poslední vyrovnání" value={latestRecord ? formatSignedBalance(latestRecord.balance_amount) : '—'} />
          <ElectricityStat
            title="Splatnost"
            value={latestRecord ? formatDate(latestRecord.due_date) : '—'}
            note={latestRecord?.paid_on ? `Uhrazeno: ${formatDate(latestRecord.paid_on)}` : undefined}
          />
        </div>

        <div className="mt-5 space-y-3">
          {electricityRecords.length > 0 ? (
            electricityRecords.map((electricity) => (
              <ElectricityAccordionItem key={electricity.id} assetId={assetId} electricity={electricity} />
            ))
          ) : (
            <div className="assets-detail-page__electricity-empty-state rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-6 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] backdrop-blur-[8px]">
              Zatím zde není žádné vyúčtování elektřiny.
            </div>
          )}
        </div>
      </section>

      <section className="assets-detail-page__electricity-create-shell rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_48%,rgba(241,245,249,0.9)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_36px_rgba(15,23,42,0.1)] sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-gray-900">Nové vyúčtování</h3>
            <p className="text-sm text-zinc-500">Přidej další roční přehled nebo historii plateb. Každý záznam se ukládá zvlášť.</p>
          </div>
          <button
            type="button"
            onClick={() => setIsCreating((current) => !current)}
            className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px]"
          >
            {isCreating ? 'SKRÝT' : '+ Nové vyúčtování'}
          </button>
        </div>

        {isCreating ? (
          <div className="assets-detail-page__electricity-create-panel mt-5 border-t border-white/70 pt-5">
            <AssetElectricityForm
              key="new-electricity"
              assetId={assetId}
              electricity={null}
              submitLabel="ULOŽIT VYÚČTOVÁNÍ"
              onSuccess={() => setIsCreating(false)}
            />
          </div>
        ) : null}
      </section>
    </div>
  )
}
