'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, Paperclip, Trash2 } from 'lucide-react'
import {
  deleteAssetRentalServiceSettlementAction,
  deleteAssetRentalServiceSettlementFileAction,
  updateAssetRentalServiceSettlementReconciliationAction,
  uploadAssetRentalServiceSettlementFilesAction,
  upsertAssetRentalServiceSettlementAction,
  type DeleteAssetRentalServiceSettlementActionState,
  type DeleteAssetRentalServiceSettlementFileActionState,
  type UpdateAssetRentalServiceSettlementReconciliationActionState,
  type UpsertAssetRentalServiceSettlementActionState,
  type UploadAssetRentalServiceSettlementFilesActionState,
} from './rental-settlements-actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { MoneyInput } from '@/components/ui/money-input'
import type {
  RentalServiceSettlementCustomItemRow,
  RentalServiceSettlementFileRow,
  RentalServiceSettlementRow,
} from '@/lib/majetek/rental-settlements'

type AssetRentalSummaryRow = {
  id: string
  tenant_name: string | null
  tenant_contact: string | null
  start_date: string | null
  end_date: string | null
}

type AssetRentalServiceSettlementsSectionProps = {
  assetId: string
  rentals: AssetRentalSummaryRow[]
  settlements: RentalServiceSettlementRow[]
  settlementFilesBySettlementId: Record<string, SettlementFileRow[]>
  settlementCustomItemsBySettlementId: Record<string, RentalServiceSettlementCustomItemRow[]>
}

type SettlementFileRow = RentalServiceSettlementFileRow & {
  signedUrl: string | null
}

const settlementCreateInitialState: UpsertAssetRentalServiceSettlementActionState = {
  success: false,
  error: null,
}

const settlementDeleteInitialState: DeleteAssetRentalServiceSettlementActionState = {
  success: false,
  error: null,
}

const settlementFileUploadInitialState: UploadAssetRentalServiceSettlementFilesActionState = {
  success: false,
  error: null,
}

const settlementFileDeleteInitialState: DeleteAssetRentalServiceSettlementFileActionState = {
  success: false,
  error: null,
}

const settlementReconciliationInitialState: UpdateAssetRentalServiceSettlementReconciliationActionState = {
  success: false,
  error: null,
}

const inputClassName =
  'clients-modal__input w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const textareaClassName =
  'clients-modal__textarea min-h-[120px] w-full resize-y rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const emptyGlassStateClassName =
  'rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-8 text-sm text-gray-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]'

const cardLinkClassName =
  'inline-flex items-center justify-center rounded-2xl border border-white/75 bg-white/80 px-3 py-2 text-xs font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-gray-900'

const cardDownloadClassName =
  'inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 py-2 text-xs font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(24,78,129,0.3)] transition duration-200 hover:-translate-y-[1px]'

type SettlementCustomItemDraft = {
  id: string
  title: string
  amount: string | number | null
}

function createCustomItemDraft(item?: RentalServiceSettlementCustomItemRow): SettlementCustomItemDraft {
  return {
    id: item?.id ?? crypto.randomUUID(),
    title: item?.title ?? '',
    amount: item?.amount ?? null,
  }
}

function asMonthInput(value: string | null) {
  if (!value) return ''
  return value.slice(0, 7)
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

function formatSettlementPeriod(from: string, to: string) {
  return `${formatMonthLabel(from)} - ${formatMonthLabel(to)}`
}

function formatSignedBalance(value: string | number | null) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return '—'

  if (parsed > 0) {
    return `Přeplatek ${formatCurrency(parsed)}`
  }

  if (parsed < 0) {
    return `Nedoplatek ${formatCurrency(Math.abs(parsed))}`
  }

  return 'Vyrovnáno'
}

