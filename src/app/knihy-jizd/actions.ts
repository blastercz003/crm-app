'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type UpdateVehicleOdometerState = {
  success: boolean
  error: string | null
}

export type CreateVehicleLogbookEntryState = {
  success: boolean
  error: string | null
}

export type CreateVehicleLogbookFuelState = {
  success: boolean
  error: string | null
}

export type VehicleLogbookClosurePreview = {
  period: string
  openingOdometerKm: number | null
  closingOdometerKm: number | null
  businessKm: number
  privateKm: number
  tripCount: number
  fuelEntryCount: number
  fuelNetAmount: number
  fuelVatAmount: number
  fuelGrossAmount: number
  closureStatus: 'none' | 'valid' | 'changed'
  calculatedAt: string | null
  error: string | null
}

export type RecalculateVehicleLogbookClosureState = {
  success: boolean
  error: string | null
}

const VEHICLE_LOGBOOK_FILES_BUCKET = 'vehicle-logbook-files'
const MAX_FUEL_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024
const FUEL_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function normalizeUuid(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '').trim()

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized
  )
    ? normalized
    : null
}

function normalizeText(
  value: FormDataEntryValue | null,
  maximumLength: number
) {
  return String(value ?? '').trim().replaceAll(/\s+/g, ' ').slice(0, maximumLength)
}

function normalizeInteger(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '')
    .trim()
    .replaceAll(/\s+/g, '')
    .replace(',', '.')
  const parsed = Number(normalized)

  return Number.isInteger(parsed) ? parsed : null
}

function normalizeDecimal(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '')
    .trim()
    .replaceAll(/\s+/g, '')
    .replace(',', '.')
  const parsed = Number(normalized)

  return Number.isFinite(parsed) ? parsed : null
}

function sanitizeFileName(value: string) {
  return value
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[^a-zA-Z0-9._-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 120)
}

function getPragueDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function parsePeriod(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return null

  const [year, month] = value.split('-').map(Number)
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return null

  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)

  return { year, month, start, end, key: value }
}

async function getAdminContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      supabase,
      user: null,
      error: 'Pro správu Knih jízd se musíš znovu přihlásit.',
    }
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
      error: 'Nemáš oprávnění upravovat Knihy jízd.',
    }
  }

  return { supabase, user, error: null }
}

export async function updateVehicleOdometerAction(
  _previousState: UpdateVehicleOdometerState,
  formData: FormData
): Promise<UpdateVehicleOdometerState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Pro úpravu tachometru se musíš znovu přihlásit.' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>()

  if (profileError || profile?.role !== 'admin') {
    return { success: false, error: 'Nemáš oprávnění upravovat Knihy jízd.' }
  }

  const vehicleId = normalizeUuid(formData.get('vehicle_id'))
  const rawOdometer = String(formData.get('initial_odometer_km') ?? '')
    .replaceAll(/\s+/g, '')
    .replace(',', '.')
  const odometer = Number(rawOdometer)

  if (!vehicleId) {
    return { success: false, error: 'Vybrané vozidlo není platné.' }
  }

  if (!Number.isInteger(odometer) || odometer < 0 || odometer > 9_999_999) {
    return {
      success: false,
      error: 'Počáteční stav tachometru musí být celé nezáporné číslo.',
    }
  }

  const { error } = await supabase
    .from('vehicle_logbook_vehicles')
    .update({
      initial_odometer_km: odometer,
      initial_odometer_recorded_on: new Date().toISOString().slice(0, 10),
      updated_by: user.id,
    })
    .eq('id', vehicleId)
    .eq('is_active', true)

  if (error) {
    return {
      success: false,
      error: `Počáteční stav tachometru se nepodařilo uložit: ${error.message}`,
    }
  }

  revalidatePath('/knihy-jizd')
  revalidatePath('/majetek', 'layout')
  return { success: true, error: null }
}

