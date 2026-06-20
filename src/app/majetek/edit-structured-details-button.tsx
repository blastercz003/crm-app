'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { Pencil } from 'lucide-react'
import {
  updateAssetStructuredDetailsAction,
  type AssetStructuredDetailsKind,
  type UpdateAssetStructuredDetailsActionState,
} from './actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { MobileModalActions } from '@/components/ui/mobile-modal-actions'

type StructuredDetailsProps = {
  assetId: string
  kind: AssetStructuredDetailsKind
  currentValues: Record<string, string | number | null>
  className?: string
  label?: string
}

const initialState: UpdateAssetStructuredDetailsActionState = {
  success: false,
  error: null,
}

const inputClassName =
  'clients-modal__input w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

function asInputValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return ''
  return String(value)
}

function titleForKind(kind: AssetStructuredDetailsKind) {
  if (kind === 'vehicle') return 'Upravit vozidlové údaje'
  if (kind === 'real_estate') return 'Upravit údaje o nemovitosti'
  return 'Upravit údaje o elektronice'
}

function helpForKind(kind: AssetStructuredDetailsKind) {
  if (kind === 'vehicle') return 'SPZ je povinná. Ostatní údaje jsou doporučené.'
  if (kind === 'real_estate') return 'Údaje můžeš doplňovat postupně podle potřeby.'
  return 'Elektronika obvykle nemá povinné doplňkové údaje.'
}

export function EditStructuredDetailsButton({
  assetId,
  kind,
  currentValues,
  className,
  label = 'UPRAVIT DETAILY',
}: StructuredDetailsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMounted] = useState(() => typeof window !== 'undefined')
  const [formKey, setFormKey] = useState(0)

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  const resolvedClassName =
    className ??
    'assets-page__edit-button inline-flex items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:text-zinc-900'

  return (
    <>
      <button type="button" onClick={openModal} className={resolvedClassName}>
        <Pencil className="mr-2 h-4 w-4" strokeWidth={2.2} />
        {label}
      </button>

      {isOpen && isMounted
        ? createPortal(
            <EditStructuredDetailsModal
              key={formKey}
              assetId={assetId}
              kind={kind}
              currentValues={currentValues}
              onClose={closeModal}
            />,
            document.body
          )
        : null}
    </>
  )
}