function formatSettlementReconciliation(settlement: RentalServiceSettlementRow) {
  if (!settlement.settled_on) {
    return {
      label: 'Nevypořádáno',
      className:
        'border border-zinc-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(244,244,245,0.84)_100%)] text-zinc-700',
    }
  }

  return {
    label: 'Vypořádáno',
    className:
      'border border-emerald-200/90 bg-[linear-gradient(155deg,rgba(236,253,245,0.92)_0%,rgba(220,252,231,0.84)_100%)] text-emerald-800',
  }
}

function formatDateOnly(value: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value))
}

function sortSettlements(left: RentalServiceSettlementRow, right: RentalServiceSettlementRow) {
  if (right.period_from !== left.period_from) {
    return String(right.period_from).localeCompare(String(left.period_from))
  }

  return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
}

function SettlementStat({
  title,
  value,
  note,
}: {
  title: string
  value: string
  note?: string
}) {
  return (
    <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{title}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-gray-500">{note}</p> : null}
    </div>
  )
}

export function SettlementDeleteButton({
  assetId,
  settlementId,
  successRedirectHref,
  variant = 'icon',
  className = '',
}: {
  assetId: string
  settlementId: string
  successRedirectHref?: string
  variant?: 'icon' | 'button'
  className?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMounted] = useState(() => typeof window !== 'undefined')
  const [state, formAction] = useActionState(deleteAssetRentalServiceSettlementAction, settlementDeleteInitialState)

  useBodyScrollLock(isOpen)

  return (
    <>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={[
          'inline-flex items-center justify-center rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]',
          variant === 'button'
            ? 'gap-2 border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100'
            : 'border-white/75 bg-white/80 px-3 py-2 text-xs font-medium text-red-600 hover:text-red-700',
          className,
        ].join(' ')}
        aria-label="Smazat vyúčtování"
      >
        <Trash2 className={variant === 'button' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        {variant === 'button' ? 'SMAZAT' : null}
      </button>

      {isOpen && isMounted
        ? createPortal(
            <SettlementDeleteModal
              assetId={assetId}
              settlementId={settlementId}
              state={state}
              formAction={formAction}
              successRedirectHref={successRedirectHref}
              onClose={() => setIsOpen(false)}
            />,
            document.body
          )
        : null}
    </>
  )
}

function SettlementDeleteModal({
  assetId,
  settlementId,
  state,
  formAction,
  successRedirectHref,
  onClose,
}: {
  assetId: string
  settlementId: string
  state: DeleteAssetRentalServiceSettlementActionState
  formAction: ReturnType<typeof useActionState<DeleteAssetRentalServiceSettlementActionState, FormData>>[1]
  successRedirectHref?: string
  onClose: () => void
}) {
  const router = useRouter()
  const [isMounted] = useState(() => typeof window !== 'undefined')

  useBodyScrollLock(true)

  useEffect(() => {
    if (!state.success) return
    if (successRedirectHref) {
      router.replace(successRedirectHref)
      return
    }

    router.refresh()
    onClose()
  }, [onClose, router, state.success, successRedirectHref])

  if (!isMounted) return null

  return (
    <div
      className="clients-modal fixed inset-0 z-[130] overflow-y-auto overscroll-contain bg-zinc-950/38 p-4 [-webkit-overflow-scrolling:touch] backdrop-blur-[5px] lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-[calc(100dvh-2rem)] items-center justify-center py-2 sm:min-h-full sm:py-4">
        <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)]">
          <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px] border border-white/65" />
          <div className="flex items-start justify-between gap-4 border-b border-gray-100/90 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">Smazat vyúčtování</h2>
              <p className="mt-1 text-sm text-gray-500">
                Opravdu chceš smazat toto vyúčtování? Tím se odstraní i přílohy a akci už nepůjde vrátit zpět.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="p-5">
            <input type="hidden" name="asset_id" value={assetId} />
            <input type="hidden" name="settlement_id" value={settlementId} />

            {state.error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {state.error}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 transition duration-200 hover:-translate-y-[1px] hover:text-gray-900"
              >
                Zrušit
              </button>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition duration-200 hover:-translate-y-[1px] hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
              >
                Smazat
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function SettlementFileDeleteButton({
  settlementId,
  fileId,
}: {
  settlementId: string
  fileId: string
}) {
  const router = useRouter()
  const [isConfirming, setIsConfirming] = useState(false)
  const [state, formAction] = useActionState(deleteAssetRentalServiceSettlementFileAction, settlementFileDeleteInitialState)

  useEffect(() => {
    if (!state.success) return
    router.refresh()
  }, [router, state.success])

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="settlement_id" value={settlementId} />
      <input type="hidden" name="file_id" value={fileId} />

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
          aria-label="Smazat soubor"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
    </form>
  )
}