export async function createVehicleLogbookEntryAction(
  _previousState: CreateVehicleLogbookEntryState,
  formData: FormData
): Promise<CreateVehicleLogbookEntryState> {
  const { supabase, user, error: authorizationError } = await getAdminContext()

  if (!user) {
    return { success: false, error: authorizationError }
  }

  const vehicleId = normalizeUuid(formData.get('vehicle_id'))
  const tripDate = normalizeText(formData.get('trip_date'), 10)
  const entryType = normalizeText(formData.get('entry_type'), 24)
  const usageType = normalizeText(formData.get('usage_type'), 24)
  const origin = normalizeText(formData.get('origin'), 180)
  const destination = normalizeText(formData.get('destination'), 180)
  const purpose =
    normalizeText(formData.get('purpose'), 240) ||
    'Služební, jednání / průzkum'
  const note = normalizeText(formData.get('note'), 1000) || null
  const odometerEndKm = normalizeInteger(formData.get('odometer_end_km'))
  const mixedBusinessKm = normalizeInteger(formData.get('business_km'))
  const mixedPrivateKm = normalizeInteger(formData.get('private_km'))

  if (!vehicleId) {
    return { success: false, error: 'Vybrané vozidlo není platné.' }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(tripDate)) {
    return { success: false, error: 'Vyplň platné datum jízdy.' }
  }

  const parsedDate = new Date(`${tripDate}T12:00:00Z`)
  const today = getPragueDateKey()
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== tripDate ||
    tripDate > today
  ) {
    return { success: false, error: 'Datum jízdy nesmí být v budoucnosti.' }
  }

  if (entryType !== 'trip' && entryType !== 'daily_summary') {
    return { success: false, error: 'Vyber platný typ záznamu.' }
  }

  if (
    usageType !== 'business' &&
    usageType !== 'private' &&
    usageType !== 'mixed'
  ) {
    return { success: false, error: 'Vyber platný způsob využití vozidla.' }
  }

  if (usageType === 'mixed' && entryType !== 'daily_summary') {
    return {
      success: false,
      error: 'Smíšené využití lze zapsat pouze jako denní souhrn.',
    }
  }

  if (!origin || !destination) {
    return { success: false, error: 'Vyplň výchozí i cílové místo.' }
  }

  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicle_logbook_vehicles')
    .select('id, initial_odometer_km')
    .eq('id', vehicleId)
    .eq('is_active', true)
    .maybeSingle<{ id: string; initial_odometer_km: number | null }>()

  if (vehicleError || !vehicle) {
    return {
      success: false,
      error: 'Vybrané aktivní vozidlo se nepodařilo načíst.',
    }
  }

  if (vehicle.initial_odometer_km === null) {
    return {
      success: false,
      error: 'Nejdříve nastav počáteční stav tachometru vozidla.',
    }
  }

  const { data: latestEntry, error: latestEntryError } = await supabase
    .from('vehicle_logbook_entries')
    .select('trip_date, odometer_end_km')
    .eq('vehicle_id', vehicleId)
    .is('deleted_at', null)
    .order('trip_date', { ascending: false })
    .order('day_sequence', { ascending: false })
    .limit(1)
    .maybeSingle<{ trip_date: string; odometer_end_km: number }>()

  if (latestEntryError) {
    return {
      success: false,
      error: `Návaznost tachometru se nepodařilo ověřit: ${latestEntryError.message}`,
    }
  }

  if (latestEntry && tripDate < latestEntry.trip_date) {
    return {
      success: false,
      error:
        'Ruční jízda musí časově navazovat na poslední záznam. Starší období doplň pomocí funkce AUTOMAT.',
    }
  }

  const odometerStartKm =
    latestEntry?.odometer_end_km ?? vehicle.initial_odometer_km

  if (
    odometerEndKm === null ||
    odometerEndKm <= odometerStartKm ||
    odometerEndKm > 9_999_999
  ) {
    return {
      success: false,
      error: `Konečný stav tachometru musí být vyšší než ${odometerStartKm.toLocaleString('cs-CZ')} km.`,
    }
  }

  const distanceKm = odometerEndKm - odometerStartKm
  let businessKm = usageType === 'business' ? distanceKm : 0
  let privateKm = usageType === 'private' ? distanceKm : 0

  if (usageType === 'mixed') {
    if (
      mixedBusinessKm === null ||
      mixedPrivateKm === null ||
      mixedBusinessKm <= 0 ||
      mixedPrivateKm <= 0 ||
      mixedBusinessKm + mixedPrivateKm !== distanceKm
    ) {
      return {
        success: false,
        error: `Služební a soukromé kilometry musí být kladné a jejich součet musí být ${distanceKm.toLocaleString('cs-CZ')} km.`,
      }
    }

    businessKm = mixedBusinessKm
    privateKm = mixedPrivateKm
  }

  const { data: lastEntryOfDay, error: sequenceError } = await supabase
    .from('vehicle_logbook_entries')
    .select('day_sequence')
    .eq('vehicle_id', vehicleId)
    .eq('trip_date', tripDate)
    .is('deleted_at', null)
    .order('day_sequence', { ascending: false })
    .limit(1)
    .maybeSingle<{ day_sequence: number }>()

  if (sequenceError) {
    return {
      success: false,
      error: `Pořadí jízdy se nepodařilo určit: ${sequenceError.message}`,
    }
  }

  const { error: insertError } = await supabase
    .from('vehicle_logbook_entries')
    .insert({
      vehicle_id: vehicleId,
      entry_type: entryType,
      usage_type: usageType,
      source_type: 'manual',
      trip_date: tripDate,
      day_sequence: (lastEntryOfDay?.day_sequence ?? 0) + 1,
      origin,
      destination,
      purpose,
      odometer_start_km: odometerStartKm,
      odometer_end_km: odometerEndKm,
      business_km: businessKm,
      private_km: privateKm,
      note,
      created_by: user.id,
      updated_by: user.id,
    })

  if (insertError) {
    return {
      success: false,
      error: `Jízdu se nepodařilo uložit: ${insertError.message}`,
    }
  }

  revalidatePath('/knihy-jizd')
  revalidatePath('/majetek', 'layout')
  return { success: true, error: null }
}

