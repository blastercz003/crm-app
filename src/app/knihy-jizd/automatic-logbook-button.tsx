'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  confirmAutomaticTripsAction,
  generateAutomaticTripPreviewAction,
  type AutomaticTripDestinationInput,
  type AutomaticTripPreviewResult,
  type ConfirmAutomaticTripsState,
} from './automatic-actions'

export type AutomaticLogbookVehicleOption = {
  id: string
  label: string
  registrationPlate: string
  suggestedOdometerKm: number | null
}

type DestinationDraft = AutomaticTripDestinationInput & {
  id: string
}

type AutomaticLogbookButtonProps = {
  vehicles: AutomaticLogbookVehicleOption[]
  selectedVehicleId: string
  defaultPeriodFrom: string
  defaultPeriodTo: string
}

const confirmAutomaticTripsInitialState: ConfirmAutomaticTripsState = {
  success: false,
  error: null,
  createdTrips: 0,
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatCount(
  count: number,
  forms: [singular: string, few: string, many: string]
) {
  const absolute = Math.abs(count)
  const lastTwo = absolute % 100
  const last = absolute % 10
  const form =
    lastTwo >= 11 && lastTwo <= 14
      ? forms[2]
      : last === 1
        ? forms[0]
        : last >= 2 && last <= 4
          ? forms[1]
          : forms[2]

  return `${formatNumber(count)} ${form}`
}

function isWorkingDay(dateKey: string) {
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay()
  return day >= 1 && day <= 5
}

function AutomaticLogbookModal({
  vehicles,
  selectedVehicleId,
  defaultPeriodFrom,
  defaultPeriodTo,
  onClose,
}: AutomaticLogbookButtonProps & { onClose: () => void }) {
  const router = useRouter()
  const initialVehicle =
    vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0]
  const [vehicleId, setVehicleId] = useState(initialVehicle?.id ?? '')
  const [periodFrom, setPeriodFrom] = useState(defaultPeriodFrom)
  const [periodTo, setPeriodTo] = useState(defaultPeriodTo)
  const [departureCity, setDepartureCity] = useState('')
  const [odometerStart, setOdometerStart] = useState(
    initialVehicle?.suggestedOdometerKm?.toString() ?? ''
  )
  const [odometerEnd, setOdometerEnd] = useState('')
  const [destinations, setDestinations] = useState<DestinationDraft[]>([
    { id: 'destination-1', city: '', visits: 1 },
  ])
  const [preview, setPreview] = useState<AutomaticTripPreviewResult | null>(
    null
  )
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [state, formAction, pending] = useActionState(
    confirmAutomaticTripsAction,
    confirmAutomaticTripsInitialState
  )

  const totalVisits = destinations.reduce(
    (sum, destination) => sum + Math.max(0, Number(destination.visits) || 0),
    0
  )
  const dateValidationError = useMemo(() => {
    if (!preview) return null

    const dates = preview.rows.map((row) => row.date)
    if (new Set(dates).size !== dates.length) {
      return 'Každá návštěva musí mít vlastní datum.'
    }

    if (
      dates.some(
        (date) =>
          !date ||
          date < periodFrom ||
          date > periodTo ||
          !isWorkingDay(date)
      )
    ) {
      return 'Termíny musí být pracovní dny ve zvoleném období.'
    }

    return null
  }, [periodFrom, periodTo, preview])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !generating && !pending) onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [generating, onClose, pending])

  useEffect(() => {
    if (state.success) {
      router.refresh()
      onClose()
    }
  }, [onClose, router, state.success])

  function changeVehicle(nextVehicleId: string) {
    const nextVehicle = vehicles.find((vehicle) => vehicle.id === nextVehicleId)
    setVehicleId(nextVehicleId)
    setOdometerStart(nextVehicle?.suggestedOdometerKm?.toString() ?? '')
    setOdometerEnd('')
    setPreview(null)
    setGenerationError(null)
  }

  function updateDestination(
    id: string,
    changes: Partial<AutomaticTripDestinationInput>
  ) {
    setDestinations((current) =>
      current.map((destination) =>
        destination.id === id ? { ...destination, ...changes } : destination
      )
    )
    setPreview(null)
    setGenerationError(null)
  }

  function addDestination() {
    if (destinations.length >= 15) return
    setDestinations((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        city: '',
        visits: 1,
      },
    ])
  }

  function removeDestination(id: string) {
    if (destinations.length === 1) return
    setDestinations((current) =>
      current.filter((destination) => destination.id !== id)
    )
  }

  async function generatePreview() {
    setGenerationError(null)
    setGenerating(true)

    try {
      const result = await generateAutomaticTripPreviewAction({
        vehicleId,
        periodFrom,
        periodTo,
        departureCity,
        odometerStartKm: Number(odometerStart),
        odometerEndKm: Number(odometerEnd),
        destinations: destinations.map(({ city, visits }) => ({
          city,
          visits: Number(visits),
        })),
      })

      if (!result.success) {
        setPreview(null)
        setGenerationError(result.error)
        return
      }

      setPreview(result)
    } catch {
      setPreview(null)
      setGenerationError(
        'Mapová služba není dostupná. Generování bylo zastaveno.'
      )
    } finally {
      setGenerating(false)
    }
  }

  function changePreviewDate(rowId: string, date: string) {
    setPreview((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.id === rowId ? { ...row, date } : row
            ),
          }
        : current
    )
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-zinc-950/50 p-2 backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehicle-logbook-automatic-title"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !generating &&
          !pending
        ) {
          onClose()
        }
      }}
    >
      <div className="vehicle-logbook-page__modal vehicle-logbook-page__automatic-modal my-auto flex max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.97)_0%,rgba(245,248,251,0.94)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.3)] sm:max-h-[calc(100dvh-2rem)]">
        <div
          className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 sm:px-6"
          style={{ borderColor: 'var(--surface-border)' }}
        >
          <div className="min-w-0">
            <h2
              id="vehicle-logbook-automatic-title"
              className="text-xl font-semibold tracking-tight text-gray-900"
            >
              Automatická kniha jízd
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Zpětná rekonstrukce skutečně uskutečněných pracovních cest
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={generating || pending}
            aria-label="Zavřít"
            className="vehicle-logbook-page__modal-close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white/90 text-gray-700 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {!preview ? (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="vehicle-logbook-page__automatic-section rounded-2xl border border-gray-200/80 bg-white/48 p-4">
                  <div className="vehicle-logbook-page__modal-label">
                    VOZIDLO A OBDOBÍ
                  </div>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <label className="min-w-0 sm:col-span-2">
                      <span className="vehicle-logbook-page__modal-label">VOZIDLO</span>
                      <div className="relative mt-2">
                        <select
                          value={vehicleId}
                          onChange={(event) => changeVehicle(event.target.value)}
                          className="vehicle-logbook-page__input h-11 w-full appearance-none rounded-xl border border-gray-200 bg-white/95 px-3 pr-10 text-sm text-gray-900 outline-none"
                        >
                          {vehicles.map((vehicle) => (
                            <option key={vehicle.id} value={vehicle.id}>
                              {vehicle.label} · {vehicle.registrationPlate}
                            </option>
                          ))}
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
                      <span className="vehicle-logbook-page__modal-label">OD</span>
                      <input
                        type="date"
                        value={periodFrom}
                        max={periodTo}
                        onChange={(event) => {
                          setPeriodFrom(event.target.value)
                          setGenerationError(null)
                        }}
                        className="filter-date-input vehicle-logbook-page__date-input vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="vehicle-logbook-page__modal-label">DO</span>
                      <input
                        type="date"
                        value={periodTo}
                        min={periodFrom}
                        max={defaultPeriodTo}
                        onChange={(event) => {
                          setPeriodTo(event.target.value)
                          setGenerationError(null)
                        }}
                        className="filter-date-input vehicle-logbook-page__date-input vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none"
                      />
                    </label>
                    <label className="min-w-0 sm:col-span-2">
                      <span className="vehicle-logbook-page__modal-label">
                        VÝJEZDOVÉ MÍSTO
                      </span>
                      <input
                        type="text"
                        value={departureCity}
                        maxLength={120}
                        onChange={(event) => {
                          setDepartureCity(event.target.value)
                          setGenerationError(null)
                        }}
                        placeholder="Např. Harrachov"
                        className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="vehicle-logbook-page__modal-label">
                        POČÁTEČNÍ TACHOMETR
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="9999999"
                        step="1"
                        value={odometerStart}
                        onChange={(event) => {
                          setOdometerStart(event.target.value)
                          setGenerationError(null)
                        }}
                        className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="vehicle-logbook-page__modal-label">
                        KONEČNÝ TACHOMETR
                      </span>
                      <input
                        type="number"
                        min="1"
                        max="9999999"
                        step="1"
                        value={odometerEnd}
                        onChange={(event) => {
                          setOdometerEnd(event.target.value)
                          setGenerationError(null)
                        }}
                        placeholder="Stav poslední jízdy"
                        className="vehicle-logbook-page__input mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400"
                      />
                    </label>
                  </div>
                </div>

                <div className="vehicle-logbook-page__automatic-section rounded-2xl border border-gray-200/80 bg-white/48 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="vehicle-logbook-page__modal-label">
                      NAVŠTÍVENÁ MĚSTA
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {formatCount(totalVisits, [
                        'návštěva',
                        'návštěvy',
                        'návštěv',
                      ])}
                      {' · '}
                      {formatCount(totalVisits * 2, [
                        'jízda',
                        'jízdy',
                        'jízd',
                      ])}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2">
                    {destinations.map((destination, index) => (
                      <div
                        key={destination.id}
                        className="grid grid-cols-[minmax(0,1fr)_92px_36px] gap-2"
                      >
                        <label className="min-w-0">
                          <span className="sr-only">Cílové město {index + 1}</span>
                          <input
                            type="text"
                            value={destination.city}
                            maxLength={120}
                            onChange={(event) =>
                              updateDestination(destination.id, {
                                city: event.target.value,
                              })
                            }
                            placeholder="Cílové město"
                            className="vehicle-logbook-page__input h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400"
                          />
                        </label>
                        <label className="min-w-0">
                          <span className="sr-only">
                            Počet návštěv města {index + 1}
                          </span>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            step="1"
                            value={destination.visits}
                            onChange={(event) =>
                              updateDestination(destination.id, {
                                visits: Number(event.target.value),
                              })
                            }
                            title="Počet návštěv"
                            className="vehicle-logbook-page__input h-11 w-full rounded-xl border border-gray-200 bg-white/95 px-3 text-center text-sm text-gray-900 outline-none"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={destinations.length === 1}
                          onClick={() => removeDestination(destination.id)}
                          aria-label={`Odebrat město ${index + 1}`}
                          className="vehicle-logbook-page__modal-close inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white/90 text-gray-500 disabled:opacity-30"
                        >
                          −
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    disabled={destinations.length >= 15}
                    onClick={addDestination}
                    className="vehicle-logbook-page__automatic-add mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl border border-dashed border-[#91bddc] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#2f77af] disabled:opacity-40"
                  >
                    ＋ PŘIDAT DALŠÍ MĚSTO
                  </button>

                  <div className="vehicle-logbook-page__automatic-info mt-4 rounded-xl border px-4 py-3 text-xs leading-5 text-gray-600">
                    Každá návštěva vytvoří dvě služební jízdy: z výjezdového
                    místa do cílového města a zpět. Návštěvy se náhodně rozloží
                    pouze do pracovních dnů.
                  </div>
                </div>
              </div>

              {generationError ? (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700"
                >
                  {generationError}
                </div>
              ) : null}

              <div
                className="mt-5 flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: 'var(--surface-border)' }}
              >
                <p className="text-xs leading-5 text-gray-500">
                  Mapová data{' '}
                  <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-[#2f77af]"
                  >
                    © OpenStreetMap contributors
                  </a>
                  {' · '}geokódování Nominatim · trasy OSRM, vždy nejrychlejší
                  automobilová varianta.
                </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={generating}
                    className="vehicle-logbook-page__modal-cancel inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white/90 px-5 text-xs font-semibold uppercase text-gray-700 disabled:opacity-50"
                  >
                    ZRUŠIT
                  </button>
                  <button
                    type="button"
                    onClick={() => void generatePreview()}
                    disabled={generating}
                    className="vehicle-logbook-page__primary-action inline-flex h-11 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-6 text-xs font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_rgba(41,128,185,0.24)] disabled:cursor-wait disabled:opacity-55"
                  >
                    {generating ? 'POČÍTÁM TRASY…' : 'GENEROVAT NÁVRH'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <form action={formAction}>
              <input type="hidden" name="vehicle_id" value={vehicleId} />
              <input type="hidden" name="period_from" value={periodFrom} />
              <input type="hidden" name="period_to" value={periodTo} />
              <input
                type="hidden"
                name="departure_city"
                value={departureCity}
              />
              <input
                type="hidden"
                name="odometer_start_km"
                value={odometerStart}
              />
              <input
                type="hidden"
                name="odometer_end_km"
                value={odometerEnd}
              />
              <input
                type="hidden"
                name="destinations_json"
                value={JSON.stringify(preview.destinations)}
              />
              <input
                type="hidden"
                name="rows_json"
                value={JSON.stringify(preview.rows)}
              />

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="vehicle-logbook-page__automatic-metric">
                  <span>NÁVŠTĚVY / JÍZDY</span>
                  <strong>
                    {preview.rows.length} / {preview.rows.length * 2}
                  </strong>
                </div>
                <div className="vehicle-logbook-page__automatic-metric">
                  <span>TRASY DLE MAPY</span>
                  <strong>{formatNumber(preview.mapTotalKm)} km</strong>
                </div>
                <div className="vehicle-logbook-page__automatic-metric">
                  <span>ROZDÍL TACHOMETRU</span>
                  <strong>{formatNumber(preview.assignedTotalKm)} km</strong>
                </div>
                <div className="vehicle-logbook-page__automatic-metric">
                  <span>ODCHYLKA</span>
                  <strong>
                    {preview.differenceKm > 0 ? '+' : ''}
                    {formatNumber(preview.differenceKm)} km
                  </strong>
                </div>
              </div>

              {preview.differenceKm !== 0 ? (
                <div className="vehicle-logbook-page__automatic-warning mt-3 rounded-xl border px-4 py-3 text-xs leading-5">
                  Rozdíl mezi mapovým výpočtem a tachometrem byl poměrně
                  rozdělen mezi všechny jízdy. Konečný stav přesně odpovídá
                  zadaným {formatNumber(Number(odometerEnd))} km.
                </div>
              ) : null}

              <div className="mt-4 flex flex-col gap-2">
                {preview.rows.map((row, index) => (
                  <article
                    key={row.id}
                    className="vehicle-logbook-page__automatic-row grid gap-3 rounded-2xl border p-3 sm:grid-cols-[150px_minmax(160px,1fr)_minmax(190px,1.2fr)_minmax(180px,1fr)] sm:items-center"
                  >
                    <label className="min-w-0">
                      <span className="vehicle-logbook-page__modal-label">
                        NÁVŠTĚVA {index + 1}
                      </span>
                      <input
                        type="date"
                        value={row.date}
                        min={periodFrom}
                        max={periodTo}
                        onInput={(event) =>
                          changePreviewDate(row.id, event.currentTarget.value)
                        }
                        className="filter-date-input vehicle-logbook-page__date-input vehicle-logbook-page__input mt-1.5 h-10 w-full rounded-xl border border-gray-200 bg-white/95 px-2 text-xs text-gray-900 outline-none"
                      />
                    </label>
                    <div className="min-w-0">
                      <span>CÍLOVÉ MĚSTO</span>
                      <strong className="truncate">{row.city}</strong>
                    </div>
                    <div className="min-w-0">
                      <span>NEJRYCHLEJŠÍ TRASA DLE MAPY</span>
                      <strong>
                        {row.outboundMapKm} km tam · {row.returnMapKm} km zpět
                      </strong>
                    </div>
                    <div className="min-w-0">
                      <span>ROZDĚLENO Z TACHOMETRU</span>
                      <strong>
                        {row.outboundKm} km tam · {row.returnKm} km zpět
                      </strong>
                    </div>
                  </article>
                ))}
              </div>

              {dateValidationError ? (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700"
                >
                  {dateValidationError}
                </div>
              ) : null}

              {state.error ? (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700"
                >
                  {state.error}
                </div>
              ) : null}

              <div
                className="mt-5 flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: 'var(--surface-border)' }}
              >
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  disabled={pending || generating}
                  className="vehicle-logbook-page__modal-cancel inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white/90 px-5 text-xs font-semibold uppercase text-gray-700 disabled:opacity-50"
                >
                  ZPĚT K ZADÁNÍ
                </button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void generatePreview()}
                    disabled={pending || generating}
                    className="vehicle-logbook-page__closure-button inline-flex h-11 items-center justify-center rounded-xl border px-5 text-xs font-semibold uppercase disabled:opacity-50"
                  >
                    {generating ? 'PŘEPOČÍTÁVÁM…' : 'ZNOVU GENEROVAT'}
                  </button>
                  <button
                    type="submit"
                    disabled={pending || generating || Boolean(dateValidationError)}
                    className="vehicle-logbook-page__primary-action inline-flex h-11 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-6 text-xs font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_rgba(41,128,185,0.24)] disabled:cursor-wait disabled:opacity-55"
                  >
                    {pending
                      ? 'UKLÁDÁM…'
                      : `ULOŽIT ${formatCount(preview.rows.length * 2, [
                          'JÍZDU',
                          'JÍZDY',
                          'JÍZD',
                        ])}`}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export function AutomaticLogbookButton(props: AutomaticLogbookButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        disabled={props.vehicles.length === 0}
        onClick={() => setOpen(true)}
        className="vehicle-logbook-page__secondary-action inline-flex min-h-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(238,242,247,0.84)_100%)] px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-55"
      >
        <span style={{ color: 'light-dark(#374151, #f8fbff)' }}>
          AUTOMAT
        </span>
      </button>

      {open
        ? createPortal(
            <AutomaticLogbookModal
              {...props}
              onClose={() => setOpen(false)}
            />,
            document.body
          )
        : null}
    </>
  )
}
