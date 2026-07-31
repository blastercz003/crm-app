import type { SupabaseClient } from '@supabase/supabase-js'
import { isValidDateKey } from '@/lib/vehicle-logbook/date'

export type VehicleLogbookReportInput = {
  vehicleId: string | null
  from: string
  to: string
}

export type VehicleLogbookReportVehicle = {
  id: string
  name: string
  registrationPlate: string
  vin: string | null
  isActive: boolean
}

export type VehicleLogbookReportEntry = {
  id: string
  vehicleId: string
  vehicleName: string
  registrationPlate: string
  date: string
  sequence: number
  entryType: 'trip' | 'daily_summary'
  usageType: 'business' | 'private' | 'mixed'
  origin: string
  destination: string
  purpose: string
  odometerStartKm: number
  odometerEndKm: number
  businessKm: number
  privateKm: number
  distanceKm: number
  note: string | null
}

export type VehicleLogbookReportFuelEntry = {
  id: string
  vehicleId: string
  vehicleName: string
  registrationPlate: string
  date: string
  odometerKm: number
  energyType: 'petrol' | 'diesel' | 'electricity'
  quantity: number
  unit: 'litre' | 'kwh'
  netAmount: number
  vatAmount: number
  grossAmount: number
  vatRate: number
  supplier: string | null
  documentNumber: string | null
  isFullTank: boolean
}

export type VehicleLogbookReportClosure = {
  id: string
  vehicleId: string
  vehicleName: string
  registrationPlate: string
  period: string
  openingOdometerKm: number | null
  closingOdometerKm: number | null
  businessKm: number
  privateKm: number
  totalKm: number
  tripCount: number
  fuelEntryCount: number
  fuelNetAmount: number
  fuelVatAmount: number
  fuelGrossAmount: number
  changedAfterClosure: boolean
  calculatedAt: string
}

export type VehicleLogbookReportVehicleSummary = {
  vehicleId: string
  vehicleName: string
  registrationPlate: string
  tripCount: number
  businessKm: number
  privateKm: number
  totalKm: number
  businessShare: number
  fuelEntryCount: number
  fuelNetAmount: number
  fuelVatAmount: number
  fuelGrossAmount: number
  openingOdometerKm: number | null
  closingOdometerKm: number | null
  costPerKmNet: number | null
  costPerKmGross: number | null
}

export type VehicleLogbookReportEnergySummary = {
  energyType: 'petrol' | 'diesel' | 'electricity'
  quantity: number
  unit: 'litre' | 'kwh'
  entryCount: number
  netAmount: number
  vatAmount: number
  grossAmount: number
  averageGrossUnitPrice: number | null
}

export type VehicleLogbookReportData = {
  generatedAt: string
  period: { from: string; to: string }
  scope: 'vehicle' | 'fleet'
  selectedVehicleId: string | null
  vehicles: VehicleLogbookReportVehicle[]
  entries: VehicleLogbookReportEntry[]
  fuelEntries: VehicleLogbookReportFuelEntry[]
  closures: VehicleLogbookReportClosure[]
  vehicleSummaries: VehicleLogbookReportVehicleSummary[]
  energySummaries: VehicleLogbookReportEnergySummary[]
  metrics: {
    vehicleCount: number
    tripCount: number
    businessKm: number
    privateKm: number
    totalKm: number
    businessShare: number
    fuelEntryCount: number
    fuelNetAmount: number
    fuelVatAmount: number
    fuelGrossAmount: number
    costPerKmNet: number | null
    costPerKmGross: number | null
    validClosureCount: number
    changedClosureCount: number
    missingClosureCount: number
  }
}

type VehicleRow = {
  id: string
  asset_name: string
  registration_plate: string
  vin: string | null
  brand: string | null
  model: string | null
  is_active: boolean
}

type EntryRow = {
  id: string
  vehicle_id: string
  trip_date: string
  day_sequence: number
  entry_type: 'trip' | 'daily_summary'
  usage_type: 'business' | 'private' | 'mixed'
  origin: string
  destination: string
  purpose: string
  odometer_start_km: number
  odometer_end_km: number
  business_km: number
  private_km: number
  distance_km: number
  note: string | null
  vehicle_name_snapshot: string
  registration_plate_snapshot: string
}

