'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import {
  deleteAssetInsuranceAction,
  upsertAssetInsuranceAction,
  type DeleteAssetInsuranceActionState,
  type UpdateAssetInsuranceActionState,
} from './actions'
import { MoneyInput } from '@/components/ui/money-input'

export type AssetInsuranceRow = {
  id: string
  asset_id: string
  insurance_type: string | null
  provider_name: string | null
  policy_number: string | null
  start_date: string | null
  end_date: string | null
  annual_premium: string | number | null
  deductible: string | number | null
  insured_amount: string | number | null
  note: string | null
  created_at: string
  updated_at: string
}

const createInitialState: UpdateAssetInsuranceActionState = {
  success: false,
  error: null,
}

const deleteInitialState: DeleteAssetInsuranceActionState = {
  success: false,
  error: null,
}

const inputClassName =
  'clients-modal__input w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const textareaClassName =
  'clients-modal__textarea min-h-[120px] w-full resize-y rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

type AssetInsuranceFormProps = {
  assetId: string
  insurance: AssetInsuranceRow | null
  submitLabel: string
  onSuccess?: () => void
}

type AssetInsuranceSectionProps = {
  assetId: string
  insurances: AssetInsuranceRow[]
}

function asDateInput(value: string | null) {
  if (!value) return ''
  return value.slice(0, 10)
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

export function AssetInsuranceSection({ assetId, insurances }: AssetInsuranceSectionProps) {
  const [isCreating, setIsCreating] = useState(false)
  const documentTypeHint = insurances.length > 0 ? 'Každé pojištění můžeš upravit samostatně.' : 'Zatím zde nejsou žádná pojištění.'

  return (
    <div className="space-y-5">
      <section className="assets-detail-page__insurance-shell rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_48%,rgba(241,245,249,0.9)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_36px_rgba(15,23,42,0.1)] sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-gray-900">Uložená pojištění</h3>
            <p className="text-sm text-zinc-500">{documentTypeHint}</p>
          </div>
          <p className="text-sm font-medium text-zinc-500">{insurances.length} záznamů</p>
        </div>

        <div className="space-y-3">
          {insurances.length > 0 ? (
            insurances.map((insurance) => (
              <InsuranceAccordionItem
                key={insurance.id}
                assetId={assetId}
                insurance={insurance}
                defaultOpen={false}
              />
            ))
          ) : (
            <div className="assets-detail-page__empty-state rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-6 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] backdrop-blur-[8px]">
              Zatím zde není žádné pojištění.
            </div>
          )}
        </div>
      </section>

      <section className="assets-detail-page__insurance-create-shell rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_48%,rgba(241,245,249,0.9)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_36px_rgba(15,23,42,0.1)] sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-gray-900">Nové pojištění</h3>
            <p className="text-sm text-zinc-500">Přidej další pojistku k tomuto majetku. Každý záznam se ukládá zvlášť.</p>
          </div>
          <button
            type="button"
            onClick={() => setIsCreating((current) => !current)}
            className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px]"
          >
            {isCreating ? 'SKRÝT' : '+ Nové pojištění'}
          </button>
        </div>

        {isCreating ? (
          <div className="assets-detail-page__insurance-form-panel mt-5 border-t border-white/70 pt-5">
            <AssetInsuranceForm
              key="new-insurance"
              assetId={assetId}
              insurance={null}
              submitLabel="ULOŽIT POJIŠTĚNÍ"
              onSuccess={() => setIsCreating(false)}
            />
          </div>
        ) : null}
      </section>
    </div>
  )
}

