import { createHash, randomUUID } from 'node:crypto'
import { getServiceRoleClient } from '@/lib/supabase/service'
import {
  CHMI_SOURCE,
  type WeatherArea,
  type WeatherHazardType,
  type WeatherReconciliationResult,
} from './types'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>
type EventStatus = 'upcoming' | 'active' | 'ended' | 'cancelled'

type SourceMessage = {
  id: string
  message_type: string
  sent_at: string
}

type SourceSegmentRow = {
  id: string
  source_message_id: string
  primary_event_code: string | null
  event_name: string
  hazard_type: WeatherHazardType | null
  urgency: string | null
  severity: string | null
  certainty: string | null
  effective_at: string | null
  onset_at: string | null
  expires_at: string | null
  event_ending_at: string | null
  headline: string | null
  description: string | null
  instruction: string | null
  situation: string | null
  criterion: string | null
  source_web_url: string | null
  parameters: Record<string, unknown> | null
  areas: WeatherArea[] | null
}

type EventRow = {
  id: string
  series_key: string
  event_code: string
  event_name: string
  hazard_type: WeatherHazardType
  severity: string
  severity_level: number
  severity_color: string
  urgency: string | null
  certainty: string
  headline: string
  description: string
  instruction: string
  situation: string | null
  criterion: string | null
  source_web_url: string | null
  effective_at: string | null
  onset_at: string | null
  expires_at: string | null
  event_ending_at: string | null
  valid_to: string | null
  status: EventStatus
  current_version_number: number
  segment_fingerprint: string
  content_sha256: string
  area_sha256: string
  parameters: Record<string, unknown>
}

type VersionRow = {
  id: string
  event_id: string
  version_number: number
  source_segment_id: string | null
}

type AreaRow = {
  event_id: string
  version_id: string
  code_type: string
  code_value: string
  area_name: string
  altitude: number | null
  ceiling: number | null
}

type Candidate = {
  sourceSegmentId: string
  sourceMessageId: string
  eventCode: string
  eventName: string
  hazardType: WeatherHazardType
  severity: string
  severityLevel: number
  severityColor: string
  urgency: string | null
  certainty: string
  headline: string
  description: string
  instruction: string
  situation: string | null
  criterion: string | null
  sourceWebUrl: string | null
  effectiveAt: string | null
  onsetAt: string | null
  expiresAt: string | null
  eventEndingAt: string | null
  validTo: string | null
  status: Extract<EventStatus, 'upcoming' | 'active'>
  parameters: Record<string, unknown>
  areas: WeatherArea[]
  areaRows: Omit<AreaRow, 'event_id' | 'version_id'>[]
  areaIdentity: Set<string>
  areaSha256: string
  contentSha256: string
  segmentFingerprint: string
}

type CurrentEvent = EventRow & {
  currentVersionId: string | null
  currentSourceSegmentId: string | null
  areaRows: AreaRow[]
  areaIdentity: Set<string>
}

const SEVERITY: Record<
  string,
  { level: number; color: 'yellow' | 'orange' | 'red' }
> = {
  Moderate: { level: 1, color: 'yellow' },
  Severe: { level: 2, color: 'orange' },
  Extreme: { level: 3, color: 'red' },
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
      .map(([key, nested]) => [key, stableValue(nested)]),
  )
}

function stableHash(value: unknown) {
  return sha256(JSON.stringify(stableValue(value)))
}

function timestamp(value: string | null) {
  if (!value) return null
  const milliseconds = new Date(value).getTime()
  return Number.isNaN(milliseconds) ? null : milliseconds
}

function normalizeAreas(value: WeatherArea[] | null): WeatherArea[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((area) => area && typeof area.name === 'string')
    .map((area) => ({
      name: area.name,
      altitude: typeof area.altitude === 'number' ? area.altitude : null,
      ceiling: typeof area.ceiling === 'number' ? area.ceiling : null,
      codes: Array.isArray(area.codes)
        ? area.codes
            .filter(
              (code) =>
                code &&
                typeof code.type === 'string' &&
                typeof code.value === 'string',
            )
            .map((code) => ({ type: code.type, value: code.value }))
        : [],
    }))
}

function flattenAreaRows(areas: WeatherArea[]) {
  const rows = new Map<string, Omit<AreaRow, 'event_id' | 'version_id'>>()
  for (const area of areas) {
    for (const code of area.codes) {
      const key = `${code.type}:${code.value}`
      if (rows.has(key)) continue
      rows.set(key, {
        code_type: code.type,
        code_value: code.value,
        area_name: area.name,
        altitude: area.altitude,
        ceiling: area.ceiling,
      })
    }
  }
  return [...rows.values()].sort((left, right) =>
    `${left.code_type}:${left.code_value}`.localeCompare(
      `${right.code_type}:${right.code_value}`,
    ),
  )
}

