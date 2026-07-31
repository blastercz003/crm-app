'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  getVehicleLogbookClosurePreviewAction,
  recalculateVehicleLogbookClosureAction,
  type RecalculateVehicleLogbookClosureState,
  type VehicleLogbookClosurePreview,
} from './actions'

const recalculateVehicleLogbookClosureInitialState: RecalculateVehicleLogbookClosureState =
  {
    success: false,
    error: null,
  }

type ClosureStatus = 'none' | 'valid' | 'changed'

type MonthlyClosureButtonProps = {
  vehicleId: string
  vehicleLabel: string
  defaultPeriod: string
  currentPeriod: string
  status: ClosureStatus
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPeriod(period: string) {
  const [year, month] = period.split('-').map(Number)
  return new Intl.DateTimeFormat('cs-CZ', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function formatDateTime(value: string | null) {
  if (!value) return null

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function MonthlyClosureModal({
  vehicleId,
  vehicleLabel,
  currentPeriod,
  initialPreview,
  onClose,
}: {
  vehicleId: string
  vehicleLabel: string
  currentPeriod: string
  initialPreview: VehicleLogbookClosurePreview
  onClose: () => void
}) {
  const [state, formAction, pending] = useActionState(
    recalculateVehicleLogbookClosureAction,
    recalculateVehicleLogbookClosureInitialState
  )
  const [period, setPeriod] = useState(initialPreview.period)
  const [preview, setPreview] = useState(initialPreview)
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending && !loadingPreview) onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [loadingPreview, onClose, pending])

  useEffect(() => {
    if (state.success) onClose()
  }, [onClose, state.success])

  async function handlePeriodChange(nextPeriod: string) {
    setPeriod(nextPeriod)
    setLoadingPreview(true)
    try {
      const nextPreview = await getVehicleLogbookClosurePreviewAction(
        vehicleId,
        nextPeriod
      )
      setPreview(nextPreview)
    } catch {
      setPreview((current) => ({
        ...current,
        period: nextPeriod,
        error: 'Náhled uzávěrky se nepodařilo načíst.',
      }))
    } finally {
      setLoadingPreview(false)
    }
  }

  const totalKm = preview.businessKm + preview.privateKm
  const calculatedAt = formatDateTime(preview.calculatedAt)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-zinc-950/45 p-3 backdrop-blur-[5px] sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehicle-logbook-closure-title"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !pending &&
          !loadingPreview
        ) {
          onClose()
        }
      }}
    >
      <div className="vehicle-logbook-page__modal vehicle-logbook-page__closure-modal my-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.97)_0%,rgba(245,248,251,0.94)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.3)] sm:max-h-[calc(100dvh-2.5rem)]">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id="vehicle-logbook-closure-title"
              className="text-xl font-semibold tracking-tight text-gray-900"
            >
              Měsíční uzávěrka
            </h2>
            <p className="mt-1 truncate text-sm text-gray-500">{vehicleLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending || loadingPreview}
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
          <input type="hidden" name="period" value={period} />

          <label className="block min-w-0">
            <span className="vehicle-logbook-page__modal-label">UZAVÍRANÝ MĚSÍC</span>
            <input
              type="month"
              value={period}
              min="2000-01"
              max={currentPeriod}
              disabled={pending || loadingPreview}
              onInput={(event) =>
                void handlePeriodChange(event.currentTarget.value)
              }
              className="filter-date-input vehicle-logbook-page__date-input vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none disabled:opacity-60"
            />
          </label>

          {preview.error ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700"
            >
              {preview.error}
            </div>
          ) : (
            <>
              <div
                data-status={preview.closureStatus}
                className="vehicle-logbook-page__closure-status mt-4 rounded-xl border px-4 py-3"
              >
                <strong>
                  {preview.closureStatus === 'valid'
                    ? 'UZÁVĚRKA JE AKTUÁLNÍ'
                    : preview.closureStatus === 'changed'
                      ? 'DATA SE PO UZÁVĚRCE ZMĚNILA'
                      : 'UZÁVĚRKA ZATÍM NEEXISTUJE'}
                </strong>
                <span>
                  {preview.closureStatus === 'valid'
                    ? `Kontrolní snapshot odpovídá evidenci${calculatedAt ? ` · přepočteno ${calculatedAt}` : ''}.`
                    : preview.closureStatus === 'changed'
                      ? 'Před dalším předáním dat uzávěrku znovu přepočítej.'
                      : `Vytvoří se kontrolní snapshot za ${formatPeriod(period)}.`}
                </span>
              </div>

              {period === currentPeriod ? (
                <div className="vehicle-logbook-page__closure-warning mt-3 rounded-xl border px-4 py-3 text-xs leading-5">
                  Uzavíráš probíhající měsíc. Každá další jízda nebo tankování
                  uzávěrku automaticky označí jako změněnou.
                </div>
              ) : null}

              <div
                aria-busy={loadingPreview}
                className={`vehicle-logbook-page__closure-metrics mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 ${
                  loadingPreview ? 'opacity-45' : ''
                }`}
              >
                <div>
                  <span>ZÁZNAMY JÍZD</span>
                  <strong>{preview.tripCount}</strong>
                </div>
                <div>
                  <span>CELKEM KM</span>
                  <strong>{formatNumber(totalKm)} km</strong>
                </div>
                <div>
                  <span>SLUŽEBNÍ</span>
                  <strong>{formatNumber(preview.businessKm)} km</strong>
                </div>
                <div>
                  <span>SOUKROMÉ</span>
                  <strong>{formatNumber(preview.privateKm)} km</strong>
                </div>
                <div>
                  <span>POČÁTEČNÍ STAV</span>
                  <strong>
                    {preview.openingOdometerKm === null
                      ? '—'
                      : `${formatNumber(preview.openingOdometerKm)} km`}
                  </strong>
                </div>
                <div>
                  <span>KONEČNÝ STAV</span>
                  <strong>
                    {preview.closingOdometerKm === null
                      ? '—'
                      : `${formatNumber(preview.closingOdometerKm)} km`}
                  </strong>
                </div>
                <div>
                  <span>TANKOVÁNÍ</span>
                  <strong>{preview.fuelEntryCount}</strong>
                </div>
                <div>
                  <span>PALIVO S DPH</span>
                  <strong>{formatCurrency(preview.fuelGrossAmount)}</strong>
                </div>
              </div>

              <div className="vehicle-logbook-page__closure-finance mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-xs">
                <span>Bez DPH {formatCurrency(preview.fuelNetAmount)}</span>
                <span>DPH 21 % {formatCurrency(preview.fuelVatAmount)}</span>
                <strong>Celkem {formatCurrency(preview.fuelGrossAmount)}</strong>
              </div>
            </>
          )}

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
              disabled={pending || loadingPreview}
              className="vehicle-logbook-page__modal-cancel inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white/90 px-5 text-xs font-semibold uppercase text-gray-700 disabled:opacity-50"
            >
              ZRUŠIT
            </button>
            <button
              type="submit"
              disabled={pending || loadingPreview || Boolean(preview.error)}
              className="vehicle-logbook-page__primary-action inline-flex h-11 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-6 text-xs font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_rgba(41,128,185,0.24)] disabled:cursor-wait disabled:opacity-55"
            >
              {pending
                ? 'PŘEPOČÍTÁVÁM…'
                : preview.closureStatus === 'none'
                  ? 'VYTVOŘIT UZÁVĚRKU'
                  : 'PŘEPOČÍTAT UZÁVĚRKU'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function MonthlyClosureButton(props: MonthlyClosureButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<VehicleLogbookClosurePreview | null>(
    null
  )

  async function handleOpen() {
    setLoading(true)
    try {
      const nextPreview = await getVehicleLogbookClosurePreviewAction(
        props.vehicleId,
        props.defaultPeriod
      )
      setPreview(nextPreview)
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }

  const label =
    props.status === 'changed'
      ? 'UZÁVĚRKA ZMĚNĚNA'
      : props.status === 'valid'
        ? 'UZÁVĚRKA HOTOVA'
        : 'MĚSÍČNÍ UZÁVĚRKA'

  return (
    <>
      <button
        type="button"
        data-status={props.status}
        disabled={loading}
        onClick={() => void handleOpen()}
        style={
          props.status === 'none'
            ? {
                borderColor: '#6fa9d1',
                background: 'linear-gradient(155deg, #4d90c5 0%, #2f77af 100%)',
                color: '#ffffff',
                boxShadow:
                  'inset 0 1px 0 rgba(255, 255, 255, 0.24), 0 8px 18px rgba(41, 128, 185, 0.22)',
              }
            : undefined
        }
        className="vehicle-logbook-page__closure-button inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border px-4 text-[10px] font-semibold uppercase tracking-[0.06em] transition disabled:cursor-wait disabled:opacity-60 sm:w-auto"
      >
        <span
          aria-hidden
          className="vehicle-logbook-page__closure-dot h-1.5 w-1.5 rounded-full"
          style={props.status === 'none' ? { background: '#d8efff' } : undefined}
        />
        {loading ? 'NAČÍTÁM…' : label}
      </button>

      {open && preview
        ? createPortal(
            <MonthlyClosureModal
              vehicleId={props.vehicleId}
              vehicleLabel={props.vehicleLabel}
              currentPeriod={props.currentPeriod}
              initialPreview={preview}
              onClose={() => setOpen(false)}
            />,
            document.body
          )
        : null}
    </>
  )
}
