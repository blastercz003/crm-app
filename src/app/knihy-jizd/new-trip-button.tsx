'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  createVehicleLogbookEntryAction,
  type CreateVehicleLogbookEntryState,
} from './actions'

const createVehicleLogbookEntryInitialState: CreateVehicleLogbookEntryState = {
  success: false,
  error: null,
}

type EntryType = 'trip' | 'daily_summary'
type UsageType = 'business' | 'private' | 'mixed'

type NewTripButtonProps = {
  vehicleId: string
  vehicleLabel: string
  currentOdometerKm: number | null
  today: string
}

function NewTripModal({
  vehicleId,
  vehicleLabel,
  currentOdometerKm,
  today,
  onClose,
}: NewTripButtonProps & { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(
    createVehicleLogbookEntryAction,
    createVehicleLogbookEntryInitialState
  )
  const [entryType, setEntryType] = useState<EntryType>('trip')
  const [usageType, setUsageType] = useState<UsageType>('business')
  const [odometerEnd, setOdometerEnd] = useState('')
  const [businessKm, setBusinessKm] = useState('')
  const [privateKm, setPrivateKm] = useState('')

  const distanceKm = useMemo(() => {
    const parsedEnd = Number(odometerEnd)
    if (
      currentOdometerKm === null ||
      !Number.isInteger(parsedEnd) ||
      parsedEnd <= currentOdometerKm
    ) {
      return null
    }

    return parsedEnd - currentOdometerKm
  }, [currentOdometerKm, odometerEnd])

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

  function handleEntryTypeChange(nextType: EntryType) {
    setEntryType(nextType)
    if (nextType === 'trip' && usageType === 'mixed') {
      setUsageType('business')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-zinc-950/45 p-3 backdrop-blur-[5px] sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehicle-logbook-new-trip-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <div className="vehicle-logbook-page__modal vehicle-logbook-page__trip-modal my-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.97)_0%,rgba(245,248,251,0.94)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.3)] sm:max-h-[calc(100dvh-2.5rem)]">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id="vehicle-logbook-new-trip-title"
              className="text-xl font-semibold tracking-tight text-gray-900"
            >
              Nová jízda
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

        <form action={formAction} className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <input type="hidden" name="vehicle_id" value={vehicleId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">DATUM JÍZDY</span>
              <input
                name="trip_date"
                type="date"
                required
                max={today}
                defaultValue={today}
                className="filter-date-input vehicle-logbook-page__date-input vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none"
              />
            </label>

            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">TYP ZÁZNAMU</span>
              <div className="relative mt-2">
                <select
                  name="entry_type"
                  value={entryType}
                  onChange={(event) =>
                    handleEntryTypeChange(event.target.value as EntryType)
                  }
                  className="vehicle-logbook-page__input h-11 w-full appearance-none rounded-xl border border-gray-200 bg-white/95 px-3 pr-10 text-sm text-gray-900 outline-none"
                >
                  <option value="trip">Jednotlivá jízda</option>
                  <option value="daily_summary">Denní souhrn</option>
                </select>
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  fill="none"
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
                >
                  <path
                    d="m6 8 4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </label>

            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">VÝCHOZÍ MÍSTO</span>
              <input
                name="origin"
                type="text"
                required
                maxLength={180}
                autoFocus
                placeholder="Např. Harrachov"
                className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
            </label>

            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">CÍLOVÉ MÍSTO</span>
              <input
                name="destination"
                type="text"
                required
                maxLength={180}
                placeholder="Např. Liberec"
                className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
            </label>
          </div>

          <div className="mt-4">
            <span className="vehicle-logbook-page__modal-label">VYUŽITÍ VOZIDLA</span>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(
                [
                  ['business', 'SLUŽEBNÍ'],
                  ['private', 'SOUKROMÉ'],
                  ['mixed', 'SMÍŠENÉ'],
                ] as const
              ).map(([value, label]) => {
                const disabled = value === 'mixed' && entryType === 'trip'

                return (
                  <label
                    key={value}
                    data-selected={usageType === value ? 'true' : 'false'}
                    data-disabled={disabled ? 'true' : 'false'}
                    className="vehicle-logbook-page__usage-option"
                  >
                    <input
                      type="radio"
                      name="usage_type"
                      value={value}
                      checked={usageType === value}
                      disabled={disabled}
                      onChange={() => setUsageType(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                )
              })}
            </div>
            {entryType === 'trip' ? (
              <p className="mt-2 text-xs text-gray-500">
                Smíšené využití je dostupné u denního souhrnu.
              </p>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">
                POČÁTEČNÍ STAV TACHOMETRU
              </span>
              <div className="vehicle-logbook-page__readonly-value mt-2 flex h-11 items-center rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-700">
                {currentOdometerKm?.toLocaleString('cs-CZ')} km
              </div>
            </label>

            <label className="min-w-0">
              <span className="vehicle-logbook-page__modal-label">
                KONEČNÝ STAV TACHOMETRU
              </span>
              <input
                name="odometer_end_km"
                type="number"
                min={(currentOdometerKm ?? 0) + 1}
                max="9999999"
                step="1"
                required
                value={odometerEnd}
                onChange={(event) => setOdometerEnd(event.target.value)}
                placeholder={`Více než ${(currentOdometerKm ?? 0).toLocaleString('cs-CZ')}`}
                className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
            </label>
          </div>

          <div className="vehicle-logbook-page__distance-summary mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#b9d8ec] bg-[#eef7fc]/80 px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
              UJETÁ VZDÁLENOST
            </span>
            <strong className="text-sm text-[#2f77af]">
              {distanceKm === null ? '—' : `${distanceKm.toLocaleString('cs-CZ')} km`}
            </strong>
          </div>

          {usageType === 'mixed' ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="min-w-0">
                <span className="vehicle-logbook-page__modal-label">SLUŽEBNÍ KM</span>
                <input
                  name="business_km"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={businessKm}
                  onChange={(event) => setBusinessKm(event.target.value)}
                  className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none"
                />
              </label>
              <label className="min-w-0">
                <span className="vehicle-logbook-page__modal-label">SOUKROMÉ KM</span>
                <input
                  name="private_km"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={privateKm}
                  onChange={(event) => setPrivateKm(event.target.value)}
                  className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none"
                />
              </label>
            </div>
          ) : null}

          <label className="mt-4 block">
            <span className="vehicle-logbook-page__modal-label">ÚČEL JÍZDY</span>
            <input
              name="purpose"
              type="text"
              maxLength={240}
              defaultValue="Služební, jednání / průzkum"
              className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none"
            />
          </label>

          <label className="mt-4 block">
            <span className="vehicle-logbook-page__modal-label">POZNÁMKA (NEPOVINNÉ)</span>
            <textarea
              name="note"
              maxLength={1000}
              rows={3}
              placeholder="Interní poznámka k jízdě"
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
              {pending ? 'UKLÁDÁM…' : 'ULOŽIT JÍZDU'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function NewTripButton(props: NewTripButtonProps) {
  const [open, setOpen] = useState(false)
  const disabled = props.currentOdometerKm === null

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title={
          disabled
            ? 'Nejdříve nastav počáteční stav tachometru.'
            : 'Zapsat novou jízdu'
        }
        onClick={() => setOpen(true)}
        className="vehicle-logbook-page__primary-action col-span-2 inline-flex min-h-10 items-center justify-center rounded-2xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_rgba(41,128,185,0.24)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-55 sm:col-span-1"
      >
        NOVÁ JÍZDA
      </button>

      {open
        ? createPortal(
            <NewTripModal {...props} onClose={() => setOpen(false)} />,
            document.body
          )
        : null}
    </>
  )
}
