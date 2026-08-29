import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { getWeatherAlertsRuntimeContext } from './access'
import type {
  WeatherAlertsWorkspace,
  WeatherEventDetail,
  WeatherEventAreaSummary,
  WeatherEventListItem,
  WeatherEventStatus,
  WeatherHazardType,
  WeatherSourceStatus,
} from './types'

type EventRow = {
  id: string
  event_code: string
  event_name: string
  hazard_type: WeatherHazardType
  severity: string
  severity_level: number
  severity_color: 'yellow' | 'orange' | 'red'
  certainty: string
  headline: string
  description: string
  instruction: string
  situation: string | null
  criterion: string | null
  source_web_url: string | null
  onset_at: string | null
  valid_to: string | null
  status: WeatherEventStatus
  current_version_number: number
  first_seen_at: string
  last_changed_at: string
  ended_at: string | null
}

type VersionRow = {
  id: string
  event_id: string
  version_number: number
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

type PreferenceRow = {
  notifications_enabled: boolean
  include_yellow_warnings: boolean
  extended_notifications_enabled: boolean
  updated_at: string
}

type SourceStateRow = {
  last_success_at: string | null
  last_attempt_at: string | null
  last_error_at: string | null
  consecutive_failure_count: number | null
  data_version: number | null
}

type VersionDetailRow = {
  id: string
  event_id: string
  source_message_id: string | null
  version_number: number
  status: WeatherEventStatus
  severity_color: 'yellow' | 'orange' | 'red'
  headline: string
  effective_at: string | null
  onset_at: string | null
  valid_to: string | null
  change_reasons: string[] | null
  parameters: Record<string, unknown> | null
}

type SourceMessageRow = {
  id: string
  sent_at: string | null
}

function normalizeDetailParameters(value: Record<string, unknown> | null) {
  const normalized: Record<string, string | string[]> = {}
  for (const [key, item] of Object.entries(value ?? {})) {
    if (typeof item === 'string') normalized[key] = item
    else if (typeof item === 'number' || typeof item === 'boolean') normalized[key] = String(item)
    else if (Array.isArray(item)) {
      const items = item.filter((entry): entry is string => typeof entry === 'string')
      if (items.length > 0) normalized[key] = items
    }
  }
  return normalized
}

const EVENT_COLUMNS =
  'id,event_code,event_name,hazard_type,severity,severity_level,severity_color,certainty,headline,description,instruction,situation,criterion,source_web_url,onset_at,valid_to,status,current_version_number,first_seen_at,last_changed_at,ended_at'

function eventTime(item: EventRow) {
  return new Date(item.onset_at ?? item.first_seen_at).getTime()
}

function compareActiveEvents(left: EventRow, right: EventRow) {
  const severityDifference = right.severity_level - left.severity_level
  if (severityDifference !== 0) return severityDifference
  return eventTime(left) - eventTime(right)
}

async function readWeatherSourceStatus(): Promise<WeatherSourceStatus> {
  const serviceClient = getServiceRoleClient()
  if (!serviceClient) {
    return {
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastErrorAt: null,
      consecutiveFailureCount: 0,
      dataVersion: 0,
    }
  }

  const { data, error } = await serviceClient
    .from('weather_source_state')
    .select(
      'last_success_at,last_attempt_at,last_error_at,consecutive_failure_count,data_version',
    )
    .eq('source', 'chmi')
    .maybeSingle<SourceStateRow>()
  if (error) {
    throw new Error(`Stav zdroje ČHMÚ se nepodařilo načíst: ${error.message}`)
  }

  return {
    lastSuccessAt: data?.last_success_at ?? null,
    lastAttemptAt: data?.last_attempt_at ?? null,
    lastErrorAt: data?.last_error_at ?? null,
    consecutiveFailureCount: data?.consecutive_failure_count ?? 0,
    dataVersion: data?.data_version ?? 0,
  }
}

export async function getWeatherSourceStatus(): Promise<WeatherSourceStatus> {
  await getWeatherAlertsRuntimeContext()
  return readWeatherSourceStatus()
}

export async function getWeatherAlertsWorkspace(): Promise<WeatherAlertsWorkspace> {
  const { supabase, user } = await getWeatherAlertsRuntimeContext({
    redirectOnDenied: true,
  })
  const historyFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000).toISOString()

  const [activeResult, historyResult, preferenceResult] =
    await Promise.all([
      supabase
        .from('weather_events')
        .select(EVENT_COLUMNS)
        .in('status', ['upcoming', 'active'])
        .order('severity_level', { ascending: false })
        .order('onset_at', { ascending: true }),
      supabase
        .from('weather_events')
        .select(EVENT_COLUMNS)
        .in('status', ['ended', 'cancelled'])
        .gte('last_changed_at', historyFrom)
        .order('last_changed_at', { ascending: false })
        .limit(80),
      supabase
        .from('weather_notification_preferences')
        .select('notifications_enabled,include_yellow_warnings,extended_notifications_enabled,updated_at')
        .eq('user_id', user.id)
        .maybeSingle<PreferenceRow>(),
    ])

  const error =
    activeResult.error ??
    historyResult.error ??
    preferenceResult.error
  if (error) throw new Error(`Výstrahy počasí se nepodařilo načíst: ${error.message}`)

  const sourceStatus = await readWeatherSourceStatus()

  const activeRows = (activeResult.data ?? []) as unknown as EventRow[]
  const historyRows = (historyResult.data ?? []) as unknown as EventRow[]
  const allRows = [...activeRows, ...historyRows]
  const eventIds = allRows.map((event) => event.id)
  const areasByEvent = new Map<string, WeatherEventAreaSummary[]>()

  if (eventIds.length > 0) {
    const { data: versionData, error: versionError } = await supabase
      .from('weather_event_versions')
      .select('id,event_id,version_number')
      .in('event_id', eventIds)
    if (versionError) {
      throw new Error(`Verze výstrah se nepodařilo načíst: ${versionError.message}`)
    }

    const currentVersionIds = new Map<string, string>()
    for (const version of (versionData ?? []) as VersionRow[]) {
      const event = allRows.find((item) => item.id === version.event_id)
      if (event && event.current_version_number === version.version_number) {
        currentVersionIds.set(event.id, version.id)
      }
    }
    const versionIds = [...currentVersionIds.values()]

    if (versionIds.length > 0) {
      const { data: areaData, error: areaError } = await supabase
        .from('weather_event_areas')
        .select(
          'event_id,version_id,code_type,code_value,area_name,altitude,ceiling',
        )
        .in('version_id', versionIds)
      if (areaError) {
        throw new Error(`Zasažené oblasti se nepodařilo načíst: ${areaError.message}`)
      }

      for (const area of (areaData ?? []) as AreaRow[]) {
        const list = areasByEvent.get(area.event_id) ?? []
        list.push({
          codeType: area.code_type,
          codeValue: area.code_value,
          name: area.area_name,
          altitude: area.altitude,
          ceiling: area.ceiling,
        })
        areasByEvent.set(area.event_id, list)
      }
    }
  }

  const mapEvent = (event: EventRow): WeatherEventListItem => ({
    id: event.id,
    eventCode: event.event_code,
    eventName: event.event_name,
    hazardType: event.hazard_type,
    severity: event.severity,
    severityLevel: event.severity_level,
    severityColor: event.severity_color,
    certainty: event.certainty,
    headline: event.headline,
    description: event.description,
    instruction: event.instruction,
    situation: event.situation,
    criterion: event.criterion,
    sourceWebUrl: event.source_web_url,
    onsetAt: event.onset_at,
    validTo: event.valid_to,
    status: event.status,
    currentVersionNumber: event.current_version_number,
    firstSeenAt: event.first_seen_at,
    lastChangedAt: event.last_changed_at,
    endedAt: event.ended_at,
    areas: (areasByEvent.get(event.id) ?? []).sort((left, right) =>
      left.name.localeCompare(right.name, 'cs'),
    ),
  })

  const preference = preferenceResult.data
  return {
    activeEvents: activeRows.sort(compareActiveEvents).map(mapEvent),
    historyEvents: historyRows.map(mapEvent),
    preferences: {
      notificationsEnabled: preference?.notifications_enabled ?? false,
      includeYellowWarnings: preference?.include_yellow_warnings ?? false,
      extendedNotificationsEnabled: preference?.extended_notifications_enabled ?? false,
      updatedAt: preference?.updated_at ?? null,
    },
    sourceStatus,
  }
}

