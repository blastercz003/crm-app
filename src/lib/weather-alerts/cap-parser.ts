import { createHash } from 'node:crypto'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type {
  NormalizedWeatherSegment,
  ParsedChmiCapMessage,
  WeatherArea,
  WeatherHazardType,
} from './types'

type XmlNode = Record<string, unknown>

const RELEVANT_AWARENESS_TYPES = new Map<string, WeatherHazardType>([
  ['1', 'wind'],
  ['3', 'thunderstorm'],
  ['10', 'rain'],
  ['12', 'flood'],
  ['13', 'flood'],
])

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
})

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function asNode(value: unknown): XmlNode {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as XmlNode)
    : {}
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return null
}

function requiredText(value: unknown, fieldName: string): string {
  const normalized = text(value)
  if (!normalized) {
    throw new Error(`ČHMÚ CAP neobsahuje povinné pole ${fieldName}.`)
  }
  return normalized
}

function isoTimestamp(value: unknown, fieldName: string): string | null {
  const normalized = text(value)
  if (!normalized) return null

  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`ČHMÚ CAP obsahuje neplatný čas v poli ${fieldName}.`)
  }

  return parsed.toISOString()
}

function optionalNumber(value: unknown): number | null {
  const normalized = text(value)
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, stableValue(nestedValue)]),
  )
}

function stableStringify(value: unknown) {
  return JSON.stringify(stableValue(value))
}

function normalizeParameters(value: unknown) {
  const grouped = new Map<string, string[]>()

  for (const rawParameter of asArray(value)) {
    const parameter = asNode(rawParameter)
    const name = text(parameter.valueName)
    const parameterValue = text(parameter.value)
    if (!name || parameterValue == null) continue

    const values = grouped.get(name) ?? []
    values.push(parameterValue)
    grouped.set(name, values)
  }

  return Object.fromEntries(
    [...grouped.entries()].map(([name, values]) => [
      name,
      values.length === 1 ? values[0] : values,
    ]),
  ) as Record<string, string | string[]>
}