function areaIdentityFromRows(
  rows: Array<Pick<AreaRow, 'code_type' | 'code_value' | 'area_name'>>,
) {
  const cisorps = rows
    .filter((row) => row.code_type === 'CISORP')
    .map((row) => `CISORP:${row.code_value}`)
  if (cisorps.length > 0) return new Set(cisorps)

  const emma = rows
    .filter((row) => row.code_type === 'EMMA_ID')
    .map((row) => `EMMA_ID:${row.code_value}`)
  if (emma.length > 0) return new Set(emma)

  return new Set(rows.map((row) => `AREA:${row.area_name}`))
}

function candidateFromSegment(segment: SourceSegmentRow, now: Date): Candidate | null {
  if (!segment.hazard_type || !segment.severity) return null
  const severity = SEVERITY[segment.severity]
  if (!severity || segment.certainty === 'Unlikely') return null

  const validTo = segment.event_ending_at ?? segment.expires_at
  const validToMs = timestamp(validTo)
  if (validToMs != null && validToMs <= now.getTime()) return null

  const onsetMs = timestamp(segment.onset_at)
  const areas = normalizeAreas(segment.areas)
  const areaRows = flattenAreaRows(areas)
  const areaIdentity = areaIdentityFromRows(areaRows)
  const parameters = segment.parameters ?? {}
  const eventCode = segment.primary_event_code ?? `CHMI:${segment.hazard_type}`
  const headline = segment.headline?.trim() || segment.event_name
  const contentSha256 = stableHash({
    eventCode,
    eventName: segment.event_name,
    hazardType: segment.hazard_type,
    urgency: segment.urgency,
    certainty: segment.certainty ?? 'Unknown',
    headline,
    description: segment.description ?? '',
    instruction: segment.instruction ?? '',
    situation: segment.situation,
    criterion: segment.criterion,
    sourceWebUrl: segment.source_web_url,
    parameters,
  })
  const areaSha256 = stableHash(areaRows)
  const timingAndSeverity = {
    severity: segment.severity,
    severityLevel: severity.level,
    effectiveAt: segment.effective_at,
    onsetAt: segment.onset_at,
    expiresAt: segment.expires_at,
    eventEndingAt: segment.event_ending_at,
    validTo,
  }

  return {
    sourceSegmentId: segment.id,
    sourceMessageId: segment.source_message_id,
    eventCode,
    eventName: segment.event_name,
    hazardType: segment.hazard_type,
    severity: segment.severity,
    severityLevel: severity.level,
    severityColor: severity.color,
    urgency: segment.urgency,
    certainty: segment.certainty ?? 'Unknown',
    headline,
    description: segment.description ?? '',
    instruction: segment.instruction ?? '',
    situation: segment.situation,
    criterion: segment.criterion,
    sourceWebUrl: segment.source_web_url,
    effectiveAt: segment.effective_at,
    onsetAt: segment.onset_at,
    expiresAt: segment.expires_at,
    eventEndingAt: segment.event_ending_at,
    validTo,
    status: onsetMs != null && onsetMs > now.getTime() ? 'upcoming' : 'active',
    parameters,
    areas,
    areaRows,
    areaIdentity,
    areaSha256,
    contentSha256,
    segmentFingerprint: stableHash({ contentSha256, areaSha256, timingAndSeverity }),
  }
}

function intersectionSize(left: Set<string>, right: Set<string>) {
  let count = 0
  for (const value of left) if (right.has(value)) count += 1
  return count
}

function intervalsAreRelated(candidate: Candidate, event: CurrentEvent) {
  const candidateStart = timestamp(candidate.onsetAt ?? candidate.effectiveAt)
  const candidateEnd = timestamp(candidate.validTo)
  const eventStart = timestamp(event.onset_at ?? event.effective_at)
  const eventEnd = timestamp(event.valid_to)
  if (candidateStart == null || eventStart == null) return true

  const tolerance = 6 * 60 * 60 * 1_000
  const leftEnd = candidateEnd ?? candidateStart
  const rightEnd = eventEnd ?? eventStart
  return candidateStart <= rightEnd + tolerance && eventStart <= leftEnd + tolerance
}

