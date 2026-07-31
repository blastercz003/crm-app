'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type AutomaticTripDestinationInput = {
  city: string
  visits: number
}

export type AutomaticTripPreviewRow = {
  id: string
  date: string
  city: string
  outboundMapKm: number
  returnMapKm: number
  outboundKm: number
  returnKm: number
}

export type AutomaticTripPreviewInput = {
  vehicleId: string
  periodFrom: string
  periodTo: string
  departureCity: string
  odometerStartKm: number
  odometerEndKm: number
  destinations: AutomaticTripDestinationInput[]
}

export type AutomaticTripPreviewResult = {
  success: boolean
  error: string | null
  rows: AutomaticTripPreviewRow[]
  mapTotalKm: number
  assignedTotalKm: number
  differenceKm: number
  destinations: AutomaticTripDestinationInput[]
}

export type ConfirmAutomaticTripsState = {
  success: boolean
  error: string | null
  createdTrips: number
}

type Coordinates = {
  latitude: number
  longitude: number
}

type NominatimResult = {
  lat: string
  lon: string
}

type OsrmResult = {
  code?: string
  routes?: Array<{
    distance?: number
  }>
}

const NOMINATIM_BASE_URL =
  process.env.VEHICLE_LOGBOOK_NOMINATIM_URL ??
  'https://nominatim.openstreetmap.org'
const OSRM_BASE_URL =
  process.env.VEHICLE_LOGBOOK_OSRM_URL ?? 'https://router.project-osrm.org'
const MAP_USER_AGENT =
  process.env.VEHICLE_LOGBOOK_MAP_USER_AGENT ??
  'B-Energy-App/1.0 (vehicle-logbook)'
const MAX_DESTINATION_ROWS = 15
const MAX_GENERATED_VISITS = 50
const geocodeCache = new Map<string, Coordinates>()
const routeCache = new Map<string, number>()
let lastNominatimRequestAt = 0

function normalizeUuid(value: unknown) {
  const normalized = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized
  )
    ? normalized
    : null
}

function normalizeText(value: unknown, maximumLength: number) {
  return String(value ?? '')
    .trim()
    .replaceAll(/\s+/g, ' ')
    .slice(0, maximumLength)
}

function parseDateKey(value: unknown) {
  const normalized = normalizeText(value, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null

  const date = new Date(`${normalized}T12:00:00Z`)
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== normalized
  ) {
    return null
  }

  return normalized
}

function getPragueDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function isWorkingDay(dateKey: string) {
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay()
  return day >= 1 && day <= 5
}

function getWorkingDays(from: string, to: string) {
  const result: string[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isWorkingDay(date)) result.push(date)
  }
  return result
}

function shuffle<T>(values: T[]) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1)
    crypto.getRandomValues(random)
    const swapIndex = random[0] % (index + 1)
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function allocateDistance(weights: number[], totalKm: number) {
  if (weights.length === 0 || totalKm < weights.length) return null

  const distributable = totalKm - weights.length
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  const rawShares = weights.map(
    (weight) => (weight / weightTotal) * distributable
  )
  const allocated = rawShares.map((share) => Math.floor(share) + 1)
  let remainder = totalKm - allocated.reduce((sum, value) => sum + value, 0)
  const order = rawShares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((left, right) => right.remainder - left.remainder)

  for (let index = 0; remainder > 0; index += 1) {
    allocated[order[index % order.length].index] += 1
    remainder -= 1
  }

  return allocated
}

async function getAdminContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, error: 'Pro správu Knih jízd se musíš přihlásit.' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>()

  if (profileError || profile?.role !== 'admin') {
    return {
      supabase,
      user: null,
      error: 'Nemáš oprávnění používat Automatickou knihu jízd.',
    }
  }

  return { supabase, user, error: null }
}