type FuelRow = {
  id: string
  vehicle_id: string
  fueled_on: string
  odometer_km: number
  energy_type: 'petrol' | 'diesel' | 'electricity'
  quantity: number | string
  unit: 'litre' | 'kwh'
  net_amount: number | string
  vat_amount: number | string
  gross_amount: number | string
  vat_rate: number | string
  supplier: string | null
  document_number: string | null
  is_full_tank: boolean
  vehicle_name_snapshot: string
  registration_plate_snapshot: string
}

type ClosureRow = {
  id: string
  vehicle_id: string
  period_year: number
  period_month: number
  opening_odometer_km: number | null
  closing_odometer_km: number | null
  business_km: number
  private_km: number
  total_km: number
  trip_count: number
  fuel_entry_count: number
  fuel_net_amount: number | string
  fuel_vat_amount: number | string
  fuel_gross_amount: number | string
  changed_after_closure: boolean
  calculated_at: string
}

type PageResult<T> = {
  data: T[] | null
  error: { message: string } | null
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_REPORT_DAYS = 36_525
const PAGE_SIZE = 1000

function getVehicleName(vehicle: VehicleRow) {
  return (
    [vehicle.brand, vehicle.model].filter(Boolean).join(' ').trim() ||
    vehicle.asset_name
  )
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function getMonthKeys(from: string, to: string) {
  const [fromYear, fromMonth] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)
  const months: string[] = []
  let year = fromYear
  let month = fromMonth

  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(monthKey(year, month))
    month += 1
    if (month === 13) {
      month = 1
      year += 1
    }
  }

  return months
}

