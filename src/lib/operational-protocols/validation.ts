import type {
  NormalizedOperationalProtocolDraft,
  OperationalProtocolDraftInput,
} from './types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRAGUE_TIME_ZONE = 'Europe/Prague'
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function optionalText(value: unknown) {
  const normalized = normalizeText(value)
  return normalized || null
}

function parsePragueLocalDateTime(value: string) {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  const desiredDate = new Date(desiredAsUtc)

  if (
    desiredDate.getUTCFullYear() !== year ||
    desiredDate.getUTCMonth() !== month - 1 ||
    desiredDate.getUTCDate() !== day ||
    desiredDate.getUTCHours() !== hour ||
    desiredDate.getUTCMinutes() !== minute
  ) {
    return null
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const getParts = (date: Date) => {
    const parts = formatter.formatToParts(date)
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? '0')

    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
    }
  }

  let utcGuess = desiredAsUtc

  for (let index = 0; index < 3; index += 1) {
    const parts = getParts(new Date(utcGuess))
    const actualAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute
    )
    const difference = desiredAsUtc - actualAsUtc

    if (difference === 0) {
      return new Date(utcGuess).toISOString()
    }

    utcGuess += difference
  }

  const resolvedParts = getParts(new Date(utcGuess))
  if (
    resolvedParts.year !== year ||
    resolvedParts.month !== month ||
    resolvedParts.day !== day ||
    resolvedParts.hour !== hour ||
    resolvedParts.minute !== minute
  ) {
    return null
  }

  return new Date(utcGuess).toISOString()
}

function parseDateTime(value: unknown, label: string) {
  const normalized = normalizeText(value)
  if (!normalized) {
    return { value: null, error: `${label} je povinný údaj.` }
  }

  const isPragueLocalDateTime = LOCAL_DATE_TIME_PATTERN.test(normalized)
  const pragueDateTime = parsePragueLocalDateTime(normalized)
  if (pragueDateTime) {
    return { value: pragueDateTime, error: null }
  }
  if (isPragueLocalDateTime) {
    return { value: null, error: `${label} nemá platný formát.` }
  }

  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    return { value: null, error: `${label} nemá platný formát.` }
  }

  return { value: date.toISOString(), error: null }
}

function parseOptionalPercent(value: unknown, label: string) {
  const normalized = normalizeText(value).replace(',', '.')
  if (!normalized) return { value: null, error: null }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return { value: null, error: `${label} musí být číslo od 0 do 100.` }
  }

  return { value: Math.round(parsed * 100) / 100, error: null }
}

export function normalizeOperationalProtocolJobNumber(value: unknown) {
  const normalized = normalizeText(value)
  return normalized ? normalized.toUpperCase() : null
}

