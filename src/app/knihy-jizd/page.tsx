import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'
import { createClient } from '@/lib/supabase/server'
import { parseDateKey } from '@/lib/vehicle-logbook/date'
import {
  AutomaticLogbookButton,
  type AutomaticLogbookVehicleOption,
} from './automatic-logbook-button'
import { FuelEntryButton } from './fuel-entry-button'
import { InitialOdometerButton } from './initial-odometer-button'
import { MonthlyClosureButton } from './monthly-closure-button'
import { NewTripButton } from './new-trip-button'
import {
  VehicleLogbookReportsButton,
  type VehicleLogbookReportVehicleOption,
} from './reports-button'
import {
  VehicleSelector,
  type VehicleSelectorOption,
} from './vehicle-selector'

export const metadata: Metadata = {
  title: 'Knihy jízd',
}

export const dynamic = 'force-dynamic'

type VehicleLogbookPageProps = {
  searchParams?: Promise<{
    vehicle?: string
    from?: string
    to?: string
    usage?: string
    type?: string
    q?: string
    view?: string
    energy?: string
  }>
}

type VehicleLogbookProfile = {
  role: string | null
}

type VehicleLogbookVehicle = {
  id: string
  asset_id: string | null
  asset_name: string
  registration_plate: string
  vin: string | null
  brand: string | null
  model: string | null
  year_of_manufacture: number | null
  insurance_expires_on: string | null
  stk_expires_on: string | null
  initial_odometer_km: number | null
  initial_odometer_recorded_on: string | null
  source_status: string
  is_active: boolean
}

type VehicleLogbookEntrySummary = {
  id: string
  trip_date: string
  day_sequence: number
  entry_type: 'trip' | 'daily_summary'
  usage_type: 'business' | 'private' | 'mixed'
  source_type: 'manual' | 'automatic_reconstruction'
  origin: string
  destination: string
  purpose: string
  note: string | null
  odometer_start_km: number
  odometer_end_km: number
  business_km: number
  private_km: number
  distance_km: number
}

type VehicleLogbookFuelSummary = {
  id: string
  fueled_on: string
  odometer_km: number
  energy_type: 'petrol' | 'diesel' | 'electricity'
  quantity: number | string
  unit: 'litre' | 'kwh'
  net_amount: number | string
  vat_amount: number | string
  gross_amount: number | string
  supplier: string | null
  document_number: string | null
  is_full_tank: boolean
  note: string | null
  vehicle_logbook_fuel_attachments: Array<{
    id: string
    file_name: string
  }>
}

type VehicleLogbookClosureSummary = {
  id: string
  period_year: number
  period_month: number
  changed_after_closure: boolean
}

type UsageFilter = '' | 'business' | 'private' | 'mixed'
type EntryTypeFilter = '' | 'trip' | 'daily_summary'
type EnergyFilter = '' | 'petrol' | 'diesel' | 'electricity'
type ContentView = 'trips' | 'fuel'

const secondaryActionClass =
  'vehicle-logbook-page__secondary-action inline-flex min-h-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(238,242,247,0.84)_100%)] px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]'

function getPragueDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function getPeriodRanges(todayKey: string) {
  const [year, month] = todayKey.split('-').map(Number)
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  const quarterStart = `${year}-${String(quarterStartMonth).padStart(2, '0')}-01`
  const quarterEnd = new Date(Date.UTC(year, quarterStartMonth + 2, 0))
    .toISOString()
    .slice(0, 10)

  return {
    month: { from: monthStart, to: monthEnd },
    quarter: { from: quarterStart, to: quarterEnd },
    year: { from: `${year}-01-01`, to: `${year}-12-31` },
  }
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ')
    .trim()
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

function formatDate(value: string | null) {
  if (!value) return '—'

  const [year, month, day] = value.split('-')
  return `${Number(day)}. ${Number(month)}. ${year}`
}

function getVehicleDisplayName(vehicle: VehicleLogbookVehicle) {
  return [vehicle.brand, vehicle.model].filter(Boolean).join(' ').trim() || vehicle.asset_name
}

function buildHref(
  current: URLSearchParams,
  changes: Record<string, string | null>
) {
  const params = new URLSearchParams(current)

  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') {
      params.delete(key)
    } else {
      params.set(key, value)
    }
  }

  const query = params.toString()
  return query ? `/knihy-jizd?${query}` : '/knihy-jizd'
}

function isUsageFilter(value: string | undefined): value is UsageFilter {
  return value === 'business' || value === 'private' || value === 'mixed'
}

function isEntryTypeFilter(value: string | undefined): value is EntryTypeFilter {
  return value === 'trip' || value === 'daily_summary'
}

function isContentView(value: string | undefined): value is ContentView {
  return value === 'fuel'
}

function isEnergyFilter(value: string | undefined): value is EnergyFilter {
  return value === 'petrol' || value === 'diesel' || value === 'electricity'
}

function getEntryTypeLabel(entryType: VehicleLogbookEntrySummary['entry_type']) {
  return entryType === 'daily_summary' ? 'DENNÍ SOUHRN' : 'JÍZDA'
}

function getUsageLabel(usageType: VehicleLogbookEntrySummary['usage_type']) {
  if (usageType === 'private') return 'SOUKROMÉ'
  if (usageType === 'mixed') return 'SMÍŠENÉ'
  return 'SLUŽEBNÍ'
}