async function loadAllPages<T>(
  loader: (from: number, to: number) => PromiseLike<PageResult<T>>,
  label: string
) {
  const rows: T[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await loader(offset, offset + PAGE_SIZE - 1)
    if (result.error) {
      throw new Error(`${label}: ${result.error.message}`)
    }

    const page = result.data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return rows
}

export function validateVehicleLogbookReportInput(
  input: VehicleLogbookReportInput
) {
  if (
    !DATE_PATTERN.test(input.from) ||
    !DATE_PATTERN.test(input.to) ||
    !isValidDateKey(input.from) ||
    !isValidDateKey(input.to)
  ) {
    return 'Vyber platné období reportu.'
  }

  const fromDate = new Date(`${input.from}T12:00:00Z`)
  const toDate = new Date(`${input.to}T12:00:00Z`)
  if (
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    toDate < fromDate
  ) {
    return 'Konec období nesmí být před jeho začátkem.'
  }

  const days = Math.round(
    (toDate.getTime() - fromDate.getTime()) / 86_400_000
  )
  if (days > MAX_REPORT_DAYS) {
    return 'Jedním reportem lze zpracovat nejvýše 100 let.'
  }

  return null
}

export async function loadVehicleLogbookReport(
  supabase: SupabaseClient,
  input: VehicleLogbookReportInput
): Promise<VehicleLogbookReportData> {
  const validationError = validateVehicleLogbookReportInput(input)
  if (validationError) throw new Error(validationError)

  let vehicleQuery = supabase
    .from('vehicle_logbook_vehicles')
    .select(
      'id, asset_name, registration_plate, vin, brand, model, is_active'
    )
    .order('asset_name', { ascending: true })

  if (input.vehicleId) vehicleQuery = vehicleQuery.eq('id', input.vehicleId)

  const { data: vehicleData, error: vehicleError } =
    await vehicleQuery.returns<VehicleRow[]>()
  if (vehicleError) {
    throw new Error(`Nepodařilo se načíst vozidla: ${vehicleError.message}`)
  }

  const vehicleRows = vehicleData ?? []
  if (input.vehicleId && vehicleRows.length === 0) {
    throw new Error('Vybrané vozidlo nebylo nalezeno.')
  }

  const vehicleIds = vehicleRows.map((vehicle) => vehicle.id)
  const vehicleMap = new Map(vehicleRows.map((vehicle) => [vehicle.id, vehicle]))

  if (vehicleIds.length === 0) {
    return buildReportData(input, [], [], [], [])
  }

  const [entryRows, fuelRows, allClosureRows] = await Promise.all([
    loadAllPages<EntryRow>(
      (from, to) =>
        supabase
          .from('vehicle_logbook_entries')
          .select(
            'id, vehicle_id, trip_date, day_sequence, entry_type, usage_type, origin, destination, purpose, odometer_start_km, odometer_end_km, business_km, private_km, distance_km, note, vehicle_name_snapshot, registration_plate_snapshot'
          )
          .in('vehicle_id', vehicleIds)
          .is('deleted_at', null)
          .gte('trip_date', input.from)
          .lte('trip_date', input.to)
          .order('trip_date', { ascending: true })
          .order('day_sequence', { ascending: true })
          .range(from, to)
          .returns<EntryRow[]>(),
      'Nepodařilo se načíst jízdy'
    ),
    loadAllPages<FuelRow>(
      (from, to) =>
        supabase
          .from('vehicle_logbook_fuel_entries')
          .select(
            'id, vehicle_id, fueled_on, odometer_km, energy_type, quantity, unit, net_amount, vat_amount, gross_amount, vat_rate, supplier, document_number, is_full_tank, vehicle_name_snapshot, registration_plate_snapshot'
          )
          .in('vehicle_id', vehicleIds)
          .is('deleted_at', null)
          .gte('fueled_on', input.from)
          .lte('fueled_on', input.to)
          .order('fueled_on', { ascending: true })
          .range(from, to)
          .returns<FuelRow[]>(),
      'Nepodařilo se načíst tankování'
    ),
    loadAllPages<ClosureRow>(
      (from, to) =>
        supabase
          .from('vehicle_logbook_monthly_closures')
          .select(
            'id, vehicle_id, period_year, period_month, opening_odometer_km, closing_odometer_km, business_km, private_km, total_km, trip_count, fuel_entry_count, fuel_net_amount, fuel_vat_amount, fuel_gross_amount, changed_after_closure, calculated_at'
          )
          .in('vehicle_id', vehicleIds)
          .order('period_year', { ascending: true })
          .order('period_month', { ascending: true })
          .range(from, to)
          .returns<ClosureRow[]>(),
      'Nepodařilo se načíst uzávěrky'
    ),
  ])

  const allowedMonths = new Set(getMonthKeys(input.from, input.to))
  const closureRows = allClosureRows.filter((closure) =>
    allowedMonths.has(monthKey(closure.period_year, closure.period_month))
  )

  return buildReportData(
    input,
    vehicleRows,
    entryRows.map((entry) => {
      if (!vehicleMap.has(entry.vehicle_id)) {
        throw new Error('Jízda odkazuje na neznámé vozidlo.')
      }
      return entry
    }),
    fuelRows,
    closureRows
  )
}

function buildReportData(
  input: VehicleLogbookReportInput,
  vehicleRows: VehicleRow[],
  entryRows: EntryRow[],
  fuelRows: FuelRow[],
  closureRows: ClosureRow[]
): VehicleLogbookReportData {
  const vehicleMap = new Map(vehicleRows.map((vehicle) => [vehicle.id, vehicle]))
  const vehicles = vehicleRows.map((vehicle) => ({
    id: vehicle.id,
    name: getVehicleName(vehicle),
    registrationPlate: vehicle.registration_plate,
    vin: vehicle.vin,
    isActive: vehicle.is_active,
  }))

  const entries: VehicleLogbookReportEntry[] = entryRows.map((entry) => {
    const vehicle = vehicleMap.get(entry.vehicle_id)
    return {
      id: entry.id,
      vehicleId: entry.vehicle_id,
      vehicleName:
        entry.vehicle_name_snapshot ||
        (vehicle ? getVehicleName(vehicle) : 'Neznámé vozidlo'),
      registrationPlate:
        entry.registration_plate_snapshot || vehicle?.registration_plate || '—',
      date: entry.trip_date,
      sequence: entry.day_sequence,
      entryType: entry.entry_type,
      usageType: entry.usage_type,
      origin: entry.origin,
      destination: entry.destination,
      purpose: entry.purpose,
      odometerStartKm: entry.odometer_start_km,
      odometerEndKm: entry.odometer_end_km,
      businessKm: entry.business_km,
      privateKm: entry.private_km,
      distanceKm: entry.distance_km,
      note: entry.note,
    }
  })

  const fuelEntries: VehicleLogbookReportFuelEntry[] = fuelRows.map((entry) => {
    const vehicle = vehicleMap.get(entry.vehicle_id)
    return {
      id: entry.id,
      vehicleId: entry.vehicle_id,
      vehicleName:
        entry.vehicle_name_snapshot ||
        (vehicle ? getVehicleName(vehicle) : 'Neznámé vozidlo'),
      registrationPlate:
        entry.registration_plate_snapshot || vehicle?.registration_plate || '—',
      date: entry.fueled_on,
      odometerKm: entry.odometer_km,
      energyType: entry.energy_type,
      quantity: Number(entry.quantity),
      unit: entry.unit,
      netAmount: Number(entry.net_amount),
      vatAmount: Number(entry.vat_amount),
      grossAmount: Number(entry.gross_amount),
      vatRate: Number(entry.vat_rate),
      supplier: entry.supplier,
      documentNumber: entry.document_number,
      isFullTank: entry.is_full_tank,
    }
  })

  const closures: VehicleLogbookReportClosure[] = closureRows.map((closure) => {
    const vehicle = vehicleMap.get(closure.vehicle_id)
    const period = monthKey(closure.period_year, closure.period_month)
    const historicalRow =
      entries.find(
        (entry) =>
          entry.vehicleId === closure.vehicle_id &&
          entry.date.slice(0, 7) === period
      ) ??
      fuelEntries.find(
        (entry) =>
          entry.vehicleId === closure.vehicle_id &&
          entry.date.slice(0, 7) === period
      )
    return {
      id: closure.id,
      vehicleId: closure.vehicle_id,
      vehicleName:
        historicalRow?.vehicleName ??
        (vehicle ? getVehicleName(vehicle) : 'Neznámé vozidlo'),
      registrationPlate:
        historicalRow?.registrationPlate ?? vehicle?.registration_plate ?? '—',
      period,
      openingOdometerKm: closure.opening_odometer_km,
      closingOdometerKm: closure.closing_odometer_km,
      businessKm: closure.business_km,
      privateKm: closure.private_km,
      totalKm: closure.total_km,
      tripCount: closure.trip_count,
      fuelEntryCount: closure.fuel_entry_count,
      fuelNetAmount: Number(closure.fuel_net_amount),
      fuelVatAmount: Number(closure.fuel_vat_amount),
      fuelGrossAmount: Number(closure.fuel_gross_amount),
      changedAfterClosure: closure.changed_after_closure,
      calculatedAt: closure.calculated_at,
    }
  })

  const vehicleSummaries = vehicles.map((vehicle) => {
    const vehicleEntries = entries.filter(
      (entry) => entry.vehicleId === vehicle.id
    )
    const vehicleFuel = fuelEntries.filter(
      (entry) => entry.vehicleId === vehicle.id
    )
    const firstHistoricalRow = [vehicleEntries[0], vehicleFuel[0]]
      .filter(
        (
          row
        ): row is
          | VehicleLogbookReportEntry
          | VehicleLogbookReportFuelEntry => Boolean(row)
      )
      .sort((left, right) => left.date.localeCompare(right.date))[0]
    const businessKm = vehicleEntries.reduce(
      (sum, entry) => sum + entry.businessKm,
      0
    )
    const privateKm = vehicleEntries.reduce(
      (sum, entry) => sum + entry.privateKm,
      0
    )
    const totalKm = businessKm + privateKm
    const fuelNetAmount = vehicleFuel.reduce(
      (sum, entry) => sum + entry.netAmount,
      0
    )
    const fuelVatAmount = vehicleFuel.reduce(
      (sum, entry) => sum + entry.vatAmount,
      0
    )
    const fuelGrossAmount = vehicleFuel.reduce(
      (sum, entry) => sum + entry.grossAmount,
      0
    )

    return {
      vehicleId: vehicle.id,
      vehicleName: firstHistoricalRow?.vehicleName ?? vehicle.name,
      registrationPlate:
        firstHistoricalRow?.registrationPlate ?? vehicle.registrationPlate,
      tripCount: vehicleEntries.length,
      businessKm,
      privateKm,
      totalKm,
      businessShare: totalKm > 0 ? (businessKm / totalKm) * 100 : 0,
      fuelEntryCount: vehicleFuel.length,
      fuelNetAmount,
      fuelVatAmount,
      fuelGrossAmount,
      openingOdometerKm: vehicleEntries[0]?.odometerStartKm ?? null,
      closingOdometerKm: vehicleEntries.at(-1)?.odometerEndKm ?? null,
      costPerKmNet: totalKm > 0 ? fuelNetAmount / totalKm : null,
      costPerKmGross: totalKm > 0 ? fuelGrossAmount / totalKm : null,
    }
  })

  const energyTypes = [
    ['petrol', 'litre'],
    ['diesel', 'litre'],
    ['electricity', 'kwh'],
  ] as const
  const energySummaries = energyTypes
    .map(([energyType, unit]) => {
      const rows = fuelEntries.filter(
        (entry) => entry.energyType === energyType
      )
      const quantity = rows.reduce((sum, entry) => sum + entry.quantity, 0)
      const netAmount = rows.reduce((sum, entry) => sum + entry.netAmount, 0)
      const vatAmount = rows.reduce((sum, entry) => sum + entry.vatAmount, 0)
      const grossAmount = rows.reduce(
        (sum, entry) => sum + entry.grossAmount,
        0
      )
      return {
        energyType,
        unit,
        quantity,
        entryCount: rows.length,
        netAmount,
        vatAmount,
        grossAmount,
        averageGrossUnitPrice:
          quantity > 0 ? grossAmount / quantity : null,
      }
    })
    .filter((summary) => summary.entryCount > 0)

  const businessKm = entries.reduce(
    (sum, entry) => sum + entry.businessKm,
    0
  )
  const privateKm = entries.reduce(
    (sum, entry) => sum + entry.privateKm,
    0
  )
  const totalKm = businessKm + privateKm
  const fuelNetAmount = fuelEntries.reduce(
    (sum, entry) => sum + entry.netAmount,
    0
  )
  const fuelVatAmount = fuelEntries.reduce(
    (sum, entry) => sum + entry.vatAmount,
    0
  )
  const fuelGrossAmount = fuelEntries.reduce(
    (sum, entry) => sum + entry.grossAmount,
    0
  )
  const reportMonths = getMonthKeys(input.from, input.to)
  const expectedClosures = reportMonths.reduce((count, reportMonth) => {
    return (
      count +
      vehicles.filter((vehicle) => {
        if (vehicle.isActive) return true

        return (
          entries.some(
            (entry) =>
              entry.vehicleId === vehicle.id &&
              entry.date.slice(0, 7) === reportMonth
          ) ||
          fuelEntries.some(
            (entry) =>
              entry.vehicleId === vehicle.id &&
              entry.date.slice(0, 7) === reportMonth
          ) ||
          closures.some(
            (closure) =>
              closure.vehicleId === vehicle.id &&
              closure.period === reportMonth
          )
        )
      }).length
    )
  }, 0)
  const validClosureCount = closures.filter(
    (closure) => !closure.changedAfterClosure
  ).length
  const changedClosureCount = closures.filter(
    (closure) => closure.changedAfterClosure
  ).length

  return {
    generatedAt: new Date().toISOString(),
    period: { from: input.from, to: input.to },
    scope: input.vehicleId ? 'vehicle' : 'fleet',
    selectedVehicleId: input.vehicleId,
    vehicles,
    entries,
    fuelEntries,
    closures,
    vehicleSummaries,
    energySummaries,
    metrics: {
      vehicleCount: vehicles.length,
      tripCount: entries.length,
      businessKm,
      privateKm,
      totalKm,
      businessShare: totalKm > 0 ? (businessKm / totalKm) * 100 : 0,
      fuelEntryCount: fuelEntries.length,
      fuelNetAmount,
      fuelVatAmount,
      fuelGrossAmount,
      costPerKmNet: totalKm > 0 ? fuelNetAmount / totalKm : null,
      costPerKmGross: totalKm > 0 ? fuelGrossAmount / totalKm : null,
      validClosureCount,
      changedClosureCount,
      missingClosureCount: Math.max(
        0,
        expectedClosures - validClosureCount - changedClosureCount
      ),
    },
  }
}