export async function createVehicleLogbookFuelAction(
  _previousState: CreateVehicleLogbookFuelState,
  formData: FormData
): Promise<CreateVehicleLogbookFuelState> {
  const { supabase, user, error: authorizationError } = await getAdminContext()

  if (!user) {
    return { success: false, error: authorizationError }
  }

  const vehicleId = normalizeUuid(formData.get('vehicle_id'))
  const fueledOn = normalizeText(formData.get('fueled_on'), 10)
  const odometerKm = normalizeInteger(formData.get('odometer_km'))
  const energyType = normalizeText(formData.get('energy_type'), 24)
  const quantity = normalizeDecimal(formData.get('quantity'))
  const grossAmount = normalizeDecimal(formData.get('gross_amount'))
  const supplier = normalizeText(formData.get('supplier'), 180) || null
  const documentNumber =
    normalizeText(formData.get('document_number'), 120) || null
  const note = normalizeText(formData.get('note'), 1000) || null
  const isFullTank = formData.get('is_full_tank') === 'on'
  const fileEntry = formData.get('document')
  const documentFile =
    fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null
  const documentExtension = documentFile?.name.split('.').pop()?.toLowerCase()
  const inferredDocumentMimeType =
    documentExtension === 'pdf'
      ? 'application/pdf'
      : documentExtension === 'jpg' || documentExtension === 'jpeg'
        ? 'image/jpeg'
        : documentExtension === 'png'
          ? 'image/png'
          : documentExtension === 'webp'
            ? 'image/webp'
            : documentExtension === 'heic'
              ? 'image/heic'
              : documentExtension === 'heif'
                ? 'image/heif'
                : ''
  const documentMimeType =
    documentFile?.type.trim().toLowerCase() || inferredDocumentMimeType

  if (!vehicleId) {
    return { success: false, error: 'Vybrané vozidlo není platné.' }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fueledOn)) {
    return { success: false, error: 'Vyplň platné datum tankování.' }
  }

  const parsedDate = new Date(`${fueledOn}T12:00:00Z`)
  const today = getPragueDateKey()
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== fueledOn ||
    fueledOn > today
  ) {
    return {
      success: false,
      error: 'Datum tankování nebo nabíjení nesmí být v budoucnosti.',
    }
  }

  if (
    energyType !== 'petrol' &&
    energyType !== 'diesel' &&
    energyType !== 'electricity'
  ) {
    return { success: false, error: 'Vyber platný druh paliva nebo energie.' }
  }

  if (odometerKm === null || odometerKm < 0 || odometerKm > 9_999_999) {
    return { success: false, error: 'Vyplň platný stav tachometru.' }
  }

  if (quantity === null || quantity <= 0 || quantity > 999_999_999) {
    return { success: false, error: 'Vyplň platné množství paliva nebo energie.' }
  }

  if (grossAmount === null || grossAmount <= 0 || grossAmount > 999_999_999_999) {
    return { success: false, error: 'Vyplň platnou celkovou cenu s DPH.' }
  }

  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicle_logbook_vehicles')
    .select('id, initial_odometer_km')
    .eq('id', vehicleId)
    .eq('is_active', true)
    .maybeSingle<{ id: string; initial_odometer_km: number | null }>()

  if (vehicleError || !vehicle) {
    return {
      success: false,
      error: 'Vybrané aktivní vozidlo se nepodařilo načíst.',
    }
  }

  if (
    vehicle.initial_odometer_km !== null &&
    odometerKm < vehicle.initial_odometer_km
  ) {
    return {
      success: false,
      error: `Stav tachometru nesmí být nižší než počátečních ${vehicle.initial_odometer_km.toLocaleString('cs-CZ')} km.`,
    }
  }

  const [
    previousTripResponse,
    previousFuelResponse,
    nextTripResponse,
    nextFuelResponse,
  ] = await Promise.all([
    supabase
      .from('vehicle_logbook_entries')
      .select('trip_date, odometer_end_km')
      .eq('vehicle_id', vehicleId)
      .is('deleted_at', null)
      .lt('trip_date', fueledOn)
      .order('trip_date', { ascending: false })
      .order('day_sequence', { ascending: false })
      .limit(1)
      .maybeSingle<{ trip_date: string; odometer_end_km: number }>(),
    supabase
      .from('vehicle_logbook_fuel_entries')
      .select('fueled_on, odometer_km')
      .eq('vehicle_id', vehicleId)
      .is('deleted_at', null)
      .lt('fueled_on', fueledOn)
      .order('fueled_on', { ascending: false })
      .order('odometer_km', { ascending: false })
      .limit(1)
      .maybeSingle<{ fueled_on: string; odometer_km: number }>(),
    supabase
      .from('vehicle_logbook_entries')
      .select('trip_date, odometer_start_km')
      .eq('vehicle_id', vehicleId)
      .is('deleted_at', null)
      .gt('trip_date', fueledOn)
      .order('trip_date', { ascending: true })
      .order('day_sequence', { ascending: true })
      .limit(1)
      .maybeSingle<{ trip_date: string; odometer_start_km: number }>(),
    supabase
      .from('vehicle_logbook_fuel_entries')
      .select('fueled_on, odometer_km')
      .eq('vehicle_id', vehicleId)
      .is('deleted_at', null)
      .gt('fueled_on', fueledOn)
      .order('fueled_on', { ascending: true })
      .order('odometer_km', { ascending: true })
      .limit(1)
      .maybeSingle<{ fueled_on: string; odometer_km: number }>(),
  ])

  const chronologyError =
    previousTripResponse.error ??
    previousFuelResponse.error ??
    nextTripResponse.error ??
    nextFuelResponse.error
  if (chronologyError) {
    return {
      success: false,
      error: `Návaznost tachometru se nepodařilo ověřit: ${chronologyError.message}`,
    }
  }

  const previousReadings = [
    previousTripResponse.data
      ? {
          date: previousTripResponse.data.trip_date,
          odometer: previousTripResponse.data.odometer_end_km,
        }
      : null,
    previousFuelResponse.data
      ? {
          date: previousFuelResponse.data.fueled_on,
          odometer: previousFuelResponse.data.odometer_km,
        }
      : null,
  ].filter(
    (reading): reading is { date: string; odometer: number } =>
      reading !== null
  )
  const previousDate = previousReadings.reduce(
    (latest, reading) => (reading.date > latest ? reading.date : latest),
    ''
  )
  const previousOdometer = previousReadings
    .filter((reading) => reading.date === previousDate)
    .reduce<number | null>(
      (highest, reading) =>
        highest === null ? reading.odometer : Math.max(highest, reading.odometer),
      null
    )

  if (previousOdometer !== null && odometerKm < previousOdometer) {
    return {
      success: false,
      error: `Stav tachometru musí být alespoň ${previousOdometer.toLocaleString('cs-CZ')} km podle předchozího záznamu z ${previousDate}.`,
    }
  }

  const nextReadings = [
    nextTripResponse.data
      ? {
          date: nextTripResponse.data.trip_date,
          odometer: nextTripResponse.data.odometer_start_km,
        }
      : null,
    nextFuelResponse.data
      ? {
          date: nextFuelResponse.data.fueled_on,
          odometer: nextFuelResponse.data.odometer_km,
        }
      : null,
  ].filter(
    (reading): reading is { date: string; odometer: number } =>
      reading !== null
  )
  const nextDate = nextReadings.reduce(
    (earliest, reading) =>
      !earliest || reading.date < earliest ? reading.date : earliest,
    ''
  )
  const nextOdometer = nextReadings
    .filter((reading) => reading.date === nextDate)
    .reduce<number | null>(
      (lowest, reading) =>
        lowest === null ? reading.odometer : Math.min(lowest, reading.odometer),
      null
    )

  if (nextOdometer !== null && odometerKm > nextOdometer) {
    return {
      success: false,
      error: `Stav tachometru může být nejvýše ${nextOdometer.toLocaleString('cs-CZ')} km podle následujícího záznamu z ${nextDate}.`,
    }
  }

  if (documentFile) {
    if (!FUEL_DOCUMENT_MIME_TYPES.has(documentMimeType)) {
      return {
        success: false,
        error: 'Doklad musí být PDF nebo obrázek JPG, PNG, WEBP, HEIC či HEIF.',
      }
    }

    if (documentFile.size > MAX_FUEL_DOCUMENT_SIZE_BYTES) {
      return { success: false, error: 'Doklad může mít maximálně 25 MB.' }
    }
  }

  const fuelEntryId = crypto.randomUUID()
  let storagePath: string | null = null

  if (documentFile) {
    const safeFileName = sanitizeFileName(documentFile.name) || 'doklad'
    storagePath = `knihy-jizd/${vehicleId}/tankovani/${fuelEntryId}/${crypto.randomUUID()}-${safeFileName}`
    const buffer = Buffer.from(await documentFile.arrayBuffer())
    const { error: uploadError } = await supabase.storage
      .from(VEHICLE_LOGBOOK_FILES_BUCKET)
      .upload(storagePath, buffer, {
        cacheControl: '3600',
        contentType: documentMimeType,
        upsert: false,
      })

    if (uploadError) {
      return {
        success: false,
        error: `Doklad se nepodařilo nahrát: ${uploadError.message}`,
      }
    }
  }

  const { error: insertError } = await supabase
    .from('vehicle_logbook_fuel_entries')
    .insert({
      id: fuelEntryId,
      vehicle_id: vehicleId,
      fueled_on: fueledOn,
      odometer_km: odometerKm,
      energy_type: energyType,
      quantity,
      unit: energyType === 'electricity' ? 'kwh' : 'litre',
      gross_amount: grossAmount,
      vat_rate: 21,
      supplier,
      document_number: documentNumber,
      is_full_tank: energyType === 'electricity' ? false : isFullTank,
      note,
      created_by: user.id,
      updated_by: user.id,
    })

  if (insertError) {
    if (storagePath) {
      await supabase.storage.from(VEHICLE_LOGBOOK_FILES_BUCKET).remove([storagePath])
    }

    return {
      success: false,
      error: `Tankování se nepodařilo uložit: ${insertError.message}`,
    }
  }

  if (documentFile && storagePath) {
    const { error: attachmentError } = await supabase
      .from('vehicle_logbook_fuel_attachments')
      .insert({
        fuel_entry_id: fuelEntryId,
        storage_path: storagePath,
        file_name: documentFile.name.slice(0, 255),
        mime_type: documentMimeType,
        file_size_bytes: documentFile.size,
        uploaded_by: user.id,
      })

    if (attachmentError) {
      await Promise.all([
        supabase.storage
          .from(VEHICLE_LOGBOOK_FILES_BUCKET)
          .remove([storagePath]),
        supabase
          .from('vehicle_logbook_fuel_entries')
          .update({
            deleted_at: new Date().toISOString(),
            deleted_by: user.id,
            updated_by: user.id,
          })
          .eq('id', fuelEntryId),
      ])

      return {
        success: false,
        error: `Doklad se nepodařilo propojit se záznamem: ${attachmentError.message}`,
      }
    }
  }

  revalidatePath('/knihy-jizd')
  return { success: true, error: null }
}