function EditStructuredDetailsModal({
  assetId,
  kind,
  currentValues,
  onClose,
}: {
  assetId: string
  kind: AssetStructuredDetailsKind
  currentValues: Record<string, string | number | null>
  onClose: () => void
}) {
  const [state, formAction] = useActionState(updateAssetStructuredDetailsAction, initialState)
  const router = useRouter()

  useBodyScrollLock(true)

  useEffect(() => {
    if (!state.success) return
    router.refresh()
    onClose()
  }, [onClose, router, state.success])

  return (
    <div
      className="clients-modal fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-zinc-950/38 p-4 [-webkit-overflow-scrolling:touch] backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="flex min-h-[calc(100dvh-2rem)] items-start justify-center py-2 sm:min-h-full sm:items-center sm:py-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        <div className="clients-modal__shell relative flex h-[calc(100dvh-1rem)] min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] sm:h-auto sm:max-h-[calc(100dvh-2rem)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]">
          <span aria-hidden className="clients-modal__shell-frame pointer-events-none absolute inset-0 rounded-3xl border border-white/65" />
          <span aria-hidden className="clients-modal__shell-sheen pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-95" />
          <span aria-hidden className="clients-modal__shell-halo pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.72),transparent_70%)]" />

          <div className="clients-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="clients-modal__title text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                {titleForKind(kind)}
              </h2>
              <p className="mt-1 text-sm text-gray-500">{helpForKind(kind)}</p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="clients-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_14px_24px_rgba(39,39,42,0.16)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="asset_id" value={assetId} />
            <input type="hidden" name="detail_kind" value={kind} />
            <PendingFormLock message="Ukládám detail, čekej prosím..." />

            <div className="clients-modal__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 [-webkit-overflow-scrolling:touch] sm:px-5 sm:py-4">
              {kind === 'vehicle' ? (
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <label htmlFor={`reg-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">
                      SPZ *
                    </label>
                    <input id={`reg-${assetId}`} name="registration_plate" required defaultValue={asInputValue(currentValues.registration_plate)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`vin-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">VIN</label>
                    <input id={`vin-${assetId}`} name="vin" defaultValue={asInputValue(currentValues.vin)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`brand-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Značka</label>
                    <input id={`brand-${assetId}`} name="brand" defaultValue={asInputValue(currentValues.brand)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`model-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Model</label>
                    <input id={`model-${assetId}`} name="model" defaultValue={asInputValue(currentValues.model)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`year-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Rok výroby</label>
                    <input id={`year-${assetId}`} name="year_of_manufacture" type="number" defaultValue={asInputValue(currentValues.year_of_manufacture)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`mileage-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Najeto km</label>
                    <input id={`mileage-${assetId}`} name="mileage_km" type="number" defaultValue={asInputValue(currentValues.mileage_km)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`stk-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">STK končí</label>
                    <input id={`stk-${assetId}`} name="stk_expires_on" type="date" defaultValue={asInputValue(currentValues.stk_expires_on)} className={inputClassName} />
                  </div>
                </div>
              ) : kind === 'real_estate' ? (
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <label htmlFor={`address-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Adresa</label>
                    <input id={`address-${assetId}`} name="address" defaultValue={asInputValue(currentValues.address)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`cadastral-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Katastrální území</label>
                    <input id={`cadastral-${assetId}`} name="cadastral_area" defaultValue={asInputValue(currentValues.cadastral_area)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`land-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">LV číslo</label>
                    <input id={`land-${assetId}`} name="land_registry_number" defaultValue={asInputValue(currentValues.land_registry_number)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`parcel-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Parcela</label>
                    <input id={`parcel-${assetId}`} name="parcel_number" defaultValue={asInputValue(currentValues.parcel_number)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`unit-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Jednotka</label>
                    <input id={`unit-${assetId}`} name="unit_number" defaultValue={asInputValue(currentValues.unit_number)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`floor-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Plocha m²</label>
                    <input id={`floor-${assetId}`} name="floor_area_sqm" type="number" step="0.01" defaultValue={asInputValue(currentValues.floor_area_sqm)} className={inputClassName} />
                  </div>
                </div>
              ) : (
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <label htmlFor={`serial-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Sériové číslo</label>
                    <input id={`serial-${assetId}`} name="serial_number" defaultValue={asInputValue(currentValues.serial_number)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`inventory-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Inventární číslo</label>
                    <input id={`inventory-${assetId}`} name="inventory_number" defaultValue={asInputValue(currentValues.inventory_number)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`brand-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Značka</label>
                    <input id={`brand-${assetId}`} name="brand" defaultValue={asInputValue(currentValues.brand)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`model-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Model</label>
                    <input id={`model-${assetId}`} name="model" defaultValue={asInputValue(currentValues.model)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`warranty-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Záruka do</label>
                    <input id={`warranty-${assetId}`} name="warranty_until" type="date" defaultValue={asInputValue(currentValues.warranty_until)} className={inputClassName} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`location-${assetId}`} className="clients-modal__label text-sm font-medium text-gray-900">Umístění</label>
                    <input id={`location-${assetId}`} name="location" defaultValue={asInputValue(currentValues.location)} className={inputClassName} />
                  </div>
                </div>
              )}

              {state.error ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(127,29,29,0.10)]">
                  {state.error}
                </div>
              ) : null}
            </div>

            <MobileModalActions
              onCancel={onClose}
              submitLabel="ULOŽIT DETAIL"
              pendingSubmitLabel="UKLÁDÁM..."
              visualStyle="client-modal"
            />
          </form>
        </div>
      </div>
    </div>
  )
}

function PendingFormLock({ message }: { message: string }) {
  const { pending } = useFormStatus()

  if (!pending) return null

  return (
    <div className="clients-modal__lock mx-4 mt-3 rounded-2xl border border-[#2980B9]/25 bg-[#2980B9]/10 px-4 py-3 text-sm font-medium text-[#1d5f88] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(24,95,145,0.14)] sm:mx-5 sm:mt-4">
      {message}
    </div>
  )
}