function firstParameter(
  parameters: Record<string, string | string[]>,
  name: string,
) {
  const value = parameters[name]
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function normalizeEventCodes(value: unknown) {
  return asArray(value)
    .map((rawCode) => {
      const code = asNode(rawCode)
      const system = text(code.valueName)
      const codeValue = text(code.value)
      return system && codeValue ? `${system}:${codeValue}` : codeValue
    })
    .filter((code): code is string => Boolean(code))
}

function normalizeAreas(value: unknown): WeatherArea[] {
  return asArray(value)
    .map((rawArea) => {
      const area = asNode(rawArea)
      const name = text(area.areaDesc)
      if (!name) return null

      const codes = asArray(area.geocode)
        .map((rawCode) => {
          const code = asNode(rawCode)
          const type = text(code.valueName)
          const codeValue = text(code.value)
          return type && codeValue ? { type, value: codeValue } : null
        })
        .filter((code): code is { type: string; value: string } => Boolean(code))
        .sort((left, right) =>
          `${left.type}:${left.value}`.localeCompare(`${right.type}:${right.value}`),
        )

      return {
        name,
        altitude: optionalNumber(area.altitude),
        ceiling: optionalNumber(area.ceiling),
        codes,
      }
    })
    .filter((area): area is WeatherArea => Boolean(area))
    .sort((left, right) => left.name.localeCompare(right.name, 'cs'))
}

function inferHazardType(
  awarenessType: string | null,
  eventName: string,
): WeatherHazardType | null {
  const awarenessTypeId = awarenessType?.split(';', 1)[0]?.trim()
  if (awarenessTypeId && RELEVANT_AWARENESS_TYPES.has(awarenessTypeId)) {
    return RELEVANT_AWARENESS_TYPES.get(awarenessTypeId) ?? null
  }

  const normalizedName = eventName.toLocaleLowerCase('cs-CZ')
  if (awarenessTypeId === '2') {
    return /n[aá]mraz|ledovk|n[aá]led/.test(normalizedName)
      ? 'ice_load'
      : 'snow'
  }
  if (/v[ií]tr|vichr|ork[aá]n/.test(normalizedName)) return 'wind'
  if (/n[aá]mraz|ledovk|n[aá]led/.test(normalizedName)) return 'ice_load'
  if (/sn[ií]h|sn[eě]h/.test(normalizedName)) return 'snow'
  if (/bou[rř]k/.test(normalizedName)) return 'thunderstorm'
  if (/povod|z[aá]plav/.test(normalizedName)) return 'flood'
  if (/d[eé][sš][tť]|sr[aá][zž]/.test(normalizedName)) return 'rain'
  return null
}

function primaryEventCode(eventCodes: string[]) {
  return (
    eventCodes.find((eventCode) => eventCode.startsWith('SIVS:')) ??
    eventCodes.find((eventCode) => eventCode.startsWith('HPPS:')) ??
    eventCodes[0] ??
    null
  )
}

function normalizeSegment(
  rawInfo: unknown,
  segmentIndex: number,
  now: Date,
  message: { status: string; messageType: string; scope: string },
): NormalizedWeatherSegment {
  const info = asNode(rawInfo)
  const eventName = requiredText(info.event, `info[${segmentIndex}].event`)
  const parameters = normalizeParameters(info.parameter)
  const awarenessLevel = firstParameter(parameters, 'awareness_level')
  const awarenessType = firstParameter(parameters, 'awareness_type')
  const hazardType = inferHazardType(awarenessType, eventName)
  const eventCodes = normalizeEventCodes(info.eventCode)
  const severity = text(info.severity)
  const certainty = text(info.certainty)
  const expiresAt = isoTimestamp(info.expires, `info[${segmentIndex}].expires`)
  const eventEndingAt = isoTimestamp(
    firstParameter(parameters, 'eventEndingTime'),
    `info[${segmentIndex}].parameter.eventEndingTime`,
  )
  const areas = normalizeAreas(info.area)
  const isRelevantHazard = hazardType !== null
  const isActiveWarning =
    isRelevantHazard &&
    message.status === 'Actual' &&
    message.scope === 'Public' &&
    message.messageType !== 'Cancel' &&
    ['Moderate', 'Severe', 'Extreme'].includes(severity ?? '') &&
    certainty !== 'Unlikely' &&
    (!expiresAt || new Date(expiresAt).getTime() > now.getTime())

  const normalizedWithoutHash = {
    segmentIndex,
    language: text(info.language) ?? 'cs',
    eventName,
    primaryEventCode: primaryEventCode(eventCodes),
    eventCodes,
    hazardType,
    urgency: text(info.urgency),
    severity,
    certainty,
    effectiveAt: isoTimestamp(info.effective, `info[${segmentIndex}].effective`),
    onsetAt: isoTimestamp(info.onset, `info[${segmentIndex}].onset`),
    expiresAt,
    eventEndingAt,
    headline: text(info.headline),
    description: text(info.description),
    instruction: text(info.instruction),
    situation: firstParameter(parameters, 'situation'),
    criterion: firstParameter(parameters, 'criterion'),
    sourceWebUrl: text(info.web),
    awarenessLevel,
    awarenessType,
    parameters,
    areas,
    isRelevantHazard,
    isActiveWarning,
  }

  return {
    ...normalizedWithoutHash,
    segmentSha256: sha256(stableStringify(normalizedWithoutHash)),
  }
}

export function hashChmiPayload(xml: string) {
  return sha256(xml)
}

export function parseChmiCapMessage(
  xml: string,
  options: { now?: Date } = {},
): ParsedChmiCapMessage {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error('ČHMÚ CAP obsahuje nepovolenou deklaraci DTD nebo entity.')
  }

  const validation = XMLValidator.validate(xml)
  if (validation !== true) {
    throw new Error(`ČHMÚ CAP XML není platné: ${validation.err.msg}`)
  }

  const document = asNode(parser.parse(xml))
  const alert = asNode(document.alert)
  if (Object.keys(alert).length === 0) {
    throw new Error('ČHMÚ CAP XML neobsahuje kořenový element alert.')
  }

  const identifier = requiredText(alert.identifier, 'alert.identifier')
  if (!identifier.includes('.XOCZ50_')) {
    throw new Error('Stažený bulletin není podporovaný bulletin XOCZ50.')
  }

  const sender = requiredText(alert.sender, 'alert.sender')
  const sentAt = requiredText(alert.sent, 'alert.sent')
  const status = requiredText(alert.status, 'alert.status')
  const messageType = requiredText(alert.msgType, 'alert.msgType')
  const scope = requiredText(alert.scope, 'alert.scope')

  if (sender.toLocaleLowerCase('en-US') !== 'chmi@chmi.cz') {
    throw new Error(`Neočekávaný odesílatel ČHMÚ CAP: ${sender}`)
  }
  if (status !== 'Actual' || scope !== 'Public') {
    throw new Error(`Bulletin není veřejná ostrá výstraha (${status}/${scope}).`)
  }
  if (!['Alert', 'Update', 'Cancel'].includes(messageType)) {
    throw new Error(`Nepodporovaný typ ČHMÚ CAP zprávy: ${messageType}`)
  }

  const parsedSentAt = isoTimestamp(sentAt, 'alert.sent')
  if (!parsedSentAt) throw new Error('ČHMÚ CAP neobsahuje platný čas odeslání.')

  const rawInfos = asArray(alert.info)
  if (rawInfos.length === 0) {
    throw new Error('ČHMÚ CAP bulletin neobsahuje žádné bloky info.')
  }

  const czechInfos = rawInfos
    .map((rawInfo, originalIndex) => ({
      rawInfo,
      originalIndex,
      language: text(asNode(rawInfo).language)?.toLocaleLowerCase('en-US') ?? '',
    }))
    .filter(({ language }) => language === 'cs' || language.startsWith('cs-'))

  const selectedInfos = czechInfos.length > 0
    ? czechInfos
    : rawInfos.map((rawInfo, originalIndex) => ({ rawInfo, originalIndex }))

  const now = options.now ?? new Date()
  const messageMetadata = { status, messageType, scope }
  const segments = selectedInfos.map(({ rawInfo, originalIndex }) =>
    normalizeSegment(rawInfo, originalIndex, now, messageMetadata),
  )

  return {
    identifier,
    sender,
    sentAt: parsedSentAt,
    status,
    messageType,
    scope,
    referencesText: text(alert.references),
    sourceCodes: asArray(alert.code)
      .map(text)
      .filter((code): code is string => Boolean(code)),
    segments,
  }
}