export async function getWeatherEventDetail(eventId: string): Promise<WeatherEventDetail> {
  const { supabase } = await getWeatherAlertsRuntimeContext()
  const detailClient = getServiceRoleClient() ?? supabase

  const { data: event, error: eventError } = await detailClient
    .from('weather_events')
    .select('id,current_version_number')
    .eq('id', eventId)
    .maybeSingle<{ id: string; current_version_number: number }>()
  if (eventError) throw new Error(`Detail výstrahy se nepodařilo načíst: ${eventError.message}`)
  if (!event) throw new Error('Požadovaná výstraha již není dostupná.')

  const { data: versionData, error: versionError } = await detailClient
    .from('weather_event_versions')
    .select('id,event_id,source_message_id,version_number,status,severity_color,headline,effective_at,onset_at,valid_to,change_reasons,parameters')
    .eq('event_id', eventId)
    .order('version_number', { ascending: false })
    .limit(40)
  if (versionError) throw new Error(`Historii výstrahy se nepodařilo načíst: ${versionError.message}`)

  const versions = (versionData ?? []) as unknown as VersionDetailRow[]
  const versionIds = versions.map((version) => version.id)
  const sourceMessageIds = [...new Set(versions.map((version) => version.source_message_id).filter((id): id is string => Boolean(id)))]
  const issuedAtByMessage = new Map<string, string | null>()
  const areaCodesByVersion = new Map<string, Set<string>>()

  const [messageResult, areaResult] = await Promise.all([
    sourceMessageIds.length > 0
      ? detailClient.from('weather_source_messages').select('id,sent_at').in('id', sourceMessageIds)
      : Promise.resolve({ data: [] as SourceMessageRow[], error: null }),
    versionIds.length > 0
      ? detailClient.from('weather_event_areas').select('version_id,code_type,code_value').in('version_id', versionIds)
      : Promise.resolve({ data: [] as Array<{ version_id: string; code_type: string; code_value: string }>, error: null }),
  ])
  if (messageResult.error) throw new Error(`Čas vydání výstrahy se nepodařilo načíst: ${messageResult.error.message}`)
  if (areaResult.error) throw new Error(`Historii oblastí se nepodařilo načíst: ${areaResult.error.message}`)

  for (const message of (messageResult.data ?? []) as SourceMessageRow[]) {
    issuedAtByMessage.set(message.id, message.sent_at)
  }
  for (const area of (areaResult.data ?? []) as Array<{ version_id: string; code_type: string; code_value: string }>) {
    if (area.code_type.toUpperCase() !== 'CISORP') continue
    const codes = areaCodesByVersion.get(area.version_id) ?? new Set<string>()
    codes.add(area.code_value)
    areaCodesByVersion.set(area.version_id, codes)
  }

  const current = versions.find((version) => version.version_number === event.current_version_number) ?? versions[0]
  return {
    eventId,
    currentVersionNumber: event.current_version_number,
    issuedAt: current?.source_message_id ? issuedAtByMessage.get(current.source_message_id) ?? null : null,
    effectiveAt: current?.effective_at ?? null,
    parameters: normalizeDetailParameters(current?.parameters ?? null),
    versions: versions.map((version) => ({
      id: version.id,
      versionNumber: version.version_number,
      status: version.status,
      severityColor: version.severity_color,
      headline: version.headline,
      issuedAt: version.source_message_id ? issuedAtByMessage.get(version.source_message_id) ?? null : null,
      effectiveAt: version.effective_at,
      onsetAt: version.onset_at,
      validTo: version.valid_to,
      changeReasons: version.change_reasons ?? [],
      affectedAreaCount: areaCodesByVersion.get(version.id)?.size ?? 0,
    })),
  }
}
