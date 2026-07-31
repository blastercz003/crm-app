'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import type {
  VehicleLogbookReportData,
  VehicleLogbookReportEntry,
  VehicleLogbookReportFuelEntry,
} from '@/lib/vehicle-logbook/reports'
import { getVehicleLogbookReportAction } from './report-actions'

export type VehicleLogbookReportVehicleOption = {
  id: string
  label: string
  registrationPlate: string
  isActive: boolean
}

type VehicleLogbookReportsButtonProps = {
  className: string
  vehicles: VehicleLogbookReportVehicleOption[]
  selectedVehicleId: string
  defaultFrom: string
  defaultTo: string
}

type ReportTab = 'summary' | 'trips' | 'fuel' | 'closures'

const TABS: Array<{ value: ReportTab; label: string }> = [
  { value: 'summary', label: 'SOUHRN' },
  { value: 'trips', label: 'JÍZDY' },
  { value: 'fuel', label: 'PHM A NABÍJENÍ' },
  { value: 'closures', label: 'UZÁVĚRKY' },
]

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits,
  }).format(value)
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
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

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${Number(day)}. ${Number(month)}. ${year}`
}

function formatMonth(value: string) {
  const [year, month] = value.split('-')
  return `${Number(month)}/${year}`
}

function usageLabel(value: VehicleLogbookReportEntry['usageType']) {
  if (value === 'private') return 'SOUKROMÁ'
  if (value === 'mixed') return 'SMÍŠENÁ'
  return 'SLUŽEBNÍ'
}

function energyLabel(value: VehicleLogbookReportFuelEntry['energyType']) {
  if (value === 'diesel') return 'NAFTA'
  if (value === 'electricity') return 'ELEKTŘINA'
  return 'BENZÍN'
}

function getRange(today: string, period: 'month' | 'quarter' | 'year') {
  const [year, month] = today.split('-').map(Number)
  if (period === 'year') return { from: `${year}-01-01`, to: today }
  if (period === 'quarter') {
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1
    return {
      from: `${year}-${String(startMonth).padStart(2, '0')}-01`,
      to: today,
    }
  }
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: today,
  }
}

function ReportMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="vehicle-logbook-page__report-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  )
}

function EmptyReport({ children }: { children: string }) {
  return (
    <div className="vehicle-logbook-page__report-empty rounded-2xl border py-12 text-center text-sm">
      {children}
    </div>
  )
}

function SummaryTab({ report }: { report: VehicleLogbookReportData }) {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ReportMetric
          label="CELKEM KILOMETRŮ"
          value={`${formatNumber(report.metrics.totalKm)} km`}
          detail={`${formatNumber(report.metrics.businessKm)} služebních · ${formatNumber(report.metrics.privateKm)} soukromých`}
        />
        <ReportMetric
          label="SLUŽEBNÍ PODÍL"
          value={`${formatNumber(report.metrics.businessShare, 1)} %`}
          detail={`${report.metrics.tripCount} záznamů`}
        />
        <ReportMetric
          label="NÁKLADY BEZ DPH"
          value={formatCurrency(report.metrics.fuelNetAmount)}
          detail={`DPH ${formatCurrency(report.metrics.fuelVatAmount)}`}
        />
        <ReportMetric
          label="NÁKLADY S DPH"
          value={formatCurrency(report.metrics.fuelGrossAmount)}
          detail={
            report.metrics.costPerKmGross === null
              ? 'Náklad na km nelze určit'
              : `${formatCurrency(report.metrics.costPerKmGross)} / km`
          }
        />
      </div>

      <div className="vehicle-logbook-page__report-card overflow-hidden rounded-2xl border">
        <div className="vehicle-logbook-page__report-section-head">
          <div>
            <span>VOZIDLA</span>
            <strong>Provozní a finanční porovnání</strong>
          </div>
          <small>
            {formatCount(report.metrics.vehicleCount, [
              'vozidlo',
              'vozidla',
              'vozidel',
            ])}{' '}
            v reportu
          </small>
        </div>
        <div className="overflow-x-auto">
          <table className="vehicle-logbook-page__report-table min-w-[880px]">
            <thead>
              <tr>
                <th>Vozidlo</th>
                <th className="text-right">Jízdy</th>
                <th className="text-right">Celkem km</th>
                <th className="text-right">Služební</th>
                <th className="text-right">Soukromé</th>
                <th className="text-right">Bez DPH</th>
                <th className="text-right">DPH</th>
                <th className="text-right">S DPH</th>
                <th className="text-right">Kč/km</th>
              </tr>
            </thead>
            <tbody>
              {report.vehicleSummaries.map((row) => (
                <tr key={row.vehicleId}>
                  <td>
                    <strong>{row.vehicleName}</strong>
                    <small>{row.registrationPlate}</small>
                  </td>
                  <td className="text-right">{row.tripCount}</td>
                  <td className="text-right">{formatNumber(row.totalKm)}</td>
                  <td className="text-right">{formatNumber(row.businessKm)}</td>
                  <td className="text-right">{formatNumber(row.privateKm)}</td>
                  <td className="text-right">{formatCurrency(row.fuelNetAmount)}</td>
                  <td className="text-right">{formatCurrency(row.fuelVatAmount)}</td>
                  <td className="text-right">{formatCurrency(row.fuelGrossAmount)}</td>
                  <td className="text-right">
                    {row.costPerKmGross === null
                      ? '—'
                      : formatCurrency(row.costPerKmGross)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="vehicle-logbook-page__report-card rounded-2xl border p-4">
          <div className="vehicle-logbook-page__report-section-title">
            ENERGIE A NÁKLADY
          </div>
          {report.energySummaries.length === 0 ? (
            <div className="mt-4 text-sm text-gray-500">
              V období není evidované tankování ani nabíjení.
            </div>
          ) : (
            <div className="mt-3 grid gap-2">
              {report.energySummaries.map((energy) => (
                <div
                  key={energy.energyType}
                  className="vehicle-logbook-page__report-energy-row"
                >
                  <div>
                    <strong>{energyLabel(energy.energyType)}</strong>
                    <small>
                      {formatNumber(energy.quantity, 3)}{' '}
                      {energy.unit === 'kwh' ? 'kWh' : 'l'} ·{' '}
                      {energy.entryCount} záznamů
                    </small>
                  </div>
                  <div className="text-right">
                    <strong>{formatCurrency(energy.grossAmount)}</strong>
                    <small>
                      {energy.averageGrossUnitPrice === null
                        ? '—'
                        : `${formatCurrency(energy.averageGrossUnitPrice)} / ${energy.unit === 'kwh' ? 'kWh' : 'l'}`}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="vehicle-logbook-page__report-card rounded-2xl border p-4">
          <div className="vehicle-logbook-page__report-section-title">
            STAV UZÁVĚREK
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <ReportMetric
              label="PLATNÉ"
              value={String(report.metrics.validClosureCount)}
            />
            <ReportMetric
              label="ZMĚNĚNÉ"
              value={String(report.metrics.changedClosureCount)}
            />
            <ReportMetric
              label="CHYBÍ"
              value={String(report.metrics.missingClosureCount)}
            />
          </div>
          <p className="mt-3 text-xs leading-5 text-gray-500">
            Změněná uzávěrka znamená, že po jejím vytvoření došlo k úpravě
            jízd nebo tankování. Před předáním podkladů ji přepočítej.
          </p>
        </div>
      </div>
    </div>
  )
}

function TripsTab({ report }: { report: VehicleLogbookReportData }) {
  if (report.entries.length === 0) {
    return <EmptyReport>Ve zvoleném období nejsou žádné jízdy.</EmptyReport>
  }

  return (
    <div className="vehicle-logbook-page__report-card overflow-hidden rounded-2xl border">
      <div className="vehicle-logbook-page__report-section-head">
        <div>
          <span>KNIHA JÍZD</span>
          <strong>{report.entries.length} záznamů</strong>
        </div>
        <small>{formatNumber(report.metrics.totalKm)} km celkem</small>
      </div>
      <div className="overflow-x-auto">
        <table className="vehicle-logbook-page__report-table min-w-[1100px]">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Vozidlo</th>
              <th>Trasa</th>
              <th>Účel</th>
              <th>Využití</th>
              <th className="text-right">Poč. km</th>
              <th className="text-right">Kon. km</th>
              <th className="text-right">Služební</th>
              <th className="text-right">Soukromé</th>
            </tr>
          </thead>
          <tbody>
            {report.entries.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDate(entry.date)}</td>
                <td>
                  <strong>{entry.vehicleName}</strong>
                  <small>{entry.registrationPlate}</small>
                </td>
                <td>
                  <strong>
                    {entry.origin} → {entry.destination}
                  </strong>
                </td>
                <td>{entry.purpose}</td>
                <td>{usageLabel(entry.usageType)}</td>
                <td className="text-right">{formatNumber(entry.odometerStartKm)}</td>
                <td className="text-right">{formatNumber(entry.odometerEndKm)}</td>
                <td className="text-right">{formatNumber(entry.businessKm)}</td>
                <td className="text-right">{formatNumber(entry.privateKm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FuelTab({ report }: { report: VehicleLogbookReportData }) {
  if (report.fuelEntries.length === 0) {
    return (
      <EmptyReport>
        Ve zvoleném období není žádné tankování ani nabíjení.
      </EmptyReport>
    )
  }

  return (
    <div className="vehicle-logbook-page__report-card overflow-hidden rounded-2xl border">
      <div className="vehicle-logbook-page__report-section-head">
        <div>
          <span>PHM A NABÍJENÍ</span>
          <strong>{report.fuelEntries.length} záznamů</strong>
        </div>
        <small>{formatCurrency(report.metrics.fuelGrossAmount)} s DPH</small>
      </div>
      <div className="overflow-x-auto">
        <table className="vehicle-logbook-page__report-table min-w-[1050px]">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Vozidlo</th>
              <th>Energie</th>
              <th className="text-right">Množství</th>
              <th>Dodavatel / doklad</th>
              <th className="text-right">Tachometr</th>
              <th className="text-right">Bez DPH</th>
              <th className="text-right">DPH</th>
              <th className="text-right">S DPH</th>
            </tr>
          </thead>
          <tbody>
            {report.fuelEntries.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDate(entry.date)}</td>
                <td>
                  <strong>{entry.vehicleName}</strong>
                  <small>{entry.registrationPlate}</small>
                </td>
                <td>{energyLabel(entry.energyType)}</td>
                <td className="text-right">
                  {formatNumber(entry.quantity, 3)}{' '}
                  {entry.unit === 'kwh' ? 'kWh' : 'l'}
                </td>
                <td>
                  <strong>{entry.supplier ?? '—'}</strong>
                  <small>{entry.documentNumber ?? 'Bez čísla dokladu'}</small>
                </td>
                <td className="text-right">{formatNumber(entry.odometerKm)}</td>
                <td className="text-right">{formatCurrency(entry.netAmount)}</td>
                <td className="text-right">{formatCurrency(entry.vatAmount)}</td>
                <td className="text-right">{formatCurrency(entry.grossAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ClosuresTab({ report }: { report: VehicleLogbookReportData }) {
  if (report.closures.length === 0) {
    return (
      <EmptyReport>Ve zvoleném období nejsou vytvořené uzávěrky.</EmptyReport>
    )
  }

  return (
    <div className="vehicle-logbook-page__report-card overflow-hidden rounded-2xl border">
      <div className="vehicle-logbook-page__report-section-head">
        <div>
          <span>MĚSÍČNÍ UZÁVĚRKY</span>
          <strong>{report.closures.length} uzávěrek</strong>
        </div>
        <small>
          {report.metrics.changedClosureCount > 0
            ? `${report.metrics.changedClosureCount} vyžaduje přepočet`
            : 'Uložené uzávěrky jsou platné'}
        </small>
      </div>
      <div className="overflow-x-auto">
        <table className="vehicle-logbook-page__report-table min-w-[980px]">
          <thead>
            <tr>
              <th>Období</th>
              <th>Vozidlo</th>
              <th>Stav</th>
              <th className="text-right">Poč. km</th>
              <th className="text-right">Kon. km</th>
              <th className="text-right">Služební</th>
              <th className="text-right">Soukromé</th>
              <th className="text-right">Bez DPH</th>
              <th className="text-right">DPH</th>
              <th className="text-right">S DPH</th>
            </tr>
          </thead>
          <tbody>
            {report.closures.map((closure) => (
              <tr key={closure.id}>
                <td>{formatMonth(closure.period)}</td>
                <td>
                  <strong>{closure.vehicleName}</strong>
                  <small>{closure.registrationPlate}</small>
                </td>
                <td>
                  <span
                    className="vehicle-logbook-page__closure-state"
                    data-state={
                      closure.changedAfterClosure ? 'changed' : 'valid'
                    }
                  >
                    {closure.changedAfterClosure ? 'ZMĚNĚNÁ' : 'PLATNÁ'}
                  </span>
                </td>
                <td className="text-right">
                  {closure.openingOdometerKm === null
                    ? '—'
                    : formatNumber(closure.openingOdometerKm)}
                </td>
                <td className="text-right">
                  {closure.closingOdometerKm === null
                    ? '—'
                    : formatNumber(closure.closingOdometerKm)}
                </td>
                <td className="text-right">{formatNumber(closure.businessKm)}</td>
                <td className="text-right">{formatNumber(closure.privateKm)}</td>
                <td className="text-right">
                  {formatCurrency(closure.fuelNetAmount)}
                </td>
                <td className="text-right">
                  {formatCurrency(closure.fuelVatAmount)}
                </td>
                <td className="text-right">
                  {formatCurrency(closure.fuelGrossAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VehicleLogbookReportsModal({
  vehicles,
  selectedVehicleId,
  defaultFrom,
  defaultTo,
  onClose,
}: VehicleLogbookReportsButtonProps & { onClose: () => void }) {
  const shellRef = useRef<HTMLDivElement>(null)
  const requestVersion = useRef(0)
  const [vehicleId, setVehicleId] = useState(selectedVehicleId)
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [tab, setTab] = useState<ReportTab>('summary')
  const [report, setReport] = useState<VehicleLogbookReportData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function load(next?: {
    vehicleId?: string
    from?: string
    to?: string
  }) {
    const nextVehicleId = next?.vehicleId ?? vehicleId
    const nextFrom = next?.from ?? from
    const nextTo = next?.to ?? to
    const version = ++requestVersion.current

    setError(null)
    startTransition(async () => {
      const result = await getVehicleLogbookReportAction({
        vehicleId: nextVehicleId || null,
        from: nextFrom,
        to: nextTo,
      })
      if (version !== requestVersion.current) return
      if (!result.success) {
        setReport(null)
        setError(result.error)
        return
      }
      setReport(result.report)
    })
  }

  useEffect(() => {
    load()
    // Úvodní načtení patří pouze k otevření modalu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const exportQuery = useMemo(
    () =>
      new URLSearchParams({
        vehicle: vehicleId,
        from,
        to,
      }).toString(),
    [from, to, vehicleId]
  )
  const selectionChanged =
    report?.selectedVehicleId !== (vehicleId || null) ||
    report?.period.from !== from ||
    report?.period.to !== to
  const exportDisabled = !report || pending || selectionChanged || Boolean(error)

  function applyPeriod(period: 'month' | 'quarter' | 'year') {
    const next = getRange(defaultTo, period)
    setFrom(next.from)
    setTo(next.to)
    load({ from: next.from, to: next.to })
  }

  return (
    <div
      className="fixed inset-0 z-[140] overflow-y-auto bg-zinc-950/48 p-2 backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehicle-logbook-reports-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex min-h-full items-center justify-center">
        <div
          ref={shellRef}
          className="vehicle-logbook-page__modal vehicle-logbook-page__reports-modal flex h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(245,248,251,0.96)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.3)] sm:h-auto sm:max-h-[calc(100dvh-2rem)]"
        >
          <header
            className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-4 sm:px-6"
            style={{ borderColor: 'var(--surface-border)' }}
          >
            <div>
              <div className="vehicle-logbook-page__report-kicker">
                KNIHY JÍZD
              </div>
              <h2
                id="vehicle-logbook-reports-title"
                className="mt-1 text-xl font-semibold tracking-tight text-gray-900"
              >
                Reporty
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Zavřít reporty"
              className="vehicle-logbook-page__modal-close inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white/90 text-gray-600"
            >
              ✕
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4">
            <section className="vehicle-logbook-page__report-controls rounded-2xl border p-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(210px,1fr)_145px_145px_auto_auto] lg:items-end">
                <label>
                  <span>VOZIDLO</span>
                  <select
                    value={vehicleId}
                    onChange={(event) => setVehicleId(event.target.value)}
                  >
                    <option value="">Všechna vozidla</option>
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.label} · {vehicle.registrationPlate}
                        {vehicle.isActive ? '' : ' · archivní'}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>OD</span>
                  <input
                    type="date"
                    value={from}
                    max={to}
                    onChange={(event) => setFrom(event.target.value)}
                    className="filter-date-input vehicle-logbook-page__date-input"
                  />
                </label>
                <label>
                  <span>DO</span>
                  <input
                    type="date"
                    value={to}
                    min={from}
                    max={defaultTo}
                    onChange={(event) => setTo(event.target.value)}
                    className="filter-date-input vehicle-logbook-page__date-input"
                  />
                </label>
                <div>
                  <span>RYCHLÁ VOLBA</span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => applyPeriod('month')}>
                      M
                    </button>
                    <button type="button" onClick={() => applyPeriod('quarter')}>
                      Q
                    </button>
                    <button type="button" onClick={() => applyPeriod('year')}>
                      R
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => load()}
                  disabled={pending}
                  className="vehicle-logbook-page__primary-action h-11 rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-5 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-55"
                >
                  {pending ? 'NAČÍTÁM…' : 'AKTUALIZOVAT'}
                </button>
              </div>
            </section>

            <div
              className="vehicle-logbook-page__report-tabs mt-3 grid grid-cols-2 gap-1 rounded-2xl border p-1 sm:grid-cols-4"
              role="tablist"
              aria-label="Část reportu"
            >
              {TABS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.value}
                  onClick={() => setTab(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {error ? (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </div>
            ) : null}

            <div className="mt-3 min-h-[300px]" aria-busy={pending}>
              {pending && !report ? (
                <div className="flex min-h-[300px] items-center justify-center text-sm text-gray-500">
                  Načítám provozní a finanční data…
                </div>
              ) : report ? (
                <>
                  {tab === 'summary' ? <SummaryTab report={report} /> : null}
                  {tab === 'trips' ? <TripsTab report={report} /> : null}
                  {tab === 'fuel' ? <FuelTab report={report} /> : null}
                  {tab === 'closures' ? <ClosuresTab report={report} /> : null}
                </>
              ) : null}
            </div>
          </div>

          <footer
            className="flex shrink-0 flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
            style={{ borderColor: 'var(--surface-border)' }}
          >
            <div className="text-xs text-gray-500">
              {report ? (
                <>
                  Období {formatDate(report.period.from)}–{formatDate(report.period.to)}
                  {' · '}vygenerováno{' '}
                  {new Intl.DateTimeFormat('cs-CZ', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: 'Europe/Prague',
                  }).format(new Date(report.generatedAt))}
                </>
              ) : (
                'PDF a XLSX obsahují souhrn i všechny detailní tabulky.'
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={
                  exportDisabled
                    ? undefined
                    : `/knihy-jizd/reporty/pdf?${exportQuery}`
                }
                target="_blank"
                rel="noreferrer"
                aria-disabled={exportDisabled}
                className={`vehicle-logbook-page__report-export vehicle-logbook-page__report-export--primary ${
                  exportDisabled ? 'pointer-events-none opacity-45' : ''
                }`}
              >
                EXPORT PDF
              </a>
              <a
                href={
                  exportDisabled
                    ? undefined
                    : `/knihy-jizd/reporty/xlsx?${exportQuery}`
                }
                aria-disabled={exportDisabled}
                className={`vehicle-logbook-page__report-export ${
                  exportDisabled ? 'pointer-events-none opacity-45' : ''
                }`}
              >
                EXPORT XLSX
              </a>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}

export function VehicleLogbookReportsButton(
  props: VehicleLogbookReportsButtonProps
) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        disabled={props.vehicles.length === 0}
        onClick={() => setOpen(true)}
        className={props.className}
      >
        <span style={{ color: 'light-dark(#374151, #f8fbff)' }}>
          REPORTY
        </span>
      </button>
      {open
        ? createPortal(
            <VehicleLogbookReportsModal
              {...props}
              onClose={() => setOpen(false)}
            />,
            document.body
          )
        : null}
    </>
  )
}