function matchScore(candidate: Candidate, event: CurrentEvent) {
  if (candidate.hazardType !== event.hazard_type) return null
  if (!intervalsAreRelated(candidate, event)) return null

  const intersection = intersectionSize(candidate.areaIdentity, event.areaIdentity)
  if (intersection === 0) return null

  const smallerAreaSize = Math.max(
    1,
    Math.min(candidate.areaIdentity.size, event.areaIdentity.size),
  )
  const overlap = intersection / smallerAreaSize
  if (overlap < 0.15) return null

  const candidateOnset = timestamp(candidate.onsetAt)
  const eventOnset = timestamp(event.onset_at)
  const onsetDifferenceHours =
    candidateOnset != null && eventOnset != null
      ? Math.abs(candidateOnset - eventOnset) / 3_600_000
      : 0

  return (
    overlap * 100 +
    (candidate.eventCode === event.event_code ? 50 : 0) +
    Math.max(0, 24 - onsetDifferenceHours) +
    (candidate.severityLevel === event.severity_level ? 5 : 0)
  )
}

function assignCandidates(candidates: Candidate[], events: CurrentEvent[]) {
  const possibleMatches: Array<{
    candidateIndex: number
    eventIndex: number
    score: number
  }> = []

  candidates.forEach((candidate, candidateIndex) => {
    events.forEach((event, eventIndex) => {
      const score = matchScore(candidate, event)
      if (score != null) possibleMatches.push({ candidateIndex, eventIndex, score })
    })
  })

  possibleMatches.sort((left, right) => right.score - left.score)
  const assignedCandidates = new Set<number>()
  const assignedEvents = new Set<number>()
  const matches = new Map<number, number>()

  for (const match of possibleMatches) {
    if (
      assignedCandidates.has(match.candidateIndex) ||
      assignedEvents.has(match.eventIndex)
    ) {
      continue
    }
    assignedCandidates.add(match.candidateIndex)
    assignedEvents.add(match.eventIndex)
    matches.set(match.candidateIndex, match.eventIndex)
  }

  return { matches, assignedEvents }
}

function significantAreaExpansion(previous: Set<string>, current: Set<string>) {
  if (current.size <= previous.size) return false
  let added = 0
  for (const code of current) if (!previous.has(code)) added += 1
  if (added === 0) return false
  if (previous.size === 0) return true
  return added >= 3 || added / previous.size >= 0.2
}

function changeReasons(candidate: Candidate, event: CurrentEvent) {
  const reasons: string[] = []
  if (candidate.severityLevel > event.severity_level) reasons.push('severity_increased')
  else if (candidate.severityLevel < event.severity_level) {
    reasons.push('severity_decreased')
  }

  if (candidate.areaSha256 !== event.area_sha256) {
    reasons.push(
      significantAreaExpansion(event.areaIdentity, candidate.areaIdentity)
        ? 'area_expanded'
        : 'area_changed',
    )
  }

  if (candidate.onsetAt !== event.onset_at) {
    const oldOnset = timestamp(event.onset_at)
    const newOnset = timestamp(candidate.onsetAt)
    reasons.push(
      oldOnset != null &&
        newOnset != null &&
        oldOnset - newOnset >= 30 * 60 * 1_000
        ? 'onset_advanced'
        : 'onset_changed',
    )
  }
  if (
    candidate.expiresAt !== event.expires_at ||
    candidate.eventEndingAt !== event.event_ending_at ||
    candidate.validTo !== event.valid_to
  ) {
    reasons.push('validity_changed')
  }
  if (candidate.contentSha256 !== event.content_sha256) {
    reasons.push('content_changed')
  }
  if (candidate.status !== event.status) reasons.push('status_changed')
  return reasons
}

function isNotifiableChange(reasons: string[]) {
  return reasons.some((reason) =>
    ['new_event', 'severity_increased', 'area_expanded', 'onset_advanced'].includes(
      reason,
    ),
  )
}

function eventFields(candidate: Candidate) {
  return {
    event_code: candidate.eventCode,
    event_name: candidate.eventName,
    hazard_type: candidate.hazardType,
    severity: candidate.severity,
    severity_level: candidate.severityLevel,
    severity_color: candidate.severityColor,
    urgency: candidate.urgency,
    certainty: candidate.certainty,
    headline: candidate.headline,
    description: candidate.description,
    instruction: candidate.instruction,
    situation: candidate.situation,
    criterion: candidate.criterion,
    source_web_url: candidate.sourceWebUrl,
    effective_at: candidate.effectiveAt,
    onset_at: candidate.onsetAt,
    expires_at: candidate.expiresAt,
    event_ending_at: candidate.eventEndingAt,
    valid_to: candidate.validTo,
    status: candidate.status,
    segment_fingerprint: candidate.segmentFingerprint,
    content_sha256: candidate.contentSha256,
    area_sha256: candidate.areaSha256,
    parameters: candidate.parameters,
  }
}