function TripEntriesList({ entries }: { entries: VehicleLogbookEntrySummary[] }) {
  if (entries.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
        <span className="vehicle-logbook-page__empty-icon inline-flex h-16 w-16 items-center justify-center rounded-[20px] border border-[#8dbfe0]/80 bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_24px_rgba(41,128,185,0.24)]">
          <svg
            viewBox="0 0 24 24"
            className="h-8 w-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden
          >
            <path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z" />
            <path d="M17 7h2v12.5h-9" />
            <path d="M8 9h6M8 12h6M8 15h4" />
          </svg>
        </span>
        <h2 className="mt-5 text-xl font-semibold tracking-tight text-gray-900">
          Zatím tu nejsou žádné jízdy
        </h2>
        <p className="mt-2 max-w-lg text-sm leading-6 text-gray-500">
          Pro vybrané období a filtry nebyl nalezen žádný záznam.
        </p>
      </div>
    )
  }

  return (
    <div className="pt-4">
      <div className="vehicle-logbook-page__trip-table hidden overflow-hidden rounded-2xl border border-white/75 md:block">
        <div className="vehicle-logbook-page__trip-table-head grid grid-cols-[112px_minmax(250px,1.5fr)_minmax(190px,1fr)_120px_130px] gap-4 px-4 py-3">
          <span>DATUM</span>
          <span>TRASA</span>
          <span>ÚČEL</span>
          <span>VYUŽITÍ</span>
          <span className="text-right">VZDÁLENOST</span>
        </div>
        <div>
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="vehicle-logbook-page__trip-row grid grid-cols-[112px_minmax(250px,1.5fr)_minmax(190px,1fr)_120px_130px] items-center gap-4 border-t border-gray-100 px-4 py-3"
            >
              <div>
                <div className="text-sm font-semibold text-gray-900">
                  {formatDate(entry.trip_date)}
                </div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                  {getEntryTypeLabel(entry.entry_type)} · {entry.day_sequence}.
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900">
                  <span className="truncate">{entry.origin}</span>
                  <span className="shrink-0 text-[#4d90c5]">→</span>
                  <span className="truncate">{entry.destination}</span>
                </div>
                <div className="mt-1 truncate text-xs text-gray-500">
                  {formatNumber(entry.odometer_start_km)}–{formatNumber(entry.odometer_end_km)} km
                  {entry.source_type === 'automatic_reconstruction'
                    ? ' · automaticky doplněno'
                    : ''}
                </div>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm text-gray-700" title={entry.purpose}>
                  {entry.purpose}
                </div>
                {entry.note ? (
                  <div className="mt-1 truncate text-xs text-gray-400" title={entry.note}>
                    {entry.note}
                  </div>
                ) : null}
              </div>
              <div>
                <span
                  data-usage={entry.usage_type}
                  className="vehicle-logbook-page__usage-badge"
                >
                  {getUsageLabel(entry.usage_type)}
                </span>
              </div>
              <div className="text-right">
                <div className="text-base font-semibold text-gray-900">
                  {formatNumber(entry.distance_km)} km
                </div>
                {entry.usage_type === 'mixed' ? (
                  <div className="mt-1 text-[10px] text-gray-500">
                    S {formatNumber(entry.business_km)} · P {formatNumber(entry.private_km)}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:hidden">
        {entries.map((entry) => (
          <article
            key={entry.id}
            className="vehicle-logbook-page__trip-mobile-card rounded-2xl border border-white/75 bg-white/58 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">
                  {formatDate(entry.trip_date)}
                </div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                  {getEntryTypeLabel(entry.entry_type)} · {entry.day_sequence}.
                </div>
              </div>
              <span
                data-usage={entry.usage_type}
                className="vehicle-logbook-page__usage-badge"
              >
                {getUsageLabel(entry.usage_type)}
              </span>
            </div>
            <div className="mt-3 flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900">
              <span className="truncate">{entry.origin}</span>
              <span className="shrink-0 text-[#4d90c5]">→</span>
              <span className="truncate">{entry.destination}</span>
            </div>
            <div className="mt-2 text-sm text-gray-600">{entry.purpose}</div>
            {entry.note ? (
              <div className="mt-1 text-xs text-gray-400">{entry.note}</div>
            ) : null}
            <div className="mt-3 flex items-end justify-between gap-3 border-t border-gray-100 pt-3">
              <div className="text-[11px] text-gray-500">
                {formatNumber(entry.odometer_start_km)}–{formatNumber(entry.odometer_end_km)} km
              </div>
              <div className="text-base font-semibold text-gray-900">
                {formatNumber(entry.distance_km)} km
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function getEnergyTypeLabel(
  energyType: VehicleLogbookFuelSummary['energy_type']
) {
  if (energyType === 'diesel') return 'NAFTA'
  if (energyType === 'electricity') return 'ELEKTŘINA'
  return 'BENZÍN'
}

function formatQuantity(entry: VehicleLogbookFuelSummary) {
  const value = new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 3,
  }).format(Number(entry.quantity))
  return `${value} ${entry.unit === 'kwh' ? 'kWh' : 'l'}`
}

function FuelEntriesList({
  entries,
}: {
  entries: VehicleLogbookFuelSummary[]
}) {
  if (entries.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
        <span className="vehicle-logbook-page__empty-icon inline-flex h-16 w-16 items-center justify-center rounded-[20px] border border-[#8dbfe0]/80 bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_24px_rgba(41,128,185,0.24)]">
          <svg
            viewBox="0 0 24 24"
            className="h-8 w-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden
          >
            <path d="M6 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" />
            <path d="M4 21h15M9 7h5v5H9zM17 8h2l2 3v7a2 2 0 0 1-4 0v-4" />
          </svg>
        </span>
        <h2 className="mt-5 text-xl font-semibold tracking-tight text-gray-900">
          Zatím tu není žádné tankování
        </h2>
        <p className="mt-2 max-w-lg text-sm leading-6 text-gray-500">
          Pro vybrané období nebylo nalezeno tankování ani nabíjení.
        </p>
      </div>
    )
  }

  const energyTypes = new Set(entries.map((entry) => entry.energy_type))
  const singleEnergyType =
    energyTypes.size === 1 ? entries[0].energy_type : null
  const totalQuantity = entries.reduce(
    (sum, entry) => sum + Number(entry.quantity),
    0
  )
  const totalGross = entries.reduce(
    (sum, entry) => sum + Number(entry.gross_amount),
    0
  )
  const fullTankEntries =
    singleEnergyType && singleEnergyType !== 'electricity'
      ? entries
          .filter((entry) => entry.is_full_tank)
          .sort((left, right) => left.odometer_km - right.odometer_km)
      : []
  const firstFullTank = fullTankEntries[0]
  const lastFullTank = fullTankEntries.at(-1)
  const consumptionDistance =
    firstFullTank && lastFullTank
      ? lastFullTank.odometer_km - firstFullTank.odometer_km
      : 0
  const consumedQuantity =
    firstFullTank && lastFullTank && consumptionDistance > 0
      ? entries
          .filter(
            (entry) =>
              entry.energy_type === singleEnergyType &&
              entry.odometer_km > firstFullTank.odometer_km &&
              entry.odometer_km <= lastFullTank.odometer_km
          )
          .reduce((sum, entry) => sum + Number(entry.quantity), 0)
      : 0
  const measuredConsumption =
    consumptionDistance > 0 && consumedQuantity > 0
      ? (consumedQuantity / consumptionDistance) * 100
      : null
  const quantityUnit =
    singleEnergyType === 'electricity' ? 'kWh' : singleEnergyType ? 'l' : ''

  return (
    <div className="pt-4">
      <div className="vehicle-logbook-page__fuel-metrics mb-3 grid grid-cols-2 gap-3 rounded-2xl border border-white/75 bg-white/45 p-3 sm:grid-cols-4">
        <div>
          <span>CELKOVÉ MNOŽSTVÍ</span>
          <strong>
            {singleEnergyType
              ? `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 3 }).format(totalQuantity)} ${quantityUnit}`
              : 'Více druhů'}
          </strong>
        </div>
        <div>
          <span>PRŮMĚRNÁ CENA</span>
          <strong>
            {singleEnergyType && totalQuantity > 0
              ? `${formatCurrency(totalGross / totalQuantity)} / ${quantityUnit}`
              : '—'}
          </strong>
        </div>
        <div>
          <span>PLNÉ NÁDRŽE</span>
          <strong>
            {singleEnergyType === 'electricity' ? 'Nevztahuje se' : fullTankEntries.length}
          </strong>
        </div>
        <div>
          <span>SKUTEČNÁ SPOTŘEBA</span>
          <strong>
            {measuredConsumption === null
              ? 'Zatím nelze určit'
              : `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(measuredConsumption)} l / 100 km`}
          </strong>
        </div>
      </div>

      <div className="vehicle-logbook-page__trip-table hidden overflow-hidden rounded-2xl border border-white/75 lg:block">
        <div className="vehicle-logbook-page__trip-table-head grid grid-cols-[110px_130px_120px_minmax(190px,1fr)_120px_190px] gap-4 px-4 py-3">
          <span>DATUM</span>
          <span>ENERGIE</span>
          <span>MNOŽSTVÍ</span>
          <span>DODAVATEL / DOKLAD</span>
          <span>TACHOMETR</span>
          <span className="text-right">CENA</span>
        </div>
        <div>
          {entries.map((entry) => {
            const attachment = entry.vehicle_logbook_fuel_attachments[0]

            return (
              <article
                key={entry.id}
                className="vehicle-logbook-page__trip-row grid grid-cols-[110px_130px_120px_minmax(190px,1fr)_120px_190px] items-center gap-4 border-t border-gray-100 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {formatDate(entry.fueled_on)}
                  </div>
                  {entry.is_full_tank ? (
                    <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#2f77af]">
                      PLNÁ NÁDRŽ
                    </div>
                  ) : null}
                </div>
                <div>
                  <span
                    data-energy={entry.energy_type}
                    className="vehicle-logbook-page__energy-badge"
                  >
                    {getEnergyTypeLabel(entry.energy_type)}
                  </span>
                </div>
                <div className="text-sm font-semibold text-gray-900">
                  {formatQuantity(entry)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm text-gray-700">
                    {entry.supplier ?? 'Dodavatel neuveden'}
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-gray-400">
                    <span className="truncate">
                      {entry.document_number
                        ? `Doklad ${entry.document_number}`
                        : 'Bez čísla dokladu'}
                    </span>
                    {attachment ? (
                      <Link
                        href={`/knihy-jizd/doklady/${attachment.id}`}
                        target="_blank"
                        className="shrink-0 font-semibold text-[#2f77af]"
                      >
                        SOUBOR
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="text-sm text-gray-700">
                  {formatNumber(entry.odometer_km)} km
                </div>
                <div className="text-right">
                  <div className="text-base font-semibold text-gray-900">
                    {formatCurrency(Number(entry.gross_amount))}
                  </div>
                  <div className="mt-1 text-[10px] text-gray-500">
                    bez DPH {formatCurrency(Number(entry.net_amount))} · DPH{' '}
                    {formatCurrency(Number(entry.vat_amount))}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>

      <div className="grid gap-3 lg:hidden">
        {entries.map((entry) => {
          const attachment = entry.vehicle_logbook_fuel_attachments[0]

          return (
            <article
              key={entry.id}
              className="vehicle-logbook-page__trip-mobile-card rounded-2xl border border-white/75 bg-white/58 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {formatDate(entry.fueled_on)}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {formatNumber(entry.odometer_km)} km
                  </div>
                </div>
                <span
                  data-energy={entry.energy_type}
                  className="vehicle-logbook-page__energy-badge"
                >
                  {getEnergyTypeLabel(entry.energy_type)}
                </span>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900">
                  {formatQuantity(entry)}
                </div>
                <div className="text-lg font-semibold text-gray-900">
                  {formatCurrency(Number(entry.gross_amount))}
                </div>
              </div>
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="text-sm text-gray-700">
                  {entry.supplier ?? 'Dodavatel neuveden'}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  <span>Bez DPH {formatCurrency(Number(entry.net_amount))}</span>
                  <span>DPH {formatCurrency(Number(entry.vat_amount))}</span>
                  {entry.is_full_tank ? (
                    <span className="font-semibold text-[#2f77af]">PLNÁ NÁDRŽ</span>
                  ) : null}
                  {attachment ? (
                    <Link
                      href={`/knihy-jizd/doklady/${attachment.id}`}
                      target="_blank"
                      className="font-semibold text-[#2f77af]"
                    >
                      OTEVŘÍT DOKLAD
                    </Link>
                  ) : null}
                </div>
              </div>
              {entry.note ? (
                <div className="mt-2 text-xs text-gray-400">{entry.note}</div>
              ) : null}
            </article>
          )
        })}
      </div>
    </div>
  )
}

export default async function VehicleLogbookPage({
  searchParams,
}: VehicleLogbookPageProps) {
  const supabase = await createClient()
  const params = searchParams ? await searchParams : {}
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<VehicleLogbookProfile>()

  if (profileError) {
    throw new Error(`Nepodařilo se ověřit přístup ke Knihám jízd: ${profileError.message}`)
  }

  if (profile?.role !== 'admin') {
    redirect('/dashboard')
  }

  const { data: vehicleRows, error: vehiclesError } = await supabase
    .from('vehicle_logbook_vehicles')
    .select(
      'id, asset_id, asset_name, registration_plate, vin, brand, model, year_of_manufacture, insurance_expires_on, stk_expires_on, initial_odometer_km, initial_odometer_recorded_on, source_status, is_active'
    )
    .order('asset_name', { ascending: true })
    .returns<VehicleLogbookVehicle[]>()

  if (vehiclesError) {
    throw new Error(`Nepodařilo se načíst vozidla pro Knihy jízd: ${vehiclesError.message}`)
  }

  const reportVehicleRows = vehicleRows ?? []
  const vehicles = reportVehicleRows.filter((vehicle) => vehicle.is_active)
  const requestedVehicle = params.vehicle?.trim() ?? ''
  const requestedVehicleExists = vehicles.some((vehicle) => vehicle.id === requestedVehicle)
  const selectedVehicle =
    vehicles.find((vehicle) => vehicle.id === requestedVehicle) ?? vehicles[0] ?? null
  const selectionWasExplicit = requestedVehicle.length > 0 && requestedVehicleExists
  const todayKey = getPragueDateKey()
  const ranges = getPeriodRanges(todayKey)
  const fromDate = parseDateKey(params.from, ranges.month.from)
  const requestedToDate = parseDateKey(params.to, ranges.month.to)
  const toDate = requestedToDate < fromDate ? fromDate : requestedToDate
  const usage = isUsageFilter(params.usage) ? params.usage : ''
  const entryType = isEntryTypeFilter(params.type) ? params.type : ''
  const view: ContentView = isContentView(params.view) ? 'fuel' : 'trips'
  const energy = isEnergyFilter(params.energy) ? params.energy : ''
  const search = params.q?.trim().slice(0, 120) ?? ''

  let entries: VehicleLogbookEntrySummary[] = []
  let fuelEntries: VehicleLogbookFuelSummary[] = []
  let closures: VehicleLogbookClosureSummary[] = []
  let latestEntry: Pick<
    VehicleLogbookEntrySummary,
    'trip_date' | 'day_sequence' | 'odometer_end_km'
  > | null = null

  if (selectedVehicle) {
    let entryQuery = supabase
      .from('vehicle_logbook_entries')
      .select(
        'id, trip_date, day_sequence, entry_type, usage_type, source_type, origin, destination, purpose, note, odometer_start_km, odometer_end_km, business_km, private_km, distance_km'
      )
      .eq('vehicle_id', selectedVehicle.id)
      .is('deleted_at', null)
      .gte('trip_date', fromDate)
      .lte('trip_date', toDate)
      .order('trip_date', { ascending: false })
      .order('day_sequence', { ascending: false })

    if (usage) entryQuery = entryQuery.eq('usage_type', usage)
    if (entryType) entryQuery = entryQuery.eq('entry_type', entryType)

    let fuelQuery = supabase
      .from('vehicle_logbook_fuel_entries')
      .select(
        'id, fueled_on, odometer_km, energy_type, quantity, unit, net_amount, vat_amount, gross_amount, supplier, document_number, is_full_tank, note, vehicle_logbook_fuel_attachments(id, file_name)'
      )
      .eq('vehicle_id', selectedVehicle.id)
      .is('deleted_at', null)
      .gte('fueled_on', fromDate)
      .lte('fueled_on', toDate)
      .order('fueled_on', { ascending: false })

    if (energy) fuelQuery = fuelQuery.eq('energy_type', energy)

    const [entriesResponse, fuelResponse, closuresResponse, latestEntryResponse] =
      await Promise.all([
        entryQuery.returns<VehicleLogbookEntrySummary[]>(),
        fuelQuery.returns<VehicleLogbookFuelSummary[]>(),
        supabase
          .from('vehicle_logbook_monthly_closures')
          .select('id, period_year, period_month, changed_after_closure')
          .eq('vehicle_id', selectedVehicle.id)
          .returns<VehicleLogbookClosureSummary[]>(),
        supabase
          .from('vehicle_logbook_entries')
          .select('trip_date, day_sequence, odometer_end_km')
          .eq('vehicle_id', selectedVehicle.id)
          .is('deleted_at', null)
          .order('trip_date', { ascending: false })
          .order('day_sequence', { ascending: false })
          .limit(1)
          .maybeSingle<
            Pick<
              VehicleLogbookEntrySummary,
              'trip_date' | 'day_sequence' | 'odometer_end_km'
            >
          >(),
      ])

    const firstError =
      entriesResponse.error ??
      fuelResponse.error ??
      closuresResponse.error ??
      latestEntryResponse.error

    if (firstError) {
      throw new Error(`Nepodařilo se načíst provozní souhrn: ${firstError.message}`)
    }

    entries = entriesResponse.data ?? []
    fuelEntries = fuelResponse.data ?? []
    closures = closuresResponse.data ?? []
    latestEntry = latestEntryResponse.data ?? null
  }

  if (search) {
    const normalizedSearch = normalizeSearch(search)
    if (view === 'trips') {
      entries = entries.filter((entry) =>
        normalizeSearch(
          `${entry.origin} ${entry.destination} ${entry.purpose} ${entry.note ?? ''}`
        ).includes(normalizedSearch)
      )
    } else {
      fuelEntries = fuelEntries.filter((entry) =>
        normalizeSearch(
          `${entry.supplier ?? ''} ${entry.document_number ?? ''} ${entry.note ?? ''}`
        ).includes(normalizedSearch)
      )
    }
  }

  const businessKm = entries.reduce((sum, entry) => sum + Number(entry.business_km), 0)
  const privateKm = entries.reduce((sum, entry) => sum + Number(entry.private_km), 0)
  const totalKm = businessKm + privateKm
  const businessShare = totalKm > 0 ? Math.round((businessKm / totalKm) * 100) : 0
  const fuelNet = fuelEntries.reduce((sum, entry) => sum + Number(entry.net_amount), 0)
  const fuelVat = fuelEntries.reduce((sum, entry) => sum + Number(entry.vat_amount), 0)
  const fuelGross = fuelEntries.reduce((sum, entry) => sum + Number(entry.gross_amount), 0)
  const currentOdometer =
    latestEntry?.odometer_end_km ?? selectedVehicle?.initial_odometer_km ?? null
  const fromParts = fromDate.split('-').map(Number)
  const toParts = toDate.split('-').map(Number)
  const closuresInPeriod = closures.filter((closure) => {
    const closureKey = closure.period_year * 100 + closure.period_month
    return (
      closureKey >= fromParts[0] * 100 + fromParts[1] &&
      closureKey <= toParts[0] * 100 + toParts[1]
    )
  })
  const dirtyClosureCount = closuresInPeriod.filter(
    (closure) => closure.changed_after_closure
  ).length
  const defaultClosurePeriod = toDate.slice(0, 7)
  const [defaultClosureYear, defaultClosureMonth] = defaultClosurePeriod
    .split('-')
    .map(Number)
  const defaultClosure = closures.find(
    (closure) =>
      closure.period_year === defaultClosureYear &&
      closure.period_month === defaultClosureMonth
  )
  const defaultClosureStatus = defaultClosure
    ? defaultClosure.changed_after_closure
      ? 'changed'
      : 'valid'
    : 'none'
  const urlParams = new URLSearchParams()

  if (selectedVehicle) urlParams.set('vehicle', selectedVehicle.id)
  urlParams.set('from', fromDate)
  urlParams.set('to', toDate)
  if (usage) urlParams.set('usage', usage)
  if (entryType) urlParams.set('type', entryType)
  if (energy) urlParams.set('energy', energy)
  if (search) urlParams.set('q', search)
  if (view === 'fuel') urlParams.set('view', 'fuel')

  const vehicleOptions: VehicleSelectorOption[] = vehicles.map((vehicle) => ({
    id: vehicle.id,
    assetName: vehicle.asset_name,
    brand: vehicle.brand,
    model: vehicle.model,
    registrationPlate: vehicle.registration_plate,
  }))
  const automaticOdometerEntries = await Promise.all(
    vehicles.map(async (vehicle) => {
      if (vehicle.id === selectedVehicle?.id) {
        return [vehicle.id, currentOdometer] as const
      }

      const { data, error } = await supabase
        .from('vehicle_logbook_entries')
        .select('odometer_end_km')
        .eq('vehicle_id', vehicle.id)
        .is('deleted_at', null)
        .order('trip_date', { ascending: false })
        .order('day_sequence', { ascending: false })
        .limit(1)
        .maybeSingle<{ odometer_end_km: number }>()

      if (error) {
        throw new Error(
          `Nepodařilo se načíst aktuální tachometr vozidla ${vehicle.registration_plate}: ${error.message}`
        )
      }

      return [
        vehicle.id,
        data?.odometer_end_km ?? vehicle.initial_odometer_km,
      ] as const
    })
  )
  const automaticOdometerByVehicle = new Map(automaticOdometerEntries)
  const automaticVehicleOptions: AutomaticLogbookVehicleOption[] = vehicles.map(
    (vehicle) => ({
      id: vehicle.id,
      label: getVehicleDisplayName(vehicle),
      registrationPlate: vehicle.registration_plate,
      suggestedOdometerKm:
        automaticOdometerByVehicle.get(vehicle.id) ?? null,
    })
  )
  const reportVehicleOptions: VehicleLogbookReportVehicleOption[] =
    reportVehicleRows.map((vehicle) => ({
      id: vehicle.id,
      label: getVehicleDisplayName(vehicle),
      registrationPlate: vehicle.registration_plate,
      isActive: vehicle.is_active,
    }))

  return (
    <main className="vehicle-logbook-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <PresenceSectionTracker section="Knihy jízd" route="/knihy-jizd" />

      <div
        aria-hidden
        className="vehicle-logbook-page__glow vehicle-logbook-page__glow--right pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="vehicle-logbook-page__glow vehicle-logbook-page__glow--left pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="vehicle-logbook-page__panel vehicle-logbook-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
              Knihy jízd
            </h1>

            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
              <Link
                href="/dashboard"
                className="vehicle-logbook-page__back-button col-span-2 inline-flex min-h-10 items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800 sm:col-span-1"
              >
                ZPĚT NA DASHBOARD
              </Link>
              <AutomaticLogbookButton
                vehicles={automaticVehicleOptions}
                selectedVehicleId={selectedVehicle?.id ?? vehicles[0]?.id ?? ''}
                defaultPeriodFrom={ranges.month.from}
                defaultPeriodTo={todayKey}
              />
              <VehicleLogbookReportsButton
                className={secondaryActionClass}
                vehicles={reportVehicleOptions}
                selectedVehicleId={selectedVehicle?.id ?? ''}
                defaultFrom={ranges.month.from}
                defaultTo={todayKey}
              />
              {selectedVehicle ? (
                <NewTripButton
                  vehicleId={selectedVehicle.id}
                  vehicleLabel={`${getVehicleDisplayName(selectedVehicle)} · ${selectedVehicle.registration_plate}`}
                  currentOdometerKm={currentOdometer}
                  today={todayKey}
                />
              ) : (
                <button
                  type="button"
                  disabled
                  className="vehicle-logbook-page__primary-action col-span-2 inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-2xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 py-2.5 text-sm font-medium text-white opacity-55 sm:col-span-1"
                >
                  NOVÁ JÍZDA
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="vehicle-logbook-page__panel vehicle-logbook-page__control-panel overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] md:p-5">
          {selectedVehicle ? (
            <>
              <VehicleSelector
                vehicles={vehicleOptions}
                selectedVehicleId={selectedVehicle.id}
                selectionWasExplicit={selectionWasExplicit}
              />

              <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(520px,0.95fr)]">
                <div className="vehicle-logbook-page__vehicle-card rounded-2xl border border-white/75 bg-white/55 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.86)]">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                        VYBRANÉ VOZIDLO
                      </div>
                      <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-gray-900">
                        {getVehicleDisplayName(selectedVehicle)}
                      </h2>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-[#2f77af]">
                        {selectedVehicle.registration_plate}
                      </div>
                    </div>

                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:items-end">
                      <MonthlyClosureButton
                        vehicleId={selectedVehicle.id}
                        vehicleLabel={`${getVehicleDisplayName(selectedVehicle)} · ${selectedVehicle.registration_plate}`}
                        defaultPeriod={defaultClosurePeriod}
                        currentPeriod={todayKey.slice(0, 7)}
                        status={defaultClosureStatus}
                      />
                      {selectedVehicle.initial_odometer_km === null ? (
                        <InitialOdometerButton
                          vehicleId={selectedVehicle.id}
                          vehicleLabel={`${getVehicleDisplayName(selectedVehicle)} · ${selectedVehicle.registration_plate}`}
                          initialOdometerKm={null}
                        />
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-100 pt-4 sm:grid-cols-3">
                    <div>
                      <div className="vehicle-logbook-page__detail-label">AKTUÁLNÍ TACHOMETR</div>
                      <div className="vehicle-logbook-page__detail-value">
                        {currentOdometer === null ? 'Nevyplněno' : `${formatNumber(currentOdometer)} km`}
                      </div>
                    </div>
                    <div>
                      <div className="vehicle-logbook-page__detail-label">POČÁTEČNÍ STAV</div>
                      <div className="flex items-baseline gap-2">
                        <div className="vehicle-logbook-page__detail-value">
                          {selectedVehicle.initial_odometer_km === null
                            ? 'Nevyplněno'
                            : `${formatNumber(selectedVehicle.initial_odometer_km)} km`}
                        </div>
                        {selectedVehicle.initial_odometer_km !== null ? (
                          <InitialOdometerButton
                            vehicleId={selectedVehicle.id}
                            vehicleLabel={`${getVehicleDisplayName(selectedVehicle)} · ${selectedVehicle.registration_plate}`}
                            initialOdometerKm={selectedVehicle.initial_odometer_km}
                          />
                        ) : null}
                      </div>
                    </div>
                    <div>
                      <div className="vehicle-logbook-page__detail-label">ROK VÝROBY</div>
                      <div className="vehicle-logbook-page__detail-value">
                        {selectedVehicle.year_of_manufacture ?? '—'}
                      </div>
                    </div>
                    <div>
                      <div className="vehicle-logbook-page__detail-label">VIN</div>
                      <div
                        className="vehicle-logbook-page__detail-value truncate"
                        title={selectedVehicle.vin ?? undefined}
                      >
                        {selectedVehicle.vin ?? '—'}
                      </div>
                    </div>
                    <div>
                      <div className="vehicle-logbook-page__detail-label">STK DO</div>
                      <div className="vehicle-logbook-page__detail-value">
                        {formatDate(selectedVehicle.stk_expires_on)}
                      </div>
                    </div>
                    <div>
                      <div className="vehicle-logbook-page__detail-label">POJIŠTĚNÍ DO</div>
                      <div className="vehicle-logbook-page__detail-value">
                        {formatDate(selectedVehicle.insurance_expires_on)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="vehicle-logbook-page__summary-card overflow-hidden rounded-2xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_12px_26px_rgba(41,128,185,0.24)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/78">
                      PROVOZNÍ SOUHRN
                    </div>
                    <div className="text-[10px] font-medium text-white/75">
                      {formatDate(fromDate)}–{formatDate(toDate)}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                    <div>
                      <div className="vehicle-logbook-page__summary-label">ZÁZNAMY</div>
                      <div className="vehicle-logbook-page__summary-value">{entries.length}</div>
                    </div>
                    <div>
                      <div className="vehicle-logbook-page__summary-label">CELKEM KM</div>
                      <div className="vehicle-logbook-page__summary-value">
                        {formatNumber(totalKm)}
                      </div>
                    </div>
                    <div>
                      <div className="vehicle-logbook-page__summary-label">SLUŽEBNÍ</div>
                      <div className="vehicle-logbook-page__summary-value">
                        {formatNumber(businessKm)} km
                      </div>
                    </div>
                    <div>
                      <div className="vehicle-logbook-page__summary-label">SOUKROMÉ</div>
                      <div className="vehicle-logbook-page__summary-value">
                        {formatNumber(privateKm)} km
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/18">
                    <div
                      className="h-full rounded-full bg-white/88 transition-all"
                      style={{ width: `${businessShare}%` }}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/18 pt-3 sm:grid-cols-4">
                    <div>
                      <div className="vehicle-logbook-page__summary-label">SLUŽEBNÍ PODÍL</div>
                      <div className="vehicle-logbook-page__summary-subvalue">{businessShare} %</div>
                    </div>
                    <div>
                      <div className="vehicle-logbook-page__summary-label">TANKOVÁNÍ</div>
                      <div className="vehicle-logbook-page__summary-subvalue">{fuelEntries.length}</div>
                    </div>
                    <div>
                      <div className="vehicle-logbook-page__summary-label">PALIVO S DPH</div>
                      <div className="vehicle-logbook-page__summary-subvalue">
                        {formatCurrency(fuelGross)}
                      </div>
                    </div>
                    <div>
                      <div className="vehicle-logbook-page__summary-label">UZÁVĚRKY</div>
                      <div className="vehicle-logbook-page__summary-subvalue">
                        {closuresInPeriod.length === 0
                          ? 'Bez uzávěrky'
                          : dirtyClosureCount > 0
                            ? `${dirtyClosureCount} změněno`
                            : `${closuresInPeriod.length} v pořádku`}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/18 pt-3 text-[10px] text-white/76">
                    <span>Bez DPH {formatCurrency(fuelNet)}</span>
                    <span>DPH {formatCurrency(fuelVat)}</span>
                  </div>
                </div>
              </div>

              <div className="vehicle-logbook-page__filters mt-4 rounded-2xl border border-white/75 bg-white/48 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.84)] sm:p-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ['MĚSÍC', ranges.month],
                        ['ČTVRTLETÍ', ranges.quarter],
                        ['ROK', ranges.year],
                      ] as const
                    ).map(([label, range]) => {
                      const selected = fromDate === range.from && toDate === range.to

                      return (
                        <Link
                          key={label}
                          href={buildHref(urlParams, {
                            from: range.from,
                            to: range.to,
                          })}
                          data-selected={selected ? 'true' : 'false'}
                          style={selected ? undefined : { boxShadow: 'none' }}
                          className="vehicle-logbook-page__period-tab inline-flex h-10 items-center justify-center rounded-xl border px-3 text-[10px] font-semibold uppercase tracking-[0.08em] transition"
                        >
                          {label}
                        </Link>
                      )
                    })}
                  </div>

                  <form
                    action="/knihy-jizd"
                    method="get"
                    className={`grid min-w-0 flex-1 gap-2 sm:grid-cols-2 ${
                      view === 'trips'
                        ? 'lg:grid-cols-[repeat(2,minmax(138px,0.7fr))_repeat(2,minmax(155px,0.8fr))_minmax(180px,1.2fr)_auto] xl:max-w-[1120px]'
                        : 'lg:grid-cols-[repeat(2,minmax(138px,0.72fr))_minmax(160px,0.8fr)_minmax(210px,1.2fr)_auto] xl:max-w-[900px]'
                    }`}
                  >
                    <input type="hidden" name="vehicle" value={selectedVehicle.id} />
                    <input type="hidden" name="view" value={view} />
                    <label className="min-w-0">
                      <span className="vehicle-logbook-page__filter-label">OD</span>
                      <input
                        type="date"
                        name="from"
                        defaultValue={fromDate}
                        className="vehicle-logbook-page__input h-10 w-full rounded-xl border border-white/75 bg-white/88 px-3 text-xs text-gray-900 outline-none"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="vehicle-logbook-page__filter-label">DO</span>
                      <input
                        type="date"
                        name="to"
                        defaultValue={toDate}
                        className="vehicle-logbook-page__input h-10 w-full rounded-xl border border-white/75 bg-white/88 px-3 text-xs text-gray-900 outline-none"
                      />
                    </label>
                    {view === 'trips' ? (
                      <>
                        <label className="min-w-0">
                          <span className="vehicle-logbook-page__filter-label">
                            VYUŽITÍ
                          </span>
                          <div className="relative">
                            <select
                              name="usage"
                              defaultValue={usage}
                              className="vehicle-logbook-page__input h-10 w-full appearance-none rounded-xl border border-white/75 bg-white/88 px-3 pr-9 text-xs text-gray-900 outline-none"
                            >
                              <option value="">Vše</option>
                              <option value="business">Služební</option>
                              <option value="private">Soukromé</option>
                              <option value="mixed">Smíšené</option>
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
                          <span className="vehicle-logbook-page__filter-label">
                            TYP ZÁZNAMU
                          </span>
                          <div className="relative">
                            <select
                              name="type"
                              defaultValue={entryType}
                              className="vehicle-logbook-page__input h-10 w-full appearance-none rounded-xl border border-white/75 bg-white/88 px-3 pr-9 text-xs text-gray-900 outline-none"
                            >
                              <option value="">Všechny</option>
                              <option value="trip">Jednotlivé jízdy</option>
                              <option value="daily_summary">Denní souhrny</option>
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
                      </>
                    ) : (
                      <label className="min-w-0">
                        <span className="vehicle-logbook-page__filter-label">
                          PALIVO / ENERGIE
                        </span>
                        <select
                          name="energy"
                          defaultValue={energy}
                          className="vehicle-logbook-page__input h-10 w-full rounded-xl border border-white/75 bg-white/88 px-3 text-xs text-gray-900 outline-none"
                        >
                          <option value="">Vše</option>
                          <option value="petrol">Benzín</option>
                          <option value="diesel">Nafta</option>
                          <option value="electricity">Elektřina</option>
                        </select>
                      </label>
                    )}
                    <label className="min-w-0 sm:col-span-2 lg:col-span-1">
                      <span className="vehicle-logbook-page__filter-label">HLEDAT</span>
                      <input
                        type="search"
                        name="q"
                        defaultValue={search}
                        placeholder={
                          view === 'trips'
                            ? 'Místo nebo účel'
                            : 'Dodavatel nebo doklad'
                        }
                        className="vehicle-logbook-page__input h-10 w-full rounded-xl border border-white/75 bg-white/88 px-3 text-xs text-gray-900 outline-none placeholder:text-gray-400"
                      />
                    </label>
                    <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
                      <button
                        type="submit"
                        className="vehicle-logbook-page__filter-submit inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-[10px] font-semibold uppercase tracking-[0.06em] text-white transition duration-200 hover:-translate-y-[1px]"
                      >
                        POUŽÍT
                      </button>
                      <Link
                        href={`/knihy-jizd?vehicle=${selectedVehicle.id}&from=${ranges.month.from}&to=${ranges.month.to}&view=${view}`}
                        className="vehicle-logbook-page__filter-reset inline-flex h-10 items-center justify-center rounded-xl border border-white/75 bg-white/85 px-3 text-[10px] font-semibold uppercase text-gray-700 transition duration-200 hover:-translate-y-[1px]"
                      >
                        RESET
                      </Link>
                    </div>
                  </form>
                </div>
              </div>
            </>
          ) : (
            <div className="vehicle-logbook-page__empty-vehicles rounded-2xl border border-dashed border-[#8dbfe0] bg-[#edf7fc]/72 px-5 py-8 text-center">
              <h2 className="text-lg font-semibold text-gray-900">
                V Majetku není žádný aktivní osobní vůz
              </h2>
              <p className="mt-2 text-sm text-gray-500">
                Přidej aktivní vozidlo do kategorie Osobní vozy a vyplň jeho SPZ.
              </p>
              <Link
                href="/majetek"
                className="vehicle-logbook-page__primary-action mt-4 inline-flex h-10 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 text-xs font-semibold uppercase text-white"
              >
                OTEVŘÍT MAJETEK
              </Link>
            </div>
          )}
        </section>

        {selectedVehicle ? (
          <section className="vehicle-logbook-page__panel vehicle-logbook-page__content-panel min-h-[380px] rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5">
            <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2">
                <Link
                  href={buildHref(urlParams, {
                    view: null,
                    energy: null,
                    q: null,
                  })}
                  data-selected={view === 'trips' ? 'true' : 'false'}
                  style={view === 'trips' ? undefined : { boxShadow: 'none' }}
                  className="vehicle-logbook-page__content-tab inline-flex h-10 items-center justify-center rounded-xl border px-4 text-[11px] font-semibold uppercase tracking-[0.08em]"
                >
                  JÍZDY
                </Link>
                <Link
                  href={buildHref(urlParams, {
                    view: 'fuel',
                    usage: null,
                    type: null,
                    q: null,
                  })}
                  data-selected={view === 'fuel' ? 'true' : 'false'}
                  style={view === 'fuel' ? undefined : { boxShadow: 'none' }}
                  className="vehicle-logbook-page__content-tab inline-flex h-10 items-center justify-center rounded-xl border px-4 text-[11px] font-semibold uppercase tracking-[0.08em]"
                >
                  TANKOVÁNÍ
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-xs text-gray-500">
                  {view === 'trips'
                    ? `${entries.length} záznamů · ${formatNumber(totalKm)} km`
                    : `${fuelEntries.length} záznamů · ${formatCurrency(fuelGross)}`}
                </div>
                {view === 'fuel' ? (
                  <FuelEntryButton
                    vehicleId={selectedVehicle.id}
                    vehicleLabel={`${getVehicleDisplayName(selectedVehicle)} · ${selectedVehicle.registration_plate}`}
                    currentOdometerKm={currentOdometer}
                    today={todayKey}
                  />
                ) : null}
              </div>
            </div>

            {view === 'trips' ? (
              <TripEntriesList entries={entries} />
            ) : (
              <FuelEntriesList entries={fuelEntries} />
            )}
          </section>
        ) : null}
      </div>
    </main>
  )
}