export async function getVehicleLogbookClosurePreviewAction(
  vehicleIdValue: string,
  periodValue: string
): Promise<VehicleLogbookClosurePreview> {
  const emptyPreview: VehicleLogbookClosurePreview = {
    period: periodValue,
    openingOdometerKm: null,
    closingOdometerKm: null,
    businessKm: 0,
    privateKm: 0,
    tripCount: 0,
    fuelEntryCount: 0,
    fuelNetAmount: 0,
    fuelVatAmount: 0,
    fuelGrossAmount: 0,
    closureStatus: 'none',
    calculatedAt: null,
    error: null,
  }
  const { supabase, user, error: authorizationError } = await getAdminContext()

  if (!user) {
    return { ...emptyPreview, error: authorizationError }
  }

  const vehicleId = normalizeUuid(vehicleIdValue)
  const period = parsePeriod(periodValue)
  if (!vehicleId || !period) {
    return { ...emptyPreview, error: 'Vybrané vozidlo nebo měsíc není platný.' }
  }

  const [entriesResponse, fuelResponse, closureResponse] = await Promise.all([
    supabase
      .from('vehicle_logbook_entries')
      .select(
        'trip_date, day_sequence, odometer_start_km, odometer_end_km, business_km, private_km'
      )
      .eq('vehicle_id', vehicleId)
      .is('deleted_at', null)
      .gte('trip_date', period.start)
      .lt('trip_date', period.end)
      .order('trip_date', { ascending: true })
      .order('day_sequence', { ascending: true })
      .returns<
        Array<{
          trip_date: string
          day_sequence: number
          odometer_start_km: number
          odometer_end_km: number
          business_km: number
          private_km: number
        }>
      >(),
    supabase
      .from('vehicle_logbook_fuel_entries')
      .select('net_amount, vat_amount, gross_amount')
      .eq('vehicle_id', vehicleId)
      .is('deleted_at', null)
      .gte('fueled_on', period.start)
      .lt('fueled_on', period.end)
      .returns<
        Array<{
          net_amount: number | string
          vat_amount: number | string
          gross_amount: number | string
        }>
      >(),
    supabase
      .from('vehicle_logbook_monthly_closures')
      .select('changed_after_closure, calculated_at')
      .eq('vehicle_id', vehicleId)
      .eq('period_year', period.year)
      .eq('period_month', period.month)
      .maybeSingle<{
        changed_after_closure: boolean
        calculated_at: string
      }>(),
  ])

  const firstError =
    entriesResponse.error ?? fuelResponse.error ?? closureResponse.error
  if (firstError) {
    return {
      ...emptyPreview,
      period: period.key,
      error: `Náhled uzávěrky se nepodařilo načíst: ${firstError.message}`,
    }
  }

  const entries = entriesResponse.data ?? []
  const fuelEntries = fuelResponse.data ?? []
  const existingClosure = closureResponse.data

  return {
    period: period.key,
    openingOdometerKm: entries[0]?.odometer_start_km ?? null,
    closingOdometerKm: entries.at(-1)?.odometer_end_km ?? null,
    businessKm: entries.reduce(
      (sum, entry) => sum + Number(entry.business_km),
      0
    ),
    privateKm: entries.reduce(
      (sum, entry) => sum + Number(entry.private_km),
      0
    ),
    tripCount: entries.length,
    fuelEntryCount: fuelEntries.length,
    fuelNetAmount: fuelEntries.reduce(
      (sum, entry) => sum + Number(entry.net_amount),
      0
    ),
    fuelVatAmount: fuelEntries.reduce(
      (sum, entry) => sum + Number(entry.vat_amount),
      0
    ),
    fuelGrossAmount: fuelEntries.reduce(
      (sum, entry) => sum + Number(entry.gross_amount),
      0
    ),
    closureStatus: existingClosure
      ? existingClosure.changed_after_closure
        ? 'changed'
        : 'valid'
      : 'none',
    calculatedAt: existingClosure?.calculated_at ?? null,
    error: null,
  }
}

export async function recalculateVehicleLogbookClosureAction(
  _previousState: RecalculateVehicleLogbookClosureState,
  formData: FormData
): Promise<RecalculateVehicleLogbookClosureState> {
  const { supabase, user, error: authorizationError } = await getAdminContext()

  if (!user) {
    return { success: false, error: authorizationError }
  }

  const vehicleId = normalizeUuid(formData.get('vehicle_id'))
  const period = parsePeriod(normalizeText(formData.get('period'), 7))

  if (!vehicleId || !period) {
    return { success: false, error: 'Vybrané vozidlo nebo měsíc není platný.' }
  }

  const currentPeriod = getPragueDateKey().slice(0, 7)
  if (period.key > currentPeriod) {
    return { success: false, error: 'Budoucí měsíc nelze uzavřít.' }
  }

  const { error } = await supabase.rpc(
    'recalculate_vehicle_logbook_monthly_closure',
    {
      p_vehicle_id: vehicleId,
      p_period_year: period.year,
      p_period_month: period.month,
    }
  )

  if (error) {
    return {
      success: false,
      error: `Měsíční uzávěrku se nepodařilo uložit: ${error.message}`,
    }
  }

  revalidatePath('/knihy-jizd')
  return { success: true, error: null }
}