function AssetInsuranceForm({ assetId, insurance, submitLabel, onSuccess }: AssetInsuranceFormProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement | null>(null)
  const [state, formAction] = useActionState(upsertAssetInsuranceAction, createInitialState)
  const isEdit = Boolean(insurance?.id)

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
      {insurance?.id ? <input type="hidden" name="insurance_id" value={insurance.id} /> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={`insurance-type-${assetId}-${insurance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Druh pojištění
          </label>
          <input
            id={`insurance-type-${assetId}-${insurance?.id ?? 'new'}`}
            name="insurance_type"
            type="text"
            defaultValue={insurance?.insurance_type ?? ''}
            placeholder="např. Povinné ručení"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`provider-${assetId}-${insurance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Pojišťovna
          </label>
          <input
            id={`provider-${assetId}-${insurance?.id ?? 'new'}`}
            name="provider_name"
            type="text"
            defaultValue={insurance?.provider_name ?? ''}
            placeholder="např. Kooperativa"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`policy-${assetId}-${insurance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Číslo smlouvy
          </label>
          <input
            id={`policy-${assetId}-${insurance?.id ?? 'new'}`}
            name="policy_number"
            type="text"
            defaultValue={insurance?.policy_number ?? ''}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`start-${assetId}-${insurance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Počátek pojištění
          </label>
          <input
            id={`start-${assetId}-${insurance?.id ?? 'new'}`}
            name="start_date"
            type="date"
            defaultValue={asDateInput(insurance?.start_date ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`end-${assetId}-${insurance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Konec pojištění
          </label>
          <input
            id={`end-${assetId}-${insurance?.id ?? 'new'}`}
            name="end_date"
            type="date"
            defaultValue={asDateInput(insurance?.end_date ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`premium-${assetId}-${insurance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Roční pojistné
          </label>
          <MoneyInput
            id={`premium-${assetId}-${insurance?.id ?? 'new'}`}
            name="annual_premium"
            defaultValue={insurance?.annual_premium ?? null}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`deductible-${assetId}-${insurance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Spoluúčast
          </label>
          <MoneyInput
            id={`deductible-${assetId}-${insurance?.id ?? 'new'}`}
            name="deductible"
            defaultValue={insurance?.deductible ?? null}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`insured-${assetId}-${insurance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Pojistná částka
          </label>
          <MoneyInput
            id={`insured-${assetId}-${insurance?.id ?? 'new'}`}
            name="insured_amount"
            defaultValue={insurance?.insured_amount ?? null}
            placeholder="Volitelné"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label htmlFor={`note-${assetId}-${insurance?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Poznámka
          </label>
          <textarea
            id={`note-${assetId}-${insurance?.id ?? 'new'}`}
            name="note"
            defaultValue={insurance?.note ?? ''}
            placeholder="Volitelná poznámka k pojištění."
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
          Pojištění bylo uloženo.
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

function InsuranceAccordionItem({
  assetId,
  insurance,
  defaultOpen,
}: {
  assetId: string
  insurance: AssetInsuranceRow
  defaultOpen: boolean
}) {
  const title = insurance.insurance_type || 'Pojištění'
  const subtitle = [insurance.provider_name, insurance.policy_number].filter(Boolean).join(' • ')

  return (
    <details
      open={defaultOpen}
      className="assets-detail-page__insurance-item group rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]"
    >
      <summary className="assets-detail-page__insurance-summary flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="mt-1 truncate text-xs text-gray-500">{subtitle || 'Bez doplňujících údajů'}</p>
        </div>

        <div className="flex items-center gap-3 text-right">
          <div className="hidden sm:block">
            <p className="text-xs text-gray-500">Platnost</p>
            <p className="text-sm font-medium text-gray-900">
              {formatDate(insurance.start_date)} - {formatDate(insurance.end_date)}
            </p>
          </div>
          <div className="hidden lg:block">
            <p className="text-xs text-gray-500">Pojistné</p>
            <p className="text-sm font-medium text-gray-900">{formatCurrency(insurance.annual_premium)}</p>
          </div>
          <span className="assets-detail-page__insurance-chevron inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/75 bg-white/70 text-gray-500 transition group-open:rotate-180">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </summary>

      <div className="assets-detail-page__insurance-item-body border-t border-white/70 px-5 py-5">
        <AssetInsuranceForm
          key={`${insurance.id}-${insurance.updated_at}`}
          assetId={assetId}
          insurance={insurance}
          submitLabel="ULOŽIT ZMĚNY"
        />
        <div className="mt-4 flex justify-end">
          <AssetInsuranceDeleteButton assetId={assetId} insuranceId={insurance.id} />
        </div>
      </div>
    </details>
  )
}

function AssetInsuranceDeleteButton({
  assetId,
  insuranceId,
}: {
  assetId: string
  insuranceId: string
}) {
  const router = useRouter()
  const [isConfirming, setIsConfirming] = useState(false)
  const [state, formAction] = useActionState(deleteAssetInsuranceAction, deleteInitialState)

  useEffect(() => {
    if (!state.success) return

    router.refresh()
  }, [router, state.success])

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="insurance_id" value={insuranceId} />

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
          aria-label="Smazat pojištění"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
    </form>
  )
}
