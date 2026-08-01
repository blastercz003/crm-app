'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFormStatus } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { ModalHeading } from '@/components/ui/modal-heading'
import {
  updateVehicleOdometerAction,
  type UpdateVehicleOdometerState,
} from './actions'

const updateVehicleOdometerInitialState: UpdateVehicleOdometerState = {
  success: false,
  error: null,
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="vehicle-logbook-page__primary-action inline-flex h-10 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_rgba(41,128,185,0.24)] disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? 'UKLÁDÁM…' : 'ULOŽIT STAV'}
    </button>
  )
}

export function InitialOdometerButton({
  vehicleId,
  vehicleLabel,
  initialOdometerKm,
}: {
  vehicleId: string
  vehicleLabel: string
  initialOdometerKm: number | null
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={
          initialOdometerKm === null
            ? 'vehicle-logbook-page__odometer-warning-action inline-flex h-9 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 text-[11px] font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_8px_18px_rgba(41,128,185,0.22)]'
            : 'vehicle-logbook-page__text-action text-[10px] font-semibold uppercase tracking-[0.08em] text-[#2f77af] transition hover:text-[#1f5f8e]'
        }
      >
        {initialOdometerKm === null ? 'DOPLNIT POČÁTEČNÍ STAV' : 'UPRAVIT'}
      </button>

      {isOpen ? (
        <InitialOdometerModal
          vehicleId={vehicleId}
          vehicleLabel={vehicleLabel}
          initialOdometerKm={initialOdometerKm}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function InitialOdometerModal({
  vehicleId,
  vehicleLabel,
  initialOdometerKm,
  onClose,
}: {
  vehicleId: string
  vehicleLabel: string
  initialOdometerKm: number | null
  onClose: () => void
}) {
  const [state, formAction] = useActionState<UpdateVehicleOdometerState, FormData>(
    updateVehicleOdometerAction,
    updateVehicleOdometerInitialState
  )

  useBodyScrollLock(true)

  useEffect(() => {
    if (state.success) {
      onClose()
    }
  }, [onClose, state.success])

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-zinc-950/45 p-4 backdrop-blur-[5px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehicle-logbook-odometer-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="vehicle-logbook-page__modal w-full max-w-lg overflow-hidden rounded-3xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.97)_0%,rgba(245,248,251,0.94)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.3)]">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <ModalHeading
              section="KNIHY JÍZD"
              title="Počáteční stav tachometru"
              id="vehicle-logbook-odometer-title"
            />
            <p className="mt-1 text-sm text-gray-500">{vehicleLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavřít"
            className="vehicle-logbook-page__modal-close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white/90 text-gray-700"
          >
            ✕
          </button>
        </div>

        <form action={formAction} className="p-5">
          <input type="hidden" name="vehicle_id" value={vehicleId} />
          <label
            htmlFor="vehicle-logbook-initial-odometer"
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500"
          >
            STAV TACHOMETRU V KM
          </label>
          <input
            id="vehicle-logbook-initial-odometer"
            name="initial_odometer_km"
            type="number"
            min="0"
            max="9999999"
            step="1"
            required
            autoFocus
            defaultValue={initialOdometerKm ?? ''}
            placeholder="Např. 48120"
            className="vehicle-logbook-page__input mt-2 h-12 w-full rounded-2xl border border-gray-200 bg-white/95 px-4 text-base text-gray-900 outline-none"
          />
          <p className="mt-2 text-xs leading-5 text-gray-500">
            Tato hodnota založí návaznost první jízdy. Později ji můžeš znovu upravit.
          </p>

          {state.error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700">
              {state.error}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="vehicle-logbook-page__secondary-action inline-flex h-10 items-center justify-center rounded-xl border border-white/75 bg-white/85 px-4 text-sm font-medium text-gray-700"
            >
              ZRUŠIT
            </button>
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