function SettlementFileUploadForm({
  settlementId,
}: {
  settlementId: string
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement | null>(null)
  const [state, formAction] = useActionState(uploadAssetRentalServiceSettlementFilesAction, settlementFileUploadInitialState)

  useEffect(() => {
    if (!state.success) return
    router.refresh()
    formRef.current?.reset()
  }, [router, state.success])

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="settlement_id" value={settlementId} />
      <div className="space-y-2">
        <label className="clients-modal__label text-sm font-medium text-gray-900">
          Přidat přílohy
        </label>
        <input
          name="files"
          type="file"
          multiple
          accept=".pdf,image/*"
          className="clients-modal__input w-full rounded-2xl border border-dashed border-gray-300 bg-white/92 px-4 py-3 text-sm text-gray-700 file:mr-4 file:rounded-xl file:border-0 file:bg-[#eaf3fb] file:px-4 file:py-2 file:text-sm file:font-medium file:text-[#2f78b1] hover:file:bg-[#ddebf7]"
        />
      </div>

      {state.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      {state.success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Přílohy byly nahrány.
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-wait disabled:opacity-60"
        >
          Nahrát soubory
        </button>
      </div>
    </form>
  )
}

function SettlementCustomItemEditorRow({
  draft,
  index,
  onChange,
  onRemove,
}: {
  draft: SettlementCustomItemDraft
  index: number
  onChange: (draft: SettlementCustomItemDraft) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(241,245,249,0.82)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex-1 space-y-2">
          <label htmlFor={`custom-item-title-${draft.id}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Název položky
          </label>
          <input
            id={`custom-item-title-${draft.id}`}
            type="text"
            name="custom_item_title"
            value={draft.title}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
            placeholder="Např. Společné osvětlení"
            className={inputClassName}
          />
          <input type="hidden" name="custom_item_sort_order" value={index} />
        </div>

        <div className="space-y-2 lg:w-[240px]">
          <label htmlFor={`custom-item-amount-${draft.id}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Částka
          </label>
          <MoneyInput
            id={`custom-item-amount-${draft.id}`}
            name="custom_item_amount"
            defaultValue={draft.amount}
            className={inputClassName}
          />
        </div>

        <div className="flex shrink-0 justify-end lg:pt-[30px]">
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition duration-200 hover:-translate-y-[1px] hover:bg-red-100"
          >
            Smazat
          </button>
        </div>
      </div>
    </div>
  )
}

function SettlementForm({
  assetId,
  rentals,
  settlement,
  customItems,
  submitLabel,
  onSuccess,
}: {
  assetId: string
  rentals: AssetRentalSummaryRow[]
  settlement: RentalServiceSettlementRow | null
  customItems: RentalServiceSettlementCustomItemRow[]
  submitLabel: string
  onSuccess?: () => void
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement | null>(null)
  const [state, formAction] = useActionState(upsertAssetRentalServiceSettlementAction, settlementCreateInitialState)
  const isEdit = Boolean(settlement?.id)
  const [customItemDrafts, setCustomItemDrafts] = useState<SettlementCustomItemDraft[]>(
    () => (customItems.length > 0 ? customItems.map((item) => createCustomItemDraft(item)) : [])
  )

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
      {settlement?.id ? <input type="hidden" name="settlement_id" value={settlement.id} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <label htmlFor={`settlement-rental-${settlement?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Nájemní smlouva *
          </label>
          <select
            id={`settlement-rental-${settlement?.id ?? 'new'}`}
            name="rental_id"
            required
            defaultValue={settlement?.rental_id ?? rentals[0]?.id ?? ''}
            className={inputClassName}
          >
            <option value="" disabled>
              Vyber pronájem
            </option>
            {rentals.map((rental) => (
              <option key={rental.id} value={rental.id}>
                {rental.tenant_name || 'Nezadáno'}
                {rental.start_date || rental.end_date ? ` (${formatSettlementPeriod(rental.start_date || '', rental.end_date || rental.start_date || '')})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor={`settlement-from-${settlement?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Období od *
          </label>
          <input
            id={`settlement-from-${settlement?.id ?? 'new'}`}
            name="period_from"
            type="month"
            required
            placeholder="YYYY-MM"
            defaultValue={asMonthInput(settlement?.period_from ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`settlement-to-${settlement?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Období do *
          </label>
          <input
            id={`settlement-to-${settlement?.id ?? 'new'}`}
            name="period_to"
            type="month"
            required
            placeholder="YYYY-MM"
            defaultValue={asMonthInput(settlement?.period_to ?? null)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`settlement-status-${settlement?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Stav
          </label>
          <select
            id={`settlement-status-${settlement?.id ?? 'new'}`}
            name="status"
            defaultValue={settlement?.status ?? 'draft'}
            className={inputClassName}
          >
            <option value="draft">Koncept</option>
            <option value="closed">Uzavřené</option>
          </select>
        </div>

        <div className="space-y-2 md:col-span-2">
          <label htmlFor={`settlement-note-${settlement?.id ?? 'new'}`} className="clients-modal__label text-sm font-medium text-gray-900">
            Poznámka
          </label>
          <textarea
            id={`settlement-note-${settlement?.id ?? 'new'}`}
            name="note"
            defaultValue={settlement?.note ?? ''}
            placeholder="Interní poznámka k vyúčtování."
            className={textareaClassName}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-2">
          <label className="clients-modal__label text-sm font-medium text-gray-900">Spotřeba el. energie</label>
          <MoneyInput
            id={`settlement-electricity-${settlement?.id ?? 'new'}`}
            name="electricity_amount"
            defaultValue={settlement?.electricity_amount ?? null}
            className={inputClassName}
          />
        </div>
        <div className="space-y-2">
          <label className="clients-modal__label text-sm font-medium text-gray-900">Teplo - ohřev TV</label>
          <MoneyInput
            id={`settlement-hot-water-heating-${settlement?.id ?? 'new'}`}
            name="hot_water_heating_amount"
            defaultValue={settlement?.hot_water_heating_amount ?? null}
            className={inputClassName}
          />
        </div>
        <div className="space-y-2">
          <label className="clients-modal__label text-sm font-medium text-gray-900">Teplo - otop</label>
          <MoneyInput
            id={`settlement-space-heating-${settlement?.id ?? 'new'}`}
            name="space_heating_amount"
            defaultValue={settlement?.space_heating_amount ?? null}
            className={inputClassName}
          />
        </div>
        <div className="space-y-2">
          <label className="clients-modal__label text-sm font-medium text-gray-900">Úklid spol. prostor</label>
          <MoneyInput
            id={`settlement-cleaning-${settlement?.id ?? 'new'}`}
            name="common_area_cleaning_amount"
            defaultValue={settlement?.common_area_cleaning_amount ?? null}
            className={inputClassName}
          />
        </div>
        <div className="space-y-2">
          <label className="clients-modal__label text-sm font-medium text-gray-900">Vodné a stočné SV</label>
          <MoneyInput
            id={`settlement-cold-water-${settlement?.id ?? 'new'}`}
            name="cold_water_sewer_amount"
            defaultValue={settlement?.cold_water_sewer_amount ?? null}
            className={inputClassName}
          />
        </div>
        <div className="space-y-2">
          <label className="clients-modal__label text-sm font-medium text-gray-900">Vodné a stočné TV</label>
          <MoneyInput
            id={`settlement-hot-water-${settlement?.id ?? 'new'}`}
            name="hot_water_sewer_amount"
            defaultValue={settlement?.hot_water_sewer_amount ?? null}
            className={inputClassName}
          />
        </div>
      </div>

      <section className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Vlastní položky</h4>
            <p className="text-xs text-gray-500">
              Volitelné položky navíc k pevným službám. Zobrazí se v detailu i v XLS exportu.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCustomItemDrafts((current) => [...current, createCustomItemDraft()])}
            className="inline-flex items-center justify-center rounded-2xl border border-white/75 bg-white/80 px-3 py-2 text-xs font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-gray-900"
          >
            + Přidat položku
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {customItemDrafts.length > 0 ? (
            customItemDrafts.map((draft, index) => (
              <SettlementCustomItemEditorRow
                key={draft.id}
                draft={draft}
                index={index}
                onChange={(nextDraft) => {
                  setCustomItemDrafts((current) =>
                    current.map((item) => (item.id === draft.id ? nextDraft : item))
                  )
                }}
                onRemove={() => {
                  setCustomItemDrafts((current) => current.filter((item) => item.id !== draft.id))
                }}
              />
            ))
          ) : (
            <div className={emptyGlassStateClassName}>
              Zatím nejsou přidané žádné vlastní položky.
            </div>
          )}
        </div>
      </section>

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

function SettlementFilesList({
  settlementId,
  files,
}: {
  settlementId: string
  files: SettlementFileRow[]
}) {
  if (files.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#d8e4ef] bg-[rgba(255,255,255,0.56)] p-4 text-sm text-gray-500">
        Zatím nejsou nahrané žádné přílohy.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <article
          key={file.id}
          className="flex flex-col gap-3 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(241,245,249,0.82)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">{file.title || file.file_name}</p>
            <p className="mt-1 text-xs text-gray-500">
              {file.file_name}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={file.signedUrl ?? '#'}
              target={file.signedUrl ? '_blank' : undefined}
              rel={file.signedUrl ? 'noreferrer' : undefined}
              aria-disabled={!file.signedUrl}
              onClick={(event) => {
                if (!file.signedUrl) {
                  event.preventDefault()
                }
              }}
              className="inline-flex items-center justify-center rounded-2xl border border-white/75 bg-white/80 px-3 py-2 text-xs font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-gray-900"
            >
              Otevřít
            </a>
            {file.mime_type ? (
              <span className="hidden rounded-full border border-white/75 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-gray-500 sm:inline-flex">
                {file.mime_type}
              </span>
            ) : null}
            <SettlementFileDeleteButton settlementId={settlementId} fileId={file.id} />
          </div>
        </article>
      ))}
    </div>
  )
}

function SettlementCardActions({
  assetId,
  settlement,
}: {
  assetId: string
  settlement: RentalServiceSettlementRow
}) {
  const detailHref = `/majetek/${assetId}/vyuctovani/${settlement.id}`
  const exportHref = `${detailHref}/export`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={detailHref}
        onClick={(event) => {
          event.stopPropagation()
        }}
        className={cardLinkClassName}
      >
        Detail
      </Link>
      {settlement.status === 'closed' ? (
        <a
          href={exportHref}
          download
          onClick={(event) => {
            event.stopPropagation()
          }}
          className={cardDownloadClassName}
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          XLS
        </a>
      ) : null}
    </div>
  )
}

export function SettlementReconciliationForm({
  settlement,
  settledByName,
}: {
  settlement: RentalServiceSettlementRow
  settledByName: string | null
}) {
  const router = useRouter()
  const [state, formAction] = useActionState(
    updateAssetRentalServiceSettlementReconciliationAction,
    settlementReconciliationInitialState
  )

  useEffect(() => {
    if (!state.success) return
    router.refresh()
  }, [router, state.success])

  const reconciliation = formatSettlementReconciliation(settlement)

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="settlement_id" value={settlement.id} />
      <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(241,245,249,0.82)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Vypořádání</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{reconciliation.label}</p>
            <p className="mt-1 text-xs text-gray-500">
              Evidence, že přeplatek byl vrácen nebo nedoplatek uhrazen.
            </p>
          </div>
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${reconciliation.className}`}>
            {reconciliation.label}
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/75 bg-white/70 px-3 py-3 text-sm text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_rgba(15,23,42,0.06)]">
            <input
              type="checkbox"
              name="is_settled"
              defaultChecked={Boolean(settlement.settled_on)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-[#3a7eb8] focus:ring-[#9dc7e5]"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-900">Vypořádáno</span>
              <span className="mt-1 block text-xs text-gray-500">
                Označ, pokud už byl přeplatek vrácen nebo nedoplatek uhrazen.
              </span>
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/75 bg-white/70 px-3 py-3 text-sm text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_rgba(15,23,42,0.06)]">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Datum</p>
              <p className="mt-1 font-semibold text-gray-900">
                {settlement.settled_on ? formatDateOnly(settlement.settled_on) : 'Nevypořádáno'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/75 bg-white/70 px-3 py-3 text-sm text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_rgba(15,23,42,0.06)]">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Zapsal</p>
              <p className="mt-1 font-semibold text-gray-900">{settledByName ?? '—'}</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="clients-modal__label text-sm font-medium text-gray-900">Poznámka k vypořádání</label>
            <textarea
              name="settled_note"
              defaultValue={settlement.settled_note ?? ''}
              placeholder="Např. přeplatek vrácen na účet dne 21. 6. 2026."
              className={textareaClassName}
            />
          </div>
        </div>
      </div>

      {state.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      {state.success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Vypořádání bylo uloženo.
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-wait disabled:opacity-60"
        >
          ULOŽIT VYPOŘÁDÁNÍ
        </button>
      </div>
    </form>
  )
}

function SettlementCard({
  assetId,
  settlement,
  rentals,
  files,
  customItems,
  defaultOpen = false,
}: {
  assetId: string
  settlement: RentalServiceSettlementRow
  rentals: AssetRentalSummaryRow[]
  files: SettlementFileRow[]
  customItems: RentalServiceSettlementCustomItemRow[]
  defaultOpen?: boolean
}) {
  return (
    <details
      id={`settlement-${settlement.id}`}
      className="group rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-4 px-5 py-4 sm:flex-nowrap sm:items-center">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{settlement.settlement_code}</p>
          <p className="mt-1 truncate text-xs text-gray-500">
            {settlement.tenant_name_snapshot}
            {settlement.tenant_contact_snapshot ? ` • ${settlement.tenant_contact_snapshot}` : ''}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {formatSettlementPeriod(settlement.period_from, settlement.period_to)}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 text-right">
          <div className="hidden sm:block">
            <p className="text-xs text-gray-500">Výsledek</p>
            <p className="text-sm font-medium text-gray-900">{formatSignedBalance(settlement.balance_amount)}</p>
          </div>
          <div className="hidden lg:block">
            <p className="text-xs text-gray-500">Stav</p>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${
                settlement.status === 'closed'
                  ? 'border border-emerald-200/90 bg-[linear-gradient(155deg,rgba(236,253,245,0.92)_0%,rgba(220,252,231,0.84)_100%)] text-emerald-800'
                  : 'border border-amber-200/90 bg-[linear-gradient(155deg,rgba(255,247,237,0.92)_0%,rgba(254,243,199,0.84)_100%)] text-amber-800'
              }`}
            >
              {settlement.status === 'closed' ? 'Uzavřené' : 'Koncept'}
            </span>
          </div>
          <div className="hidden xl:block">
            <p className="text-xs text-gray-500">Vypořádání</p>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${formatSettlementReconciliation(settlement).className}`}
            >
              {formatSettlementReconciliation(settlement).label}
            </span>
          </div>
          <div className="shrink-0">
            <SettlementCardActions assetId={assetId} settlement={settlement} />
          </div>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/75 bg-white/70 text-gray-500 transition group-open:rotate-180">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </summary>

      <div className="border-t border-white/70 px-5 py-5">
        <div className="grid gap-3 md:grid-cols-3">
          <SettlementStat title="Zálohy celkem" value={formatCurrency(settlement.advance_payments_total_amount)} />
          <SettlementStat title="Služby celkem" value={formatCurrency(settlement.service_total_amount)} />
          <SettlementStat title="Výsledek" value={formatSignedBalance(settlement.balance_amount)} />
        </div>

        <div className="mt-5">
          <SettlementReconciliationForm
            settlement={settlement}
            settledByName={null}
          />
        </div>

        <div className="mt-5">
          <SettlementForm
            key={`${settlement.id}-${settlement.updated_at}`}
            assetId={assetId}
            rentals={rentals}
            settlement={settlement}
            customItems={customItems}
            submitLabel="ULOŽIT ZMĚNY"
          />
        </div>

        <div className="mt-5 space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Přílohy</h4>
            <p className="text-xs text-gray-500">Seznam nahraných PDF a obrázků k vyúčtování.</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
            <Paperclip className="h-3.5 w-3.5" />
            {files.length} souborů
          </div>
          <SettlementFileUploadForm settlementId={settlement.id} />
          <SettlementFilesList settlementId={settlement.id} files={files} />
        </div>

        <div className="mt-5 flex justify-end">
          <SettlementDeleteButton assetId={assetId} settlementId={settlement.id} />
        </div>
      </div>
    </details>
  )
}

export function AssetRentalServiceSettlementsSection({
  assetId,
  rentals,
  settlements,
  settlementFilesBySettlementId,
  settlementCustomItemsBySettlementId,
}: AssetRentalServiceSettlementsSectionProps) {
  const [isCreating, setIsCreating] = useState(false)
  const sortedSettlements = useMemo(
    () => [...settlements].sort(sortSettlements),
    [settlements]
  )

  return (
    <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_48%,rgba(241,245,249,0.9)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_36px_rgba(15,23,42,0.1)] sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-gray-900">Vyúčtování služeb</h3>
          <p className="text-sm text-zinc-500">Aktuální vyúčtování navázaná na konkrétní nájemní smlouvu.</p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreating((current) => !current)}
          className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px]"
        >
          {isCreating ? 'Skrýt formulář' : '+ Nové vyúčtování'}
        </button>
      </div>

      {isCreating ? (
        <div className="mt-5 rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
          <SettlementForm
            assetId={assetId}
            rentals={rentals}
            settlement={null}
            customItems={[]}
            submitLabel="ULOŽIT KONCEPT"
            onSuccess={() => setIsCreating(false)}
          />
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {sortedSettlements.length > 0 ? (
          sortedSettlements.map((settlement) => (
            <SettlementCard
              key={settlement.id}
              assetId={assetId}
              settlement={settlement}
              rentals={rentals}
              files={settlementFilesBySettlementId[settlement.id] ?? []}
              customItems={settlementCustomItemsBySettlementId[settlement.id] ?? []}
            />
          ))
        ) : (
          <div className={emptyGlassStateClassName}>
            Zatím zde není žádné vyúčtování.
          </div>
        )}
      </div>
    </section>
  )
}