async function fetchJson<T>(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': MAP_USER_AGENT,
      },
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Mapová služba vrátila HTTP ${response.status}.`)
    }

    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

async function geocodeCity(city: string) {
  const cacheKey = city.toLocaleLowerCase('cs-CZ')
  const cached = geocodeCache.get(cacheKey)
  if (cached) return cached

  const elapsed = Date.now() - lastNominatimRequestAt
  if (elapsed < 1_050) {
    await new Promise((resolve) => setTimeout(resolve, 1_050 - elapsed))
  }
  lastNominatimRequestAt = Date.now()

  const query = new URLSearchParams({
    q: `${city}, Česko`,
    format: 'jsonv2',
    countrycodes: 'cz',
    limit: '1',
  })
  const results = await fetchJson<NominatimResult[]>(
    `${NOMINATIM_BASE_URL.replace(/\/$/, '')}/search?${query.toString()}`
  )
  const result = results[0]
  const latitude = Number(result?.lat)
  const longitude = Number(result?.lon)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`Město „${city}“ nebylo v ČR nalezeno.`)
  }

  const coordinates = { latitude, longitude }
  geocodeCache.set(cacheKey, coordinates)
  return coordinates
}

async function getFastestRouteKm(from: Coordinates, to: Coordinates) {
  const cacheKey = [
    from.longitude.toFixed(6),
    from.latitude.toFixed(6),
    to.longitude.toFixed(6),
    to.latitude.toFixed(6),
  ].join(',')
  const cached = routeCache.get(cacheKey)
  if (cached) return cached

  const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`
  const result = await fetchJson<OsrmResult>(
    `${OSRM_BASE_URL.replace(/\/$/, '')}/route/v1/driving/${coordinates}?alternatives=false&steps=false&overview=false`
  )
  const distanceMeters = result.routes?.[0]?.distance

  if (
    result.code !== 'Ok' ||
    !Number.isFinite(distanceMeters) ||
    Number(distanceMeters) <= 0
  ) {
    throw new Error('Pro jednu z tras nebyla nalezena sjízdná automobilová trasa.')
  }

  const distanceKm = Math.max(1, Math.round(Number(distanceMeters) / 1000))
  routeCache.set(cacheKey, distanceKm)
  return distanceKm
}

function normalizePreviewInput(input: AutomaticTripPreviewInput) {
  const vehicleId = normalizeUuid(input.vehicleId)
  const periodFrom = parseDateKey(input.periodFrom)
  const periodTo = parseDateKey(input.periodTo)
  const departureCity = normalizeText(input.departureCity, 120)
  const odometerStartKm = Number(input.odometerStartKm)
  const odometerEndKm = Number(input.odometerEndKm)
  const combinedDestinations = new Map<string, AutomaticTripDestinationInput>()

  for (const destination of input.destinations.slice(0, MAX_DESTINATION_ROWS)) {
    const city = normalizeText(destination.city, 120)
    const visits = Number(destination.visits)
    if (!city || !Number.isInteger(visits) || visits < 1 || visits > 50) continue

    const key = city.toLocaleLowerCase('cs-CZ')
    const existing = combinedDestinations.get(key)
    combinedDestinations.set(key, {
      city,
      visits: (existing?.visits ?? 0) + visits,
    })
  }

  const destinations = [...combinedDestinations.values()]
  return {
    vehicleId,
    periodFrom,
    periodTo,
    departureCity,
    odometerStartKm,
    odometerEndKm,
    destinations,
  }
}