function versionFieldsFromCandidate(candidate: Candidate) {
  return eventFields(candidate)
}

function versionFieldsFromEvent(event: CurrentEvent, status: EventStatus) {
  return {
    event_code: event.event_code,
    event_name: event.event_name,
    hazard_type: event.hazard_type,
    severity: event.severity,
    severity_level: event.severity_level,
    severity_color: event.severity_color,
    urgency: event.urgency,
    certainty: event.certainty,
    headline: event.headline,
    description: event.description,
    instruction: event.instruction,
    situation: event.situation,
    criterion: event.criterion,
    source_web_url: event.source_web_url,
    effective_at: event.effective_at,
    onset_at: event.onset_at,
    expires_at: event.expires_at,
    event_ending_at: event.event_ending_at,
    valid_to: event.valid_to,
    status,
    segment_fingerprint: event.segment_fingerprint,
    content_sha256: event.content_sha256,
    area_sha256: event.area_sha256,
    parameters: event.parameters,
  }
}

async function insertVersion(
  client: ServiceClient,
  input: {
    eventId: string
    sourceMessageId: string
    sourceSegmentId: string | null
    versionNumber: number
    changeReasons: string[]
    notifiable: boolean
    fields:
      | ReturnType<typeof versionFieldsFromCandidate>
      | ReturnType<typeof versionFieldsFromEvent>
    areaRows: Omit<AreaRow, 'event_id' | 'version_id'>[]
  },
) {
  const { data: version, error: versionError } = await client
    .from('weather_event_versions')
    .insert({
      event_id: input.eventId,
      source_message_id: input.sourceMessageId,
      source_segment_id: input.sourceSegmentId,
      version_number: input.versionNumber,
      change_reasons: input.changeReasons,
      is_notifiable_change: input.notifiable,
      ...input.fields,
    })
    .select('id')
    .single<{ id: string }>()
  if (versionError) throw versionError

  try {
    if (input.areaRows.length > 0) {
      const { error: areaError } = await client.from('weather_event_areas').insert(
        input.areaRows.map((area) => ({
          ...area,
          event_id: input.eventId,
          version_id: version.id,
        })),
      )
      if (areaError) throw areaError
    }
    return version.id
  } catch (error) {
    await client.from('weather_event_versions').delete().eq('id', version.id)
    throw error
  }
}

async function createEvent(
  client: ServiceClient,
  candidate: Candidate,
  nowIso: string,
) {
  const eventId = randomUUID()
  const seriesKey = `chmi:${sha256(
    `${candidate.eventCode}|${candidate.sourceSegmentId}`,
  ).slice(0, 40)}`
  const { error: eventError } = await client.from('weather_events').insert({
    id: eventId,
    source: CHMI_SOURCE,
    series_key: seriesKey,
    ...eventFields(candidate),
    first_source_message_id: candidate.sourceMessageId,
    last_source_message_id: candidate.sourceMessageId,
    current_version_number: 1,
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    last_changed_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  })
  if (eventError?.code === '23505') return false
  if (eventError) throw eventError

  try {
    await insertVersion(client, {
      eventId,
      sourceMessageId: candidate.sourceMessageId,
      sourceSegmentId: candidate.sourceSegmentId,
      versionNumber: 1,
      changeReasons: ['new_event'],
      notifiable: true,
      fields: versionFieldsFromCandidate(candidate),
      areaRows: candidate.areaRows,
    })
  } catch (error) {
    await client.from('weather_events').delete().eq('id', eventId)
    throw error
  }
  return true
}

