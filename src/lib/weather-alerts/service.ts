import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { getWeatherAlertsRuntimeContext } from './access'
import type {
  WeatherAlertsWorkspace,
  WeatherEventAreaSummary,
  WeatherEventListItem,
  WeatherEventStatus,
  WeatherHazardType,
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
  updated_at: string
}

type SourceStateRow = {
  last_success_at: string | null
  last_attempt_at: string | null
  last_error_at: string | null
  consecutive_failure_count: number | null
  data_version: number | null
}

const EVENT_COLUMNS =
  'id,event_code,event_name,hazard_type,severity,severity_level,severity_color,certainty,headline,description,instruction,situation,criterion,source_web_url,onset_at,valid_to,status,current_version_number,first_seen_at,last_changed_at,ended_at'

function eventTime(item: EventRow) {
  return new Date(item.onset_at ?? item.first_seen_at).getTime()
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
        .select('notifications_enabled,include_yellow_warnings,updated_at')
        .eq('user_id', user.id)
        .maybeSingle<PreferenceRow>(),
    ])

  const error =
    activeResult.error ??
    historyResult.error ??
    preferenceResult.error
  if (error) throw new Error(`Výstrahy počasí se nepodařilo načíst: ${error.message}`)

  const serviceClient = getServiceRoleClient()
  let source: SourceStateRow | null = null
  if (serviceClient) {
    const { data, error: sourceError } = await serviceClient
      .from('weather_source_state')
      .select(
        'last_success_at,last_attempt_at,last_error_at,consecutive_failure_count,data_version',
      )
      .eq('source', 'chmi')
      .maybeSingle<SourceStateRow>()
    if (sourceError) {
      throw new Error(`Stav zdroje ČHMÚ se nepodařilo načíst: ${sourceError.message}`)
    }
    source = data
  }

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
    firstSeenAt: event.first_seen_at,
    lastChangedAt: event.last_changed_at,
    endedAt: event.ended_at,
    areas: (areasByEvent.get(event.id) ?? []).sort((left, right) =>
      left.name.localeCompare(right.name, 'cs'),
    ),
  })

  const preference = preferenceResult.data
  return {
    activeEvents: activeRows.sort((left, right) => eventTime(left) - eventTime(right)).map(mapEvent),
    historyEvents: historyRows.map(mapEvent),
    preferences: {
      notificationsEnabled: preference?.notifications_enabled ?? false,
      includeYellowWarnings: preference?.include_yellow_warnings ?? false,
      updatedAt: preference?.updated_at ?? null,
    },
    sourceStatus: {
      lastSuccessAt: source?.last_success_at ?? null,
      lastAttemptAt: source?.last_attempt_at ?? null,
      lastErrorAt: source?.last_error_at ?? null,
      consecutiveFailureCount: source?.consecutive_failure_count ?? 0,
      dataVersion: source?.data_version ?? 0,
    },
  }
}