export async function generateAutomaticTripPreviewAction(
  input: AutomaticTripPreviewInput
): Promise<AutomaticTripPreviewResult> {
  const failure = (error: string): AutomaticTripPreviewResult => ({
    success: false,
    error,
    rows: [],
    mapTotalKm: 0,
    assignedTotalKm: 0,
    differenceKm: 0,
    destinations: [],
  })
  const { supabase, user, error: authorizationError } = await getAdminContext()
  if (!user) return failure(authorizationError ?? 'Nemáš oprávnění.')

  const normalized = normalizePreviewInput(input)
  if (
    !normalized.vehicleId ||
    !normalized.periodFrom ||
    !normalized.periodTo
  ) {
    return failure('Vyber platné vozidlo a období.')
  }

  const today = getPragueDateKey()
  if (
    normalized.periodFrom > normalized.periodTo ||
    normalized.periodTo > today
  ) {
    return failure('Období musí být platné a nesmí končit v budoucnosti.')
  }

  const periodLength =
    Math.round(
      (new Date(`${normalized.periodTo}T12:00:00Z`).getTime() -
        new Date(`${normalized.periodFrom}T12:00:00Z`).getTime()) /
        86_400_000
    ) + 1
  if (periodLength > 366) {
    return failure('Najednou lze generovat období dlouhé maximálně jeden rok.')
  }

  if (!normalized.departureCity) {
    return failure('Vyplň výjezdové místo vozidla.')
  }

  if (normalized.destinations.length === 0) {
    return failure('Přidej alespoň jedno cílové město a počet návštěv.')
  }

  if (
    normalized.destinations.some(
      (destination) =>
        destination.city.toLocaleLowerCase('cs-CZ') ===
        normalized.departureCity.toLocaleLowerCase('cs-CZ')
    )
  ) {
    return failure('Cílové město se musí lišit od výjezdového místa.')
  }

  const visitCount = normalized.destinations.reduce(
    (sum, destination) => sum + destination.visits,
    0
  )
  if (visitCount > MAX_GENERATED_VISITS) {
    return failure(`V jedné dávce lze vytvořit maximálně ${MAX_GENERATED_VISITS} návštěv.`)
  }

  if (
    !Number.isInteger(normalized.odometerStartKm) ||
    !Number.isInteger(normalized.odometerEndKm) ||
    normalized.odometerStartKm < 0 ||
    normalized.odometerEndKm <= normalized.odometerStartKm ||
    normalized.odometerEndKm > 9_999_999
  ) {
    return failure('Vyplň platný počáteční a konečný stav tachometru.')
  }

  const assignedTotalKm =
    normalized.odometerEndKm - normalized.odometerStartKm
  if (assignedTotalKm < visitCount * 2) {
    return failure('Rozdíl tachometru je příliš malý pro všechny cesty tam a zpět.')
  }

  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicle_logbook_vehicles')
    .select('id')
    .eq('id', normalized.vehicleId)
    .eq('is_active', true)
    .maybeSingle<{ id: string }>()
  if (vehicleError || !vehicle) {
    return failure('Vybrané aktivní vozidlo se nepodařilo načíst.')
  }

  const { data: existingEntries, error: entriesError } = await supabase
    .from('vehicle_logbook_entries')
    .select('trip_date')
    .eq('vehicle_id', normalized.vehicleId)
    .is('deleted_at', null)
    .gte('trip_date', normalized.periodFrom)
    .lte('trip_date', normalized.periodTo)
    .returns<Array<{ trip_date: string }>>()
  if (entriesError) {
    return failure(`Existující jízdy se nepodařilo ověřit: ${entriesError.message}`)
  }

  if ((existingEntries ?? []).length > 0) {
    return failure(
      'Ve zvoleném období už existují jízdy. Automatická rekonstrukce vyžaduje prázdné období.'
    )
  }

  const availableDays = getWorkingDays(
    normalized.periodFrom,
    normalized.periodTo
  )
  if (visitCount > availableDays.length) {
    return failure(
      `Pro ${visitCount} návštěv není v období dost volných pracovních dnů. K dispozici je ${availableDays.length}.`
    )
  }

  try {
    const departureCoordinates = await geocodeCity(normalized.departureCity)
    const routes = new Map<
      string,
      { outboundMapKm: number; returnMapKm: number }
    >()

    for (const destination of normalized.destinations) {
      const destinationCoordinates = await geocodeCity(destination.city)
      const [outboundMapKm, returnMapKm] = await Promise.all([
        getFastestRouteKm(departureCoordinates, destinationCoordinates),
        getFastestRouteKm(destinationCoordinates, departureCoordinates),
      ])
      routes.set(destination.city.toLocaleLowerCase('cs-CZ'), {
        outboundMapKm,
        returnMapKm,
      })
    }

    const visits = shuffle(
      normalized.destinations.flatMap((destination) =>
        Array.from({ length: destination.visits }, () => destination.city)
      )
    )
    const dates = shuffle(availableDays).slice(0, visitCount).sort()
    const weights = visits.flatMap((city) => {
      const route = routes.get(city.toLocaleLowerCase('cs-CZ'))
      return [route?.outboundMapKm ?? 1, route?.returnMapKm ?? 1]
    })
    const allocated = allocateDistance(weights, assignedTotalKm)
    if (!allocated) {
      return failure('Kilometry se nepodařilo rozdělit mezi jednotlivé trasy.')
    }

    const rows = visits
      .map((city, index) => {
        const route = routes.get(city.toLocaleLowerCase('cs-CZ'))!
        return {
          id: crypto.randomUUID(),
          date: dates[index],
          city,
          outboundMapKm: route.outboundMapKm,
          returnMapKm: route.returnMapKm,
          outboundKm: allocated[index * 2],
          returnKm: allocated[index * 2 + 1],
        }
      })
      .sort((left, right) => left.date.localeCompare(right.date))
    const mapTotalKm = rows.reduce(
      (sum, row) => sum + row.outboundMapKm + row.returnMapKm,
      0
    )

    return {
      success: true,
      error: null,
      rows,
      mapTotalKm,
      assignedTotalKm,
      differenceKm: assignedTotalKm - mapTotalKm,
      destinations: normalized.destinations,
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes('nebylo v ČR nalezeno')
        ? error.message
        : 'Mapová služba není dostupná nebo nedokázala vypočítat trasu. Generování bylo zastaveno.'
    return failure(message)
  }
}

export async function confirmAutomaticTripsAction(
  _previousState: ConfirmAutomaticTripsState,
  formData: FormData
): Promise<ConfirmAutomaticTripsState> {
  const { supabase, user, error: authorizationError } = await getAdminContext()
  if (!user) {
    return { success: false, error: authorizationError, createdTrips: 0 }
  }

  const vehicleId = normalizeUuid(formData.get('vehicle_id'))
  const periodFrom = parseDateKey(formData.get('period_from'))
  const periodTo = parseDateKey(formData.get('period_to'))
  const departureCity = normalizeText(formData.get('departure_city'), 120)
  const odometerStartKm = Number(formData.get('odometer_start_km'))
  const odometerEndKm = Number(formData.get('odometer_end_km'))
  const destinationsJson = normalizeText(formData.get('destinations_json'), 20_000)
  const rowsJson = normalizeText(formData.get('rows_json'), 100_000)

  if (!vehicleId || !periodFrom || !periodTo || !departureCity) {
    return { success: false, error: 'Parametry generování nejsou platné.', createdTrips: 0 }
  }

  let destinations: AutomaticTripDestinationInput[]
  let rows: AutomaticTripPreviewRow[]
  try {
    destinations = JSON.parse(destinationsJson) as AutomaticTripDestinationInput[]
    rows = JSON.parse(rowsJson) as AutomaticTripPreviewRow[]
  } catch {
    return { success: false, error: 'Návrh jízd je poškozený.', createdTrips: 0 }
  }

  if (
    rows.length === 0 ||
    rows.length > MAX_GENERATED_VISITS ||
    !Number.isInteger(odometerStartKm) ||
    !Number.isInteger(odometerEndKm) ||
    odometerEndKm <= odometerStartKm
  ) {
    return { success: false, error: 'Návrh jízd není platný.', createdTrips: 0 }
  }

  const dates = rows.map((row) => parseDateKey(row.date))
  const uniqueDates = new Set(dates)
  if (
    dates.some(
      (date) =>
        !date ||
        date < periodFrom ||
        date > periodTo ||
        !isWorkingDay(date)
    ) ||
    uniqueDates.size !== rows.length
  ) {
    return {
      success: false,
      error: 'Každá návštěva musí mít jedinečný pracovní den ve zvoleném období.',
      createdTrips: 0,
    }
  }

  const normalizedRows = rows
    .map((row) => ({
      ...row,
      city: normalizeText(row.city, 120),
      outboundMapKm: Number(row.outboundMapKm),
      returnMapKm: Number(row.returnMapKm),
      outboundKm: Number(row.outboundKm),
      returnKm: Number(row.returnKm),
    }))
    .sort((left, right) => left.date.localeCompare(right.date))
  const invalidRow = normalizedRows.some(
    (row) =>
      !row.city ||
      !Number.isInteger(row.outboundKm) ||
      !Number.isInteger(row.returnKm) ||
      row.outboundKm < 1 ||
      row.returnKm < 1 ||
      !Number.isFinite(row.outboundMapKm) ||
      !Number.isFinite(row.returnMapKm) ||
      row.outboundMapKm < 1 ||
      row.returnMapKm < 1
  )
  const assignedTotal = normalizedRows.reduce(
    (sum, row) => sum + row.outboundKm + row.returnKm,
    0
  )
  if (invalidRow || assignedTotal !== odometerEndKm - odometerStartKm) {
    return {
      success: false,
      error: 'Rozdělení kilometrů v návrhu neodpovídá stavům tachometru.',
      createdTrips: 0,
    }
  }

  const [vehicleResponse, existingResponse, previousResponse, nextResponse] =
    await Promise.all([
      supabase
        .from('vehicle_logbook_vehicles')
        .select('id, initial_odometer_km, initial_odometer_recorded_on')
        .eq('id', vehicleId)
        .eq('is_active', true)
        .maybeSingle<{
          id: string
          initial_odometer_km: number | null
          initial_odometer_recorded_on: string | null
        }>(),
      supabase
        .from('vehicle_logbook_entries')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .is('deleted_at', null)
        .gte('trip_date', periodFrom)
        .lte('trip_date', periodTo)
        .limit(1),
      supabase
        .from('vehicle_logbook_entries')
        .select('odometer_end_km')
        .eq('vehicle_id', vehicleId)
        .is('deleted_at', null)
        .lt('trip_date', periodFrom)
        .order('trip_date', { ascending: false })
        .order('day_sequence', { ascending: false })
        .limit(1)
        .maybeSingle<{ odometer_end_km: number }>(),
      supabase
        .from('vehicle_logbook_entries')
        .select('odometer_start_km')
        .eq('vehicle_id', vehicleId)
        .is('deleted_at', null)
        .gt('trip_date', periodTo)
        .order('trip_date', { ascending: true })
        .order('day_sequence', { ascending: true })
        .limit(1)
        .maybeSingle<{ odometer_start_km: number }>(),
    ])

  const firstError =
    vehicleResponse.error ??
    existingResponse.error ??
    previousResponse.error ??
    nextResponse.error
  if (firstError || !vehicleResponse.data) {
    return {
      success: false,
      error: `Návaznost záznamů se nepodařilo ověřit: ${firstError?.message ?? 'vozidlo neexistuje'}`,
      createdTrips: 0,
    }
  }

  if ((existingResponse.data ?? []).length > 0) {
    return {
      success: false,
      error: 'Ve zvoleném období už existují jízdy. Generování bylo zastaveno.',
      createdTrips: 0,
    }
  }

  if (
    previousResponse.data &&
    previousResponse.data.odometer_end_km !== odometerStartKm
  ) {
    return {
      success: false,
      error: `Počáteční stav musí navazovat na předchozích ${previousResponse.data.odometer_end_km.toLocaleString('cs-CZ')} km.`,
      createdTrips: 0,
    }
  }

  if (
    nextResponse.data &&
    nextResponse.data.odometer_start_km !== odometerEndKm
  ) {
    return {
      success: false,
      error: `Konečný stav musí navazovat na následujících ${nextResponse.data.odometer_start_km.toLocaleString('cs-CZ')} km.`,
      createdTrips: 0,
    }
  }

  const rpcRows = normalizedRows.map((row) => ({
    date: row.date,
    city: row.city,
    outbound_map_km: row.outboundMapKm,
    return_map_km: row.returnMapKm,
    outbound_km: row.outboundKm,
    return_km: row.returnKm,
  }))
  const { data: confirmationRows, error: confirmationError } = await supabase.rpc(
    'confirm_vehicle_logbook_automatic_trips',
    {
      p_vehicle_id: vehicleId,
      p_period_from: periodFrom,
      p_period_to: periodTo,
      p_departure_city: departureCity,
      p_odometer_start_km: odometerStartKm,
      p_odometer_end_km: odometerEndKm,
      p_destinations: destinations,
      p_rows: rpcRows,
    }
  )

  if (confirmationError) {
    return {
      success: false,
      error: `Automatické jízdy se nepodařilo uložit: ${confirmationError.message}`,
      createdTrips: 0,
    }
  }

  const createdTrips = Number(
    (confirmationRows as Array<{ created_trips?: number }> | null)?.[0]
      ?.created_trips ?? 0
  )
  if (createdTrips !== normalizedRows.length * 2) {
    return {
      success: false,
      error: 'Databáze nepotvrdila očekávaný počet automatických jízd.',
      createdTrips: 0,
    }
  }

  revalidatePath('/knihy-jizd')
  return {
    success: true,
    error: null,
    createdTrips,
  }
}