async function updateEvent(
  client: ServiceClient,
  event: CurrentEvent,
  candidate: Candidate,
  reasons: string[],
  nowIso: string,
) {
  if (reasons.length === 0) {
    const { error } = await client
      .from('weather_events')
      .update({
        last_source_message_id: candidate.sourceMessageId,
        last_seen_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', event.id)
    if (error) throw error
    return false
  }

  const nextVersion = event.current_version_number + 1
  const versionId = await insertVersion(client, {
    eventId: event.id,
    sourceMessageId: candidate.sourceMessageId,
    sourceSegmentId:
      candidate.sourceSegmentId === event.currentSourceSegmentId
        ? null
        : candidate.sourceSegmentId,
    versionNumber: nextVersion,
    changeReasons: reasons,
    notifiable: isNotifiableChange(reasons),
    fields: versionFieldsFromCandidate(candidate),
    areaRows: candidate.areaRows,
  })

  const { data: updatedEvent, error } = await client
    .from('weather_events')
    .update({
      ...eventFields(candidate),
      last_source_message_id: candidate.sourceMessageId,
      current_version_number: nextVersion,
      last_seen_at: nowIso,
      last_changed_at: nowIso,
      ended_at: null,
      close_reason: null,
      updated_at: nowIso,
    })
    .eq('id', event.id)
    .eq('current_version_number', event.current_version_number)
    .select('id')
    .maybeSingle<{ id: string }>()
  if (error || !updatedEvent) {
    await client.from('weather_event_versions').delete().eq('id', versionId)
    throw error ?? new Error('Výstrahu mezitím změnil jiný synchronizační běh.')
  }
  return true
}

async function endEvent(
  client: ServiceClient,
  event: CurrentEvent,
  sourceMessage: SourceMessage,
  now: Date,
) {
  const nextVersion = event.current_version_number + 1
  const validTo = timestamp(event.valid_to)
  const cancelled = sourceMessage.message_type === 'Cancel'
  const status: Extract<EventStatus, 'ended' | 'cancelled'> = cancelled
    ? 'cancelled'
    : 'ended'
  const closeReason = cancelled
    ? 'source_cancelled'
    : validTo != null && validTo <= now.getTime()
      ? 'expired'
      : 'missing_from_latest_snapshot'
  const areaRows = event.areaRows.map((area) => ({
    code_type: area.code_type,
    code_value: area.code_value,
    area_name: area.area_name,
    altitude: area.altitude,
    ceiling: area.ceiling,
  }))
  const versionId = await insertVersion(client, {
    eventId: event.id,
    sourceMessageId: sourceMessage.id,
    sourceSegmentId: null,
    versionNumber: nextVersion,
    changeReasons: ['status_changed'],
    notifiable: false,
    fields: versionFieldsFromEvent(event, status),
    areaRows,
  })

  const nowIso = now.toISOString()
  const { data: endedEvent, error } = await client
    .from('weather_events')
    .update({
      status,
      ended_at: nowIso,
      close_reason: closeReason,
      current_version_number: nextVersion,
      last_source_message_id: sourceMessage.id,
      last_changed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', event.id)
    .eq('current_version_number', event.current_version_number)
    .select('id')
    .maybeSingle<{ id: string }>()
  if (error || !endedEvent) {
    await client.from('weather_event_versions').delete().eq('id', versionId)
    throw error ?? new Error('Výstrahu mezitím změnil jiný synchronizační běh.')
  }
}

async function loadCurrentEvents(client: ServiceClient): Promise<CurrentEvent[]> {
  const { data: events, error: eventsError } = await client
    .from('weather_events')
    .select('*')
    .eq('source', CHMI_SOURCE)
    .in('status', ['upcoming', 'active'])
  if (eventsError) throw eventsError
  if (!events || events.length === 0) return []

  const typedEvents = events as EventRow[]
  const eventIds = typedEvents.map((event) => event.id)
  const { data: versions, error: versionsError } = await client
    .from('weather_event_versions')
    .select('id,event_id,version_number,source_segment_id')
    .in('event_id', eventIds)
    .order('version_number', { ascending: false })
  if (versionsError) throw versionsError

  const currentVersionByEvent = new Map<string, VersionRow>()
  for (const version of (versions ?? []) as VersionRow[]) {
    if (!currentVersionByEvent.has(version.event_id)) {
      currentVersionByEvent.set(version.event_id, version)
    }
  }
  const versionIds = [...currentVersionByEvent.values()].map((version) => version.id)
  let areas: AreaRow[] = []
  if (versionIds.length > 0) {
    const { data, error } = await client
      .from('weather_event_areas')
      .select('event_id,version_id,code_type,code_value,area_name,altitude,ceiling')
      .in('version_id', versionIds)
    if (error) throw error
    areas = (data ?? []) as AreaRow[]
  }

  return typedEvents.map((event) => {
    const currentVersionId = currentVersionByEvent.get(event.id)?.id ?? null
    const areaRows = areas.filter((area) => area.version_id === currentVersionId)
    return {
      ...event,
      currentVersionId,
      currentSourceSegmentId:
        currentVersionByEvent.get(event.id)?.source_segment_id ?? null,
      areaRows,
      areaIdentity: areaIdentityFromRows(areaRows),
    }
  })
}

async function incrementDataVersion(client: ServiceClient) {
  const { data, error } = await client
    .from('weather_source_state')
    .select('data_version')
    .eq('source', CHMI_SOURCE)
    .single<{ data_version: number }>()
  if (error) throw error

  const { data: updatedState, error: updateError } = await client
    .from('weather_source_state')
    .update({
      data_version: Number(data.data_version) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('source', CHMI_SOURCE)
    .eq('data_version', data.data_version)
    .select('data_version')
    .maybeSingle<{ data_version: number }>()
  if (updateError) throw updateError
  if (!updatedState) {
    throw new Error('Verzi dat mezitím změnil jiný synchronizační běh.')
  }
}

export async function reconcileWeatherEvents(input: {
  sourceMessageId: string
  syncRunId: string
  importStatus: 'success' | 'unchanged'
  now?: Date
}): Promise<WeatherReconciliationResult> {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro zpracování výstrah.')

  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  const { data: sourceMessage, error: sourceMessageError } = await client
    .from('weather_source_messages')
    .select('id,message_type,sent_at')
    .eq('id', input.sourceMessageId)
    .single<SourceMessage>()
  if (sourceMessageError) throw sourceMessageError

  const { data: sourceSegments, error: segmentsError } = await client
    .from('weather_source_segments')
    .select(
      'id,source_message_id,primary_event_code,event_name,hazard_type,urgency,severity,certainty,effective_at,onset_at,expires_at,event_ending_at,headline,description,instruction,situation,criterion,source_web_url,parameters,areas',
    )
    .eq('source_message_id', input.sourceMessageId)
    .eq('is_relevant_hazard', true)
  if (segmentsError) throw segmentsError

  const candidates = ((sourceSegments ?? []) as SourceSegmentRow[])
    .map((segment) => candidateFromSegment(segment, now))
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .sort((left, right) => {
      const onsetDifference = (timestamp(left.onsetAt) ?? 0) - (timestamp(right.onsetAt) ?? 0)
      return onsetDifference || right.severityLevel - left.severityLevel
    })
  const currentEvents = await loadCurrentEvents(client)
  const { matches, assignedEvents } = assignCandidates(candidates, currentEvents)

  let newEventCount = 0
  let updatedEventCount = 0
  let endedEventCount = 0
  let notificationCandidateCount = 0

  for (const [candidateIndex, candidate] of candidates.entries()) {
    const matchedEventIndex = matches.get(candidateIndex)
    if (matchedEventIndex == null) {
      const created = await createEvent(client, candidate, nowIso)
      if (created) {
        newEventCount += 1
        notificationCandidateCount += 1
      }
      continue
    }

    const event = currentEvents[matchedEventIndex]
    const reasons = changeReasons(candidate, event)
    const changed = await updateEvent(client, event, candidate, reasons, nowIso)
    if (changed) {
      updatedEventCount += 1
      if (isNotifiableChange(reasons)) notificationCandidateCount += 1
    }
  }

  for (const [eventIndex, event] of currentEvents.entries()) {
    if (assignedEvents.has(eventIndex)) continue
    await endEvent(client, event, sourceMessage, now)
    endedEventCount += 1
  }

  const dataChanged =
    newEventCount > 0 || updatedEventCount > 0 || endedEventCount > 0
  if (dataChanged) await incrementDataVersion(client)

  const { count: activeEventCount, error: countError } = await client
    .from('weather_events')
    .select('*', { count: 'exact', head: true })
    .eq('source', CHMI_SOURCE)
    .in('status', ['upcoming', 'active'])
  if (countError) throw countError

  const { error: runError } = await client
    .from('weather_sync_runs')
    .update({
      finished_at: nowIso,
      status: dataChanged ? 'succeeded' : input.importStatus === 'unchanged' ? 'no_change' : 'succeeded',
      active_event_count: activeEventCount ?? 0,
      new_event_count: newEventCount,
      updated_event_count: updatedEventCount,
      ended_event_count: endedEventCount,
      notification_candidate_count: notificationCandidateCount,
    })
    .eq('id', input.syncRunId)
  if (runError) throw runError

  return {
    activeEventCount: activeEventCount ?? 0,
    newEventCount,
    updatedEventCount,
    endedEventCount,
    notificationCandidateCount,
    dataChanged,
  }
}