export function validateOperationalProtocolDraft(
  input: OperationalProtocolDraftInput
):
  | { success: true; data: NormalizedOperationalProtocolDraft; error: null }
  | { success: false; data: null; error: string } {
  const jobTitle = normalizeText(input.jobTitle)
  const handoverPlace = normalizeText(input.handoverPlace)
  const clientName = normalizeText(input.clientName)
  const technicianName = normalizeText(input.technicianName)

  if (!jobTitle) return { success: false, data: null, error: 'Vyplň název zakázky.' }
  if (!handoverPlace) return { success: false, data: null, error: 'Vyplň místo realizace.' }
  if (!clientName) return { success: false, data: null, error: 'Vyplň přejímající firmu.' }
  if (!technicianName) {
    return { success: false, data: null, error: 'Vyplň technika B-ENERGY.' }
  }

  const realizationStart = parseDateTime(input.realizationStartAt, 'Začátek realizace')
  if (realizationStart.error || !realizationStart.value) {
    return { success: false, data: null, error: realizationStart.error ?? 'Neplatný začátek.' }
  }

  const realizationEnd = parseDateTime(input.realizationEndAt, 'Konec realizace')
  if (realizationEnd.error || !realizationEnd.value) {
    return { success: false, data: null, error: realizationEnd.error ?? 'Neplatný konec.' }
  }

  if (new Date(realizationEnd.value) < new Date(realizationStart.value)) {
    return {
      success: false,
      data: null,
      error: 'Konec realizace nesmí být dříve než začátek.',
    }
  }

  const realization = parseDateTime(input.realizationAt, 'Začátek skutečné realizace')
  if (realization.error || !realization.value) {
    return { success: false, data: null, error: realization.error ?? 'Neplatný začátek realizace.' }
  }

  const realizationCompleted = parseDateTime(
    input.realizationCompletedAt,
    'Konec skutečné realizace'
  )
  if (realizationCompleted.error || !realizationCompleted.value) {
    return {
      success: false,
      data: null,
      error: realizationCompleted.error ?? 'Neplatný konec realizace.',
    }
  }

  if (new Date(realizationCompleted.value) < new Date(realization.value)) {
    return {
      success: false,
      data: null,
      error: 'Konec skutečné realizace nesmí být dříve než začátek.',
    }
  }

  const sourceClientId = optionalText(input.sourceClientId)
  if (sourceClientId && !UUID_PATTERN.test(sourceClientId)) {
    return { success: false, data: null, error: 'Vybraný klient není platný.' }
  }

  const subtenantChoice = input.subtenantChoice ?? null
  if (subtenantChoice !== null && subtenantChoice !== 'yes' && subtenantChoice !== 'no') {
    return { success: false, data: null, error: 'Neplatná volba podnájemce.' }
  }

  const subtenantName = optionalText(input.subtenantName)
  const subtenantNote = optionalText(input.subtenantNote)
  if ((subtenantName || subtenantNote) && !subtenantChoice) {
    return {
      success: false,
      data: null,
      error: 'U podnájemce zvol ANO nebo NE.',
    }
  }

  const devices: NormalizedOperationalProtocolDraft['devices'] = []
  for (let index = 0; index < input.devices.length; index += 1) {
    const device = input.devices[index]
    const deviceName = normalizeText(device.deviceName)
    const hasAnyValue = Boolean(
      deviceName ||
        normalizeText(device.mthStart) ||
        normalizeText(device.mthEnd) ||
        normalizeText(device.fuelStartPercent) ||
        normalizeText(device.fuelEndPercent)
    )

    if (!hasAnyValue) continue
    if (!deviceName) {
      return {
        success: false,
        data: null,
        error: `U zařízení ${index + 1} vyplň název nebo kód.`,
      }
    }

    const fuelStart = parseOptionalPercent(
      device.fuelStartPercent,
      `Palivo při předání u zařízení ${index + 1}`
    )
    if (fuelStart.error) return { success: false, data: null, error: fuelStart.error }

    const fuelEnd = parseOptionalPercent(
      device.fuelEndPercent,
      `Palivo při vrácení u zařízení ${index + 1}`
    )
    if (fuelEnd.error) return { success: false, data: null, error: fuelEnd.error }

    devices.push({
      deviceName,
      mthStart: optionalText(device.mthStart),
      mthEnd: optionalText(device.mthEnd),
      fuelStartPercent: fuelStart.value,
      fuelEndPercent: fuelEnd.value,
    })
  }

  const accessories = input.accessories
    .map((item) => ({ itemName: normalizeText(item.itemName) }))
    .filter((item) => item.itemName)

  if (devices.length === 0 && accessories.length === 0) {
    return {
      success: false,
      data: null,
      error: 'Přidej alespoň jedno zařízení nebo příslušenství.',
    }
  }

  return {
    success: true,
    error: null,
    data: {
      jobNumber: normalizeOperationalProtocolJobNumber(input.jobNumber),
      jobTitle,
      realizationStartAt: realizationStart.value,
      realizationEndAt: realizationEnd.value,
      handoverPlace,
      sourceClientId,
      clientName,
      clientAddress: optionalText(input.clientAddress),
      clientIco: optionalText(input.clientIco),
      clientContactPerson: optionalText(input.clientContactPerson),
      clientContactPhone: optionalText(input.clientContactPhone),
      subtenantChoice,
      subtenantName,
      subtenantNote,
      realizationAt: realization.value,
      realizationCompletedAt: realizationCompleted.value,
      technicianName,
      devices,
      accessories,
    },
  }
}
