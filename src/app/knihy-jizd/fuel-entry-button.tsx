'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  createVehicleLogbookFuelAction,
  type CreateVehicleLogbookFuelState,
} from './actions'

const createVehicleLogbookFuelInitialState: CreateVehicleLogbookFuelState = {
  success: false,
  error: null,
}

type EnergyType = 'petrol' | 'diesel' | 'electricity'

type FuelEntryButtonProps = {
  vehicleId: string
  vehicleLabel: string
  currentOdometerKm: number | null
  today: string
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function FuelEntryModal({
  vehicleId,
  vehicleLabel,
  currentOdometerKm,
  today,
  onClose,
}: FuelEntryButtonProps & { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(
    createVehicleLogbookFuelAction,
    createVehicleLogbookFuelInitialState
  )
  const [energyType, setEnergyType] = useState<EnergyType>('petrol')
  const [grossAmount, setGrossAmount] = useState('')
  const [documentName, setDocumentName] = useState('')

  const priceBreakdown = useMemo(() => {
    const gross = Number(grossAmount.replace(',', '.'))
    if (!Number.isFinite(gross) || gross <= 0) return null

    const net = Math.round((gross / 1.21) * 100) / 100
    return { gross, net, vat: Math.round((gross - net) * 100) / 100 }
  }, [grossAmount])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, pending])

  useEffect(() => {
    if (state.success) onClose()
  }, [onClose, state.success])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-zinc-950/45 p-3 backdrop-blur-[5px] sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehicle-logbook-fuel-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <div className="vehicle-logbook-page__modal vehicle-logbook-page__fuel-modal my-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.97)_0%,rgba(245,248,251,0.94)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.3)] sm:max-h-[calc(100dvh-2.5rem)]">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id="vehicle-logbook-fuel-title"
              className="text-xl font-semibold tracking-tight text-gray-900"
            >
              Nové tankování
            </h2>
            <p className="mt-1 truncate text-sm text-gray-500">{vehicleLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Zavřít"
            className="vehicle-logbook-page__modal-close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white/90 text-gray-700 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <form
          action={formAction}
          className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6"
        >
          <input type="hidden" name="vehicle_id" value={vehicleId} />

          <div>
            <span className="vehicle-logbook-page__modal-label">DRUH PALIVA / ENERGIE</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  ['petrol', 'BENZÍN'],
                  ['diesel', 'NAFTA'],
                  ['electricity', 'ELEKTŘINA'],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  data-selected={energyType === value ? 'true' : 'false'}
                  className="vehicle-logbook-page__usage-option"
                >
                  <input
                    type="radio"
                    name="energy_type"
                    value={value}
                    checked={energyType === value}
                    onChange={() => setEnergyType(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">
                {energyType === 'electricity' ? 'DATUM NABÍJENÍ' : 'DATUM TANKOVÁNÍ'}
              </span>
              <input
                name="fueled_on"
                type="date"
                required
                max={today}
                defaultValue={today}
                className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none"
              />
            </label>
            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">STAV TACHOMETRU</span>
              <input
                name="odometer_km"
                type="number"
                min="0"
                max="9999999"
                step="1"
                required
                defaultValue={currentOdometerKm ?? ''}
                placeholder="Stav v km"
                className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
            </label>
            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">
                MNOŽSTVÍ ({energyType === 'electricity' ? 'KWH' : 'L'})
              </span>
              <input
                name="quantity"
                type="number"
                min="0.001"
                step="0.001"
                required
                inputMode="decimal"
                placeholder={energyType === 'electricity' ? 'Např. 42,5' : 'Např. 48,2'}
                className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
            </label>
            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">
                CELKOVÁ CENA S DPH
              </span>
              <div className="relative mt-2">
                <input
                  name="gross_amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  inputMode="decimal"
                  value={grossAmount}
                  onChange={(event) => setGrossAmount(event.target.value)}
                  placeholder="0,00"
                  className="vehicle-logbook-page__input h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 pr-12 text-sm text-gray-900 outline-none placeholder:text-gray-400"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-gray-400">
                  Kč
                </span>
              </div>
            </label>
          </div>

          <div className="vehicle-logbook-page__price-breakdown mt-3 grid grid-cols-3 gap-3 rounded-xl border border-[#b9d8ec] bg-[#eef7fc]/80 px-4 py-3">
            <div>
              <span>BEZ DPH</span>
              <strong>{priceBreakdown ? formatMoney(priceBreakdown.net) : '—'}</strong>
            </div>
            <div>
              <span>DPH 21 %</span>
              <strong>{priceBreakdown ? formatMoney(priceBreakdown.vat) : '—'}</strong>
            </div>
            <div>
              <span>CELKEM</span>
              <strong>{priceBreakdown ? formatMoney(priceBreakdown.gross) : '—'}</strong>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">DODAVATEL (NEPOVINNÉ)</span>
              <input
                name="supplier"
                type="text"
                maxLength={180}
                placeholder="Např. ORLEN"
                className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
            </label>
            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">ČÍSLO DOKLADU (NEPOVINNÉ)</span>
              <input
                name="document_number"
                type="text"
                maxLength={120}
                placeholder="Číslo účtenky nebo faktury"
                className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
            </label>
          </div>

          {energyType !== 'electricity' ? (
            <label className="vehicle-logbook-page__checkbox-row mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-white/55 px-4 py-3">
              <input
                type="checkbox"
                name="is_full_tank"
                className="h-4 w-4 rounded border-gray-300 accent-[#2f77af]"
              />
              <span>
                <strong className="block text-xs font-semibold text-gray-800">
                  PLNÁ NÁDRŽ
                </strong>
                <small className="mt-0.5 block text-xs text-gray-500">
                  Umožní později přesnější výpočet skutečné spotřeby.
                </small>
              </span>
            </label>
          ) : null}

          <label className="mt-4 block">
            <span className="vehicle-logbook-page__modal-label">
              DOKLAD (NEPOVINNÝ)
            </span>
            <span className="vehicle-logbook-page__file-input mt-2 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-[#91bddc] bg-white/55 px-4 py-3">
              <span className="min-w-0">
                <strong className="block truncate text-xs font-semibold text-gray-700">
                  {documentName || 'VYBRAT PDF NEBO FOTOGRAFII'}
                </strong>
                <small className="mt-0.5 block text-xs text-gray-500">
                  PDF, JPG, PNG, WEBP, HEIC nebo HEIF · max. 25 MB
                </small>
              </span>
              <span className="shrink-0 text-lg text-[#2f77af]">＋</span>
              <input
                name="document"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(event) =>
                  setDocumentName(event.target.files?.[0]?.name ?? '')
                }
                className="sr-only"
              />
            </span>
          </label>

          <label className="mt-4 block">
            <span className="vehicle-logbook-page__modal-label">POZNÁMKA (NEPOVINNÁ)</span>
            <textarea
              name="note"
              maxLength={1000}
              rows={3}
              placeholder="Interní poznámka k tankování nebo nabíjení"
              className="vehicle-logbook-page__input mt-2 w-full resize-none rounded-xl border border-gray-200 bg-white/95 px-3 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400"
            />
          </label>

          {state.error ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700"
            >
              {state.error}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="vehicle-logbook-page__modal-cancel inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white/90 px-5 text-xs font-semibold uppercase text-gray-700 disabled:opacity-50"
            >
              ZRUŠIT
            </button>
            <button
              type="submit"
              disabled={pending}
              className="vehicle-logbook-page__primary-action inline-flex h-11 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-6 text-xs font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_rgba(41,128,185,0.24)] disabled:cursor-wait disabled:opacity-65"
            >
              {pending ? 'UKLÁDÁM…' : 'ULOŽIT ZÁZNAM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function FuelEntryButton(props: FuelEntryButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="vehicle-logbook-page__primary-action inline-flex h-10 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 text-[10px] font-semibold uppercase tracking-[0.06em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_18px_rgba(41,128,185,0.2)] transition hover:-translate-y-[1px]"
      >
        NOVÉ TANKOVÁNÍ
      </button>

      {open
        ? createPortal(
            <FuelEntryModal {...props} onClose={() => setOpen(false)} />,
            document.body
          )
        : null}
    </>
  )
}
